import { randomInt, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import type { App } from "../app.ts";
import { saveStudioLink, studioOrigin } from "../studio/index.ts";
import { CLI_TOKEN_LABEL } from "./cli-token.ts";
import { actsAsPerson } from "./principal.ts";
import { FOLDER_TICKET_MS, isFolderTicket, MAX_TICKETS, TICKET_MS, ticketPath } from "./tickets.ts";
import { TAB_IDLE_MS, type TokenStore } from "./tokens.ts";
import { bearerOf, originOf } from "./guard.ts";

/**
 * The doors: where each kind of token is handed out, and the only places a request without one is
 * answered with one.
 *
 * - **A Decks tab.** The Decks page, loaded by a person into a tab of its own (a top-level navigation),
 *   is written a fresh person token for that tab (`withSession`), which lasts a day unused.
 *   Never a frame's copy of the page or a script's fetch of it: those are answered without.
 * - **`decks login`**, in a terminal: `POST /api/login { code }`, the code from `decks pair code` on
 *   the harness's own machine (`PairCodes`), for a person token that lasts `DECKS_TOKEN_DAYS` unused.
 * - **Agents and app servers**: made when their process starts and taken back when it stops, by the
 *   agent (`stage/bridge.ts`) and the apps (`apps/service.ts`); no request asks for them.
 * - **Pairing**: `POST /api/pair` and `POST /api/studio/connect` trade a code, or a site this harness
 *   can place, for a site token, bound to the page's site.
 * - **A board**: `POST /api/tokens { kind: "board", path, stage? }`, asked by the person or a site for
 *   a board it is about to show.
 * - **A canvas pass**: `POST /api/passes { canvas }`, asked by the person or a site for the sandboxed
 *   editor it is about to show, and again at half its hour to renew it (`passes.ts`).
 * - **A page**: `POST /api/tickets`, five-minute tickets for another site's frames and tabs.
 */

// --- codes ---------------------------------------------------------------------------

/**
 * Whoever deploys a harness where others can reach it can make the code a must
 * (`DECKS_REQUIRE_PAIR_CODE=1`): then no front end from another site gets a token without one, from
 * wherever it calls.
 */
export function codeRequired(env: NodeJS.ProcessEnv = process.env): boolean {
	return ["1", "true", "yes", "on"].includes(String(env.DECKS_REQUIRE_PAIR_CODE ?? "").trim().toLowerCase());
}

const CODE_MS = 10 * 60_000;
const CODE_TRIES = 5;

/**
 * The six-digit code `decks pair code` makes, traded once for a site token (pairing) or a person token
 * (`decks login`). It lasts ten minutes and dies after five wrong tries, which together put a guess at
 * one in two hundred thousand per code shown; a new code replaces the old.
 */
export class PairCodes {
	private code: { value: string; expires: number; tries: number } | undefined;

	/** The code made a must by whoever deployed this (`DECKS_REQUIRE_PAIR_CODE`): not undone from a page. */
	readonly forced: boolean;

	constructor(
		private readonly store: Pick<TokenStore, "requireCode">,
		options: { required?: boolean } = {},
	) {
		this.forced = options.required ?? false;
	}

	/** Whether every pairing needs a code, wherever it comes from: deployed so, or asked for. */
	get required(): boolean {
		return this.forced || this.store.requireCode;
	}

	setRequired(on: boolean): void {
		this.store.requireCode = on;
	}

	/** A fresh code, replacing any other: only the newest one shown can be used. */
	newCode(now = Date.now()): { code: string; expires: number } {
		const value = String(randomInt(0, 1_000_000)).padStart(6, "0");
		this.code = { value, expires: now + CODE_MS, tries: 0 };
		return { code: value, expires: this.code.expires };
	}

	/** The code being shown, if it still works. */
	current(now = Date.now()): { code: string; expires: number } | undefined {
		if (!this.code || this.code.expires <= now || this.code.tries >= CODE_TRIES) return undefined;
		return { code: this.code.value, expires: this.code.expires };
	}

	/** Spend a code: true once, for the right one in time, and never again. */
	redeem(code: string, now = Date.now()): boolean {
		const held = this.code;
		if (!held || held.expires <= now || held.tries >= CODE_TRIES) return false;
		const given = Buffer.from(code.replace(/\D/g, "").padStart(6, "0").slice(0, 6));
		if (!timingSafeEqual(given, Buffer.from(held.value))) {
			held.tries += 1;
			return false;
		}
		this.code = undefined;
		return true;
	}
}

// --- where a request comes from, for the doors alone ------------------------------------

/*
 * These say whether a door may open without a code. They never say who is calling: that is the
 * token's alone (`guard.ts`).
 */

/**
 * Whether a request was made on this machine itself: from loopback, and not passed on by a proxy
 * there (`tailscale serve`, a tunnel, Vite's dev proxy), which all connect from loopback too but say
 * whom they pass on in `X-Forwarded-For` or `Forwarded`. Only `decks pair code` asks it.
 */
export function fromThisMachine(remote: string | undefined, headers: Record<string, string | string[] | undefined>): boolean {
	if (!/^(?:127\.|::1$|::ffff:127\.)/.test(remote ?? "")) return false;
	return !headers["x-forwarded-for"] && !headers.forwarded && !headers["x-real-ip"];
}

/**
 * Whether a Studio may connect this harness without a code (`POST /api/studio/connect`): a page
 * served by the same machine or tailnet name the request was addressed to (Studio beside the
 * harness), one on loopback, or one whose origin the owner lists in `DECKS_STUDIO_ORIGINS`
 * (comma-separated, `https://studio.example.com`). A call with no `Origin` is not a page, and is let
 * through only from this machine itself. Any other site asks for a code: otherwise any page the
 * person opened could link the harness to a Studio of its own and be sent the deck.
 */
export function studioWithoutCode(remote: string | undefined, headers: Record<string, string | string[] | undefined>, env: NodeJS.ProcessEnv = process.env): boolean {
	const origin = headers.origin;
	if (typeof origin !== "string" || origin === "") return fromThisMachine(remote, headers);
	let from: URL;
	try {
		from = new URL(origin);
	} catch {
		return false;
	}
	const name = from.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (name === "localhost" || name === "::1" || /^127\./.test(name)) return true;
	const forwarded = headers["x-forwarded-host"];
	const host = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ?? headers.host;
	if (typeof host === "string" && host) {
		try {
			if (new URL(`http://${host}`).hostname.toLowerCase() === from.hostname.toLowerCase()) return true;
		} catch {
			/* not a host: compared with nothing */
		}
	}
	const listed = String(env.DECKS_STUDIO_ORIGINS ?? "")
		.split(",")
		.map((one) => one.trim())
		.filter(Boolean)
		.map((one) => {
			try {
				return new URL(one).origin;
			} catch {
				return "";
			}
		});
	return listed.includes(from.origin);
}

/**
 * Whether `POST /api/pair` may hand out a token without a code: only on this machine or a private
 * network (`fromPrivateNetwork`), and then a web page only if it is one a Studio may be
 * (`studioWithoutCode`). Reaching 127.0.0.1 proves nothing about a page, since any site the person
 * opens is let reach it by their browser. A call with no `Origin` is not a page (the iOS app, a
 * script) and keeps the old rule.
 */
export function pairWithoutCode(remote: string | undefined, headers: Record<string, string | string[] | undefined>, env: NodeJS.ProcessEnv = process.env): boolean {
	if (!fromPrivateNetwork(remote, headers)) return false;
	const origin = headers.origin;
	if (typeof origin !== "string" || origin === "") return true;
	return studioWithoutCode(remote, headers, env);
}

/** Loopback, the private ranges, link-local, and the 100.64/10 block Tailscale's addresses are in; IPv6 alike. */
export function isPrivateAddress(address: string | undefined): boolean {
	if (!address) return false;
	const ip = address.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "").toLowerCase();
	const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
	}
	if (ip === "::1") return true;
	// fc00::/7, unique local, which holds Tailscale's fd7a:115c:a1e0::/48; fe80::/10, link-local.
	return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

