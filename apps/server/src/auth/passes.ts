import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Passes: signed, short, kept nowhere. A pass reaches one thing, a canvas, and is checked on every use.
 *
 * A **canvas pass** (`dk_cp_…`) is what the canvas frame holds for its one canvas, in Decks and in
 * the harness's own picture-taking page: its calls carry it as `Authorization: Bearer`, and its files,
 * pictures, modules and sheets carry it in their address, `/api/t/<pass>/board/canvases/<name>/…`,
 * since an image or a module cannot send a header. It is asked for with a harness token
 * (`POST /api/passes`) and is bound to that token: it works only while the token does, so signing out
 * ends it. It names a role, view or edit, and every use reads the person's role on the canvas now: a
 * canvas no longer shared, or shared now to view, is refused or read only at once. It lives an hour,
 * and the page that holds it asks for the next one unseen (`@decks/canvas/frame`).
 *
 * An **app pass** (`dk_ap_`) reaches one app. Its server holds one while it runs (`DECKS_TOKEN`, sent as
 * the bearer), made when that run starts and good while that run is the app's (`Apps.runOf`), so it
 * ends when the app stops or exits. A tab another site opens the app in carries one in its address
 * (`/app/<name>/?decks_pass=…`, the GET that opens it, `apps/route.ts`), asked for with a harness
 * token, bound to it, for a day. An app on a canvas holds one too, made for that canvas: the canvas
 * frame opens the app with its canvas pass (`POST /api/apps/<name>/open`) and loads it at
 * `/app/t/<pass>/<name>/`, so every request the app makes carries it. It is checked on every use: the
 * token still works, the app is still placed on the canvas, and the canvas is still trusted (yours,
 * and nobody else may edit it); there is no day, so the app never reloads to renew it.
 *
 * A pass is `<prefix><payload>.<mac>`, the payload base64url JSON and the mac its HMAC-SHA256, over
 * the prefix and the payload, under the harness's secret (`<dataDir>/ticket-secret`, `passSecret`), so
 * a restart ends no pass. Nothing about it is stored: it is taken back by taking
 * back the token it was made with, or by the canvas's sharing.
 */

export const CANVAS_PASS = "dk_cp_";
export const APP_PASS = "dk_ap_";

/** How long an app pass for a tab lives: a day. An app's server's lives as long as that run of it. */
export const APP_TAB_MS = 24 * 3_600_000;

/** How long a canvas pass lives: an hour. A card's script beside the frame can read it, so it is short. */
export const CANVAS_PASS_MS = 3_600_000;

/** The id a pass the harness makes for its own pages is bound to: its own Chromium, which needs no one's token. */
export const HARNESS_ID = "harness";

/** A canvas pass as it is read, with the role it has now. */
export interface CanvasPassOf {
	canvas: string;
	/** The role on the canvas now: the pass's, or less if the canvas's sharing has changed since. */
	role: "edit" | "view";
	/** The id of the harness token it was made with (`TokenStore`), or `HARNESS_ID`. */
	by: string;
	expires: number;
}

interface CanvasPayload {
	c: string;
	r: "edit" | "view";
	k: string;
	e: number;
}

/** What a pass needs to know of the harness when it is used. */
export interface PassChecks {
	/** Whether the harness token with this id still works (`TokenStore.live`). */
	live(id: string): boolean;
	/** The person's role on a canvas now, or undefined when there is no such canvas (any more). */
	role(canvas: string): "edit" | "view" | undefined;
	/** The id of the run of an app's server going now, or undefined when it is not running. */
	appRun?(name: string): string | undefined;
	/** Whether an app is placed on a canvas now, and the canvas is one whose cards may use it: yours alone. */
	appOnCanvas?(name: string, canvas: string): boolean;
}

interface AppPayload {
	a: string;
	/** The run of its server it was made for. */
	r?: string;
	/** Or the harness token it was asked for with, for a tab, and when it runs out. */
	k?: string;
	e?: number;
	/** Or, with `k`, the canvas it was made for: no `e`, since it lasts while it is checked. */
	c?: string;
}

