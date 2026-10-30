import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
 * A pass is `<prefix><payload>.<mac>`, the payload base64url JSON and the mac its HMAC-SHA256, over
 * the prefix and the payload, under the harness's ticket secret (`<dataDir>/ticket-secret`,
 * `tickets.ts`), so a restart ends no pass. Nothing about it is stored: it is taken back by taking
 * back the token it was made with, or by the canvas's sharing.
 */

export const CANVAS_PASS = "dk_cp_";

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
}

/** Whether a string looks like a canvas pass, before it is checked. */
export const isCanvasPass = (value: string | undefined): value is string => typeof value === "string" && value.startsWith(CANVAS_PASS);

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
 * canvas's folder (`/api/board/<folder>…`), its picture (`/api/thumb/<folder>…`), or a card or board
 * placed on the canvas from elsewhere (`placed`), by its own path. Every part plain: never `..`, `.`, or a
 * hidden folder.
 */
export function passCovers(canvas: string, path: string, placed: (deckPath: string) => boolean = () => false): boolean {
	const route = /^\/api\/(board|thumb)\/(.+)$/.exec(path);
	if (!route) return false;
	const rest = route[2]!;
	if (!rest.split("/").every((part) => part !== "" && !part.startsWith("."))) return false;
	if (rest.startsWith(canvasFolder(canvas))) return true;
	return placed(rest);
}