/**
 * Whether a request comes from this machine or a private network: no pairing code is asked then.
 *
 * The socket's own address, unless that is this machine and a proxy on it says who it was passing
 * on: `tailscale serve` and Vite's dev proxy both connect from loopback, and the first address in
 * `X-Forwarded-For` is the browser. Behind Tailscale Funnel that is an internet address, so a
 * server opened to the internet asks for a code again, as it should.
 */
export function fromPrivateNetwork(remote: string | undefined, headers: Record<string, string | string[] | undefined>): boolean {
	if (!isPrivateAddress(remote)) return false;
	const forwarded = headers["x-forwarded-for"];
	const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
	const loopback = /^(?:127\.|::1$|::ffff:127\.)/.test(remote ?? "");
	return first && loopback ? isPrivateAddress(first) : true;
}

// --- a Decks tab ---------------------------------------------------------------------

/**
 * Whether the browser is loading the page into a tab of its own: what it says of a navigation at the
 * top. A frame says `iframe`, a script's fetch `empty`, and neither is given a token.
 */
export function isTopNavigation(headers: Record<string, string | string[] | undefined>): boolean {
	return headers["sec-fetch-dest"] === "document" && headers["sec-fetch-mode"] === "navigate";
}

/** A person token for one Decks tab, which lasts a day unused. */
export function tabToken(store: TokenStore): string {
	return store.issue({ kind: "person" }, { label: "Decks tab", idle: TAB_IDLE_MS }).token;
}