/** An app pass as it is read: which app, and whether it is its server's or a tab's. */
export interface AppPassOf {
	app: string;
	/** `server`: the app's own server, while that run of it goes; `tab`: one page opening it; `canvas`: the app placed on a canvas. */
	holder: "server" | "tab" | "canvas";
	/** For `canvas`, which one. */
	canvas?: string;
}

/** Whether a string looks like a canvas pass, before it is checked. */
export const isCanvasPass = (value: string | undefined): value is string => typeof value === "string" && value.startsWith(CANVAS_PASS);
/** Whether a string looks like an app pass, before it is checked. */
export const isAppPass = (value: string | undefined): value is string => typeof value === "string" && value.startsWith(APP_PASS);

export class Passes {
	private readonly canvasMs: number;

	constructor(
		private readonly checks: PassChecks,
		private readonly secret: Buffer = randomBytes(32),
		options: { canvasMs?: number } = {},
	) {
		this.canvasMs = options.canvasMs ?? CANVAS_PASS_MS;
	}

	/** A canvas pass for one canvas, with a role, bound to the harness token whose id is `by`. */
	canvas(canvas: string, role: "edit" | "view", by: string, now = Date.now()): { pass: string; expires: number } {
		const expires = now + this.canvasMs;
		return { pass: this.sign(CANVAS_PASS, { c: canvas, r: role, k: by, e: expires } satisfies CanvasPayload), expires };
	}

	/**
	 * A canvas pass read and checked: made here, not run out, its token still working, and the canvas
	 * still there; the role is the lesser of the pass's and the person's on the canvas now.
	 */
	openCanvas(pass: string | undefined, now = Date.now()): CanvasPassOf | undefined {
		if (!isCanvasPass(pass)) return undefined;
		const payload = this.open(CANVAS_PASS, pass) as Partial<CanvasPayload> | undefined;
		if (!payload || typeof payload.c !== "string" || typeof payload.k !== "string" || typeof payload.e !== "number" || (payload.r !== "edit" && payload.r !== "view")) return undefined;
		if (payload.e <= now) return undefined;
		if (payload.k !== HARNESS_ID && !this.checks.live(payload.k)) return undefined;
		// The harness's own page drawing a saved frame that is on no canvas: a pass for no canvas, which reads that file alone (`auth/guard.ts`).
		const current = payload.k === HARNESS_ID && payload.c === "" ? "view" : this.checks.role(payload.c);
		if (!current) return undefined;
		const role = payload.r === "view" || current === "view" ? "view" : "edit";
		return { canvas: payload.c, role, by: payload.k, expires: payload.e };
	}

	/** The pass an app's server holds for one run of it (`run`), good while that run is the app's. */
	appServer(name: string, run: string): string {
		return this.sign(APP_PASS, { a: name, r: run } satisfies AppPayload);
	}

	/** A pass for a tab opening an app, bound to the harness token whose id is `by`, for a day. */
	appTab(name: string, by: string, now = Date.now()): { pass: string; expires: number } {
		const expires = now + APP_TAB_MS;
		return { pass: this.sign(APP_PASS, { a: name, k: by, e: expires } satisfies AppPayload), expires };
	}

	/** A pass for an app placed on a canvas, bound to the harness token whose id is `by`: good while that token works and the app is on the canvas. */
	appCanvas(name: string, canvas: string, by: string): string {
		return this.sign(APP_PASS, { a: name, k: by, c: canvas } satisfies AppPayload);
	}

	/** An app pass read and checked: a server's while its run goes on, a tab's while its token works and its day lasts, a canvas's while its token works and the app is on that canvas. */
	openApp(pass: string | undefined, now = Date.now()): AppPassOf | undefined {
		if (!isAppPass(pass)) return undefined;
		const payload = this.open(APP_PASS, pass) as Partial<AppPayload> | undefined;
		if (!payload || typeof payload.a !== "string") return undefined;
		if (typeof payload.r === "string") return this.checks.appRun?.(payload.a) === payload.r ? { app: payload.a, holder: "server" } : undefined;
		if (typeof payload.k !== "string" || !this.checks.live(payload.k)) return undefined;
		if (typeof payload.c === "string") return this.checks.appOnCanvas?.(payload.a, payload.c) ? { app: payload.a, holder: "canvas", canvas: payload.c } : undefined;
		if (typeof payload.e !== "number" || payload.e <= now) return undefined;
		return { app: payload.a, holder: "tab" };
	}