/** The Decks page with its tab's token in it, read once at start by `web/src/lib/session.ts`. */
export function withSession(html: string, token: string): string {
	const tag = `<meta name="decks-session" content="${token}">`;
	const at = html.search(/<head[^>]*>/i);
	if (at < 0) return `${tag}${html}`;
	const end = html.indexOf(">", at) + 1;
	return `${html.slice(0, end)}${tag}${html.slice(end)}`;
}

// --- the routes ----------------------------------------------------------------------

/** What another site is told when its token was given to a page on a different site. */
export const ELSEWHERE = "This pairing token was given to a page on another site, so it does not work from this one. Pair this page with the harness itself.";

/** What a harness that requires a pairing code says to a connect without one. */
const NEEDS_CODE = "This harness asks every other Decks for a pairing code. Run decks pair code in a shell on its machine.";

/** The doors, under `/api`. The gate (`guard.ts`) lets the open ones through without a token. */
export function doorRoutes(app: App): express.Router {
	const api = express.Router();

	/**
	 * Whether this is a Decks server, and which: what the switcher's reachability dot asks. Open to
	 * any site, since it says nothing but the name; `paired` says whether the token sent still works.
	 */
	api.get("/hello", (req, res) => {
		const seen = app.tokens.verify(bearerOf(req.headers), { origin: originOf(req.headers) });
		res.setHeader("Cache-Control", "no-store");
		res.json({ decks: true, name: app.deck.name, paired: seen.ok && actsAsPerson(seen.principal), needsCode: app.codes.required || !pairWithoutCode(req.socket.remoteAddress, req.headers) });
	});

	/**
	 * Trade a pairing code for a site token: the door another site uses. Answered with the deck's
	 * name, which is what the other front end will call this server.
	 */
	api.post("/pair", (req, res) => {
		const body = (req.body ?? {}) as { code?: unknown; label?: unknown };
		const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
		const origin = String(req.headers.origin ?? "");
		const label = typeof body.label === "string" ? body.label : "";
		if (!code && app.codes.required) {
			res.status(403).json({ needsCode: true, error: NEEDS_CODE });
			return;
		}
		if (!code && !pairWithoutCode(req.socket.remoteAddress, req.headers)) {
			res.status(403).json({ needsCode: true, error: "This page is on another site or reaches the server over the internet, so it needs a pairing code. Run decks pair code in a shell on the server's machine." });
			return;
		}
		if (code && !app.codes.redeem(code)) {
			res.status(403).json({ needsCode: true, error: "That code is wrong or has expired. Make a new one with decks pair code on the server's machine." });
			return;
		}
		const { token } = app.tokens.issue({ kind: "site", label: label || "Another Decks", ...(origin ? { origin } : {}) });
		app.send(app.pairingMessage());
		res.json({ token, name: app.deck.name });
	});

	/**
	 * Decks Studio connecting this harness in one call: the Studio key to sync with, and a site token
	 * back for the page to call this harness with. Without a code only from a Studio the harness can
	 * place (`studioWithoutCode`); a harness deployed where others can reach it sets
	 * `DECKS_REQUIRE_PAIR_CODE=1`, and then a connect without a working code is refused from anywhere.
	 */
	api.post("/studio/connect", (req, res) => {
		const body = (req.body ?? {}) as { url?: unknown; key?: unknown; code?: unknown; label?: unknown };
		const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
		const origin = String(req.headers.origin ?? "");
		const label = typeof body.label === "string" && body.label.trim() ? body.label : "Decks Studio";
		if (typeof body.url !== "string" || typeof body.key !== "string") {
			res.status(400).json({ error: "Send Studio's address as url and this harness's key as key." });
			return;
		}
		if (app.codes.required && !code) {
			res.status(403).json({ needsCode: true, error: NEEDS_CODE });
			return;
		}
		if (!code && !studioWithoutCode(req.socket.remoteAddress, req.headers)) {
			res.status(403).json({ needsCode: true, error: "Only a Studio on this machine, on the address you reached the harness at, or listed in DECKS_STUDIO_ORIGINS connects without a code. Run decks pair code in a shell on the harness's machine." });
			return;
		}
		try {
			studioOrigin(body.url, body.key);
		} catch (error) {
			res.status(400).json({ error: (error as Error).message });
			return;
		}
		if (code && !app.codes.redeem(code)) {
			res.status(403).json({ needsCode: true, error: "That code is wrong or has expired. Make a new one with decks pair code on the harness's machine." });
			return;
		}
		const { token } = app.tokens.issue({ kind: "site", label, ...(origin ? { origin } : {}) });
		const linked = saveStudioLink(app.deck.path, body.url, body.key);
		app.send(app.pairingMessage());
		res.json({ token, name: app.deck.name, ...linked });
	});

	/**
	 * `decks login`: a code from `decks pair code` for a person token, which the command keeps in
	 * `~/.decks/token`. A terminal is the person only by proving it: with a code, from anywhere; or, on
	 * this machine, with the token the harness wrote at start where only its own user can read it
	 * (`cli-token.ts`), sent as the bearer. That one token, and no other person's: a Decks tab's, which
	 * lasts a day, is not traded here for one that lasts for weeks.
	 */
	api.post("/login", (req, res) => {
		const code = String(((req.body ?? {}) as { code?: unknown }).code ?? "").replace(/\D/g, "");
		const fromFile = !code && req.tokenId !== undefined && req.tokenId === app.cliTokenId;
		if (!fromFile && !code) {
			res.status(403).json({ error: "Log in with a code from decks pair code, or run decks login with no code on the harness's own machine, as the user it runs as: it reads the token the harness keeps in its data folder (.decks/cli-token)." });
			return;
		}
		if (!fromFile && !app.codes.redeem(code)) {
			res.status(403).json({ error: "That code is wrong or has expired. Make a new one with decks pair code on the harness's machine: any agent there can run it in its shell." });
			return;
		}
		const asked = String(((req.body ?? {}) as { label?: unknown }).label ?? "decks login").slice(0, 80) || "decks login";
		// Never the file's own label, which the next start takes back (`cli-token.ts`).
		const label = asked === CLI_TOKEN_LABEL ? "decks login" : asked;
		const { token } = app.tokens.issue({ kind: "person" }, { label });
		res.json({ token, name: app.deck.name });
	});

	/** Who this token is: what the Decks page asks to learn its token has run out (`web/src/lib/session.ts`). */
	api.get("/session", (req, res) => {
		res.set("cache-control", "no-store").json({ kind: req.principal?.kind ?? null });
	});
	api.post("/session", (req, res) => {
		res.set("cache-control", "no-store").json({ kind: req.principal?.kind ?? null });
	});
	/** Take back the token this request carries: `decks logout`. */
	api.delete("/session", (req, res) => {
		res.json({ revoked: req.tokenId ? app.tokens.revoke(req.tokenId) : false });
	});

	/**
	 * A canvas pass for the canvas frame the person or a site is about to show (`passes.ts`):
	 * `{ canvas }`, and back `{ pass, role, expires }`, the pass bound to the token that asked and with
	 * the person's role on that canvas. The page asks again at half its life.
	 */
	api.post("/passes", (req, res) => {
		if (!actsAsPerson(req.principal) || !req.tokenId) {
			res.status(403).json({ error: "Only the person, or a front end paired with this harness, asks for a canvas pass, with its own token." });
			return;
		}
		const pens = app.stage.pens;
		const canvas = String(((req.body ?? {}) as { canvas?: unknown }).canvas ?? "");
		if (!canvas || !pens || !pens.has(canvas)) {
			res.status(404).json({ error: `There is no canvas called ${canvas || "that"}.` });
			return;
		}
		const role = pens.sharing(canvas)?.role === "view" ? "view" : "edit";
		const { pass, expires } = app.passes.canvas(canvas, role, req.tokenId);
		res.set("cache-control", "no-store").json({ pass, role, expires });
	});

	/**
	 * A token for a board the person or a site is about to show: `{ kind: "board", path, stage? }`.
	 * Its calls act as that board, and the person is asked once before it may use the stage
	 * (`verbs/router.ts`).
	 */
	api.post("/tokens", (req, res) => {
		if (!actsAsPerson(req.principal)) {
			res.status(403).json({ error: "Only the person, or a front end paired with this harness, makes a board's token." });
			return;
		}
		const body = (req.body ?? {}) as { kind?: unknown; path?: unknown; stage?: unknown };
		if (body.kind !== "board" || typeof body.path !== "string" || !body.path) {
			res.status(400).json({ error: 'Ask for { kind: "board", path, stage? }.' });
			return;
		}
		if (!app.deck.board(body.path)) {
			res.status(404).json({ error: `There is no board at ${body.path}.` });
			return;
		}
		// A friend's board runs sandboxed with no token: it is someone else's code on this machine (`deck/layout.ts`).
		if (/^shared\//.test(body.path)) {
			res.status(403).json({ error: "A board on a canvas shared with you runs without a token: it is its owner's page, and acts on nothing here." });
			return;
		}
		const stage = typeof body.stage === "string" && body.stage ? body.stage : undefined;
		const { token } = app.tokens.issue({ kind: "board", path: body.path, ...(stage ? { stage } : {}) });
		res.set("cache-control", "no-store").json({ token });
	});

	/**
	 * An opencode session's agent token, for the plugin that runs its shell commands
	 * (`runtime/opencode/plugin`, `runtime/opencode2/plugin`): its server's own secret and the session id, which Decks made for one
	 * agent (`stage/bridge.ts`). The shell is then given that agent's token, never the server's.
	 */
	api.post("/tokens/session", (req, res) => {
		const sessionID = String(((req.body ?? {}) as { sessionID?: unknown }).sessionID ?? "");
		const agentId = sessionID ? app.bridge.agentFor(bearerOf(req.headers), sessionID) : undefined;
		if (!agentId) {
			res.status(401).json({ error: "That is not a session this harness's opencode server holds." });
			return;
		}
		res.set("cache-control", "no-store").json({ token: app.bridge.issue(agentId), agent: agentId });
	});

	/**
	 * Tickets for another site's frames and tabs (`tickets.ts`): `{ paths }`, board request paths
	 * (`/api/board/boards/a.html`, or `boards/a.html`), files (`/api/f/…`) or app addresses
	 * (`/app/<name>/`), and back `{ tickets, expires }`, a ticket for each path that can have one. Only
	 * for the person or a site, in the `Authorization` header.
	 */
	api.post("/tickets", (req: Request, res: Response) => {
		const id = actsAsPerson(req.principal) ? req.tokenId : undefined;
		if (!id) {
			res.status(401).type("text").send("Tickets are made only for the person's or a paired site's token, in the Authorization header.");
			return;
		}
		const paths = (req.body as { paths?: unknown } | undefined)?.paths;
		if (!Array.isArray(paths) || paths.length > MAX_TICKETS || !paths.every((one) => typeof one === "string")) {
			res.status(400).json({ error: `Send paths, a list of at most ${MAX_TICKETS} board or app paths.` });
			return;
		}
		const now = Date.now();
		const made: Record<string, string> = {};
		for (const given of paths as string[]) {
			const path = ticketPath(given);
			if (path) made[given] = app.tickets.make(path, id, now);
		}
		res.json({ tickets: made, expires: now + TICKET_MS, ...(Object.values(made).length && Object.keys(made).some((one) => isFolderTicket(ticketPath(one) ?? "")) ? { folderExpires: now + FOLDER_TICKET_MS } : {}) });
	});

	return api;
}