	private sign(prefix: string, payload: object): string {
		const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
		return `${prefix}${body}.${this.mac(prefix, body).toString("base64url")}`;
	}

	/** The payload of a pass of this prefix whose mac is right, else undefined. */
	private open(prefix: string, pass: string): Record<string, unknown> | undefined {
		const [body, mac, extra] = pass.slice(prefix.length).split(".");
		if (!body || !mac || extra !== undefined) return undefined;
		const given = Buffer.from(mac, "base64url");
		const wanted = this.mac(prefix, body);
		if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return undefined;
		try {
			const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
			return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
		} catch {
			return undefined;
		}
	}

	private mac(prefix: string, body: string): Buffer {
		return createHmac("sha256", this.secret).update(`${prefix}${body}`).digest();
	}
}

/**
 * The folder a canvas keeps its files in, as `/api/board/` serves it: `canvases/plan/`, or a friend's
 * `shared/canvases/ana/trip/` for the canvas `shared/ana/trip`.
 */
export function canvasFolder(canvas: string): string {
	const shared = /^shared\/([^/]+)\/([^/]+)$/.exec(canvas);
	return shared ? `shared/canvases/${shared[1]}/${shared[2]}/` : `canvases/${canvas}/`;
}

/**
 * Whether a canvas pass reaches a GET of this path (decoded, as the route sees it): a file in the
 * canvas's folder (`/api/card/<folder>…`, or `/api/board/…`, the old prefix), its picture (`/api/thumb/<folder>…`), or a card or board
 * placed on the canvas from elsewhere (`placed`), by its own path. Every part plain: never `..`, `.`, or a
 * hidden folder.
 */
export function passCovers(canvas: string, path: string, placed: (deckPath: string) => boolean = () => false): boolean {
	const route = /^\/api\/(card|board|thumb)\/(.+)$/.exec(path);
	if (!route) return false;
	const rest = route[2]!;
	if (!rest.split("/").every((part) => part !== "" && !part.startsWith("."))) return false;
	if (rest.startsWith(canvasFolder(canvas))) return true;
	return placed(rest);
}

/**
 * The secret passes are signed with, kept in `<dataDir>/ticket-secret` (mode 0600, the name from when
 * it signed tickets; never in the deck, which syncs): made the first time, read every time after, so a
 * pass made before a restart still works after it. A file that is not 32 bytes of hex is made again
 * (every pass made on it ends).
 */
export function passSecret(dataDir: string): Buffer {
	const file = join(dataDir, "ticket-secret");
	try {
		if (existsSync(file)) {
			const kept = readFileSync(file, "utf8").trim();
			if (/^[0-9a-f]{64}$/.test(kept)) return Buffer.from(kept, "hex");
		}
	} catch {
		/* made again below */
	}
	const made = randomBytes(32);
	try {
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(file, made.toString("hex"), { mode: 0o600 });
		chmodSync(file, 0o600);
	} catch (error) {
		// Not kept: passes work until the next restart.
		console.warn(`[decks] the pass secret could not be kept in ${file}: ${(error as Error).message}`);
	}
	return made;
}

/**
 * A pass carried in the path rather than a header, `/api/t/<pass>/card/<path>` (or `/board/`, the old
 * prefix, until 2026-11-30): what a canvas frame's
 * files, pictures, modules and sheets are read at, so every relative address they load carries it too.
 * Answers the pass and the path as the route sees it.
 */
export function splitPathPass(url: string | undefined): { pass: string; rest: string } | undefined {
	const match = /^\/api\/t\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(\/[^?]*)(\?.*)?$/.exec(url ?? "");
	return match ? { pass: match[1]!, rest: `/api${match[2]}${match[3] ?? ""}` } : undefined;
}

/** A request's path as the route will see it: percent-decoded, without its query. */
export function decodedPath(url: string | undefined): string | undefined {
	const raw = (url ?? "/").split("?")[0] ?? "/";
	try {
		return decodeURIComponent(raw);
	} catch {
		return undefined;
	}
}
