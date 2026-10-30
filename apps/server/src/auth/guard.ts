import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { Principal } from "./principal.ts";
import type { Refusal, TokenStore, Verified } from "./tokens.ts";
import { decodedPath, HARNESS_ID, isAppPass, isCanvasPass, passCovers, splitPathPass, type Passes } from "./passes.ts";

/**
 * The one gate: every request to the harness, and every socket, is let in on a credential, and who is
 * calling is its principal (`principal.ts`), put on the request as `req.principal`.
 *
 * Three kinds of credential: a harness token (`tokens.ts`), whoever acts on the harness as a whole, the
 * person, a paired site or an agent; a canvas pass (`passes.ts`), the canvas frame on one canvas; and an
 * app pass, one app's server, or a tab another site opens the app in (`apps/route.ts`). Where it is:
 * `Authorization: Bearer <credential>`; for a socket, which cannot set headers, `decks_token` in its
 * address; for what an image, a module or a frame loads, a canvas pass in the path,
 * `/api/t/<pass>/board/…`. Nothing else says who is calling: not an `X-Decks-*` header, not reaching the
 * harness from this machine, not being a page on its own address.
 *
 * In front of the gate, in `http.ts`: the names the harness answers to (`hosts.ts`), which goes
 * first, then a forwarded port's and an app's own requests, which are those servers' to answer.
 *
 * What is let in without one:
 * - the doors (`issue.ts`), where tokens are handed out: `/api/hello`, `/api/pair`, `/api/login`; the
 *   opencode plugin's `/api/tokens/session` and the Google Docs tools' `/api/gdocs/call`, which check
 *   opencode's own secret themselves; Google's sign-in coming back (`/api/google/callback`); and the
 *   Decks extension (`/api/web/`), which has its own pairing;
 * - the Decks page and its files, `lib/` and the SDK file: the same for everyone, and the page is
 *   given a harness token only when it is a tab of its own (`issue.ts`).
 *
 * Every file, picture and page of the deck is read on a pass or a token. Everything else without one
 * is refused with 401, and so is every credential that does not check out.
 */

/** The bearer token a request carries in its `Authorization` header. */
export function bearerOf(headers: Record<string, string | string[] | undefined>): string | undefined {
	const header = headers.authorization;
	if (typeof header !== "string" || !header.startsWith("Bearer ")) return undefined;
	return header.slice(7).trim() || undefined;
}

/** The token in an address's `decks_token`: only a socket's, which has nowhere else to put one. */
export function queryTokenOf(url: string | undefined): string | undefined {
	try {
		return new URL(url ?? "/", "http://decks").searchParams.get("decks_token") ?? undefined;
	} catch {
		return undefined;
	}
}

/** The page a request says it came from (`Origin`), or undefined when it says none. */
export function originOf(headers: Record<string, string | string[] | undefined>): string | undefined {
	const origin = headers.origin;
	return typeof origin === "string" && origin !== "" ? origin : undefined;
}

/**
 * Whether a request came from another site, by what the browser says about it.
 *
 * `Sec-Fetch-Site` first: behind `tailscale serve` or any proxy the host the server sees is not the
 * one the page was loaded from. But a browser sends that header only to HTTPS and localhost, so a
 * server on a plain `http://` address hears nothing from it; there the page's `Origin` is compared
 * with the host it asked, which no proxy on such an address rewrites.
 */
export function fromAnotherSite(headers: Record<string, string | string[] | undefined>): boolean {
	const site = headers["sec-fetch-site"];
	if (typeof site === "string") return site === "cross-site" || site === "same-site";
	const origin = headers.origin;
	if (typeof origin !== "string" || origin === "null") return false;
	const forwarded = headers["x-forwarded-host"];
	const host = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ?? headers.host;
	try {
		return new URL(origin).host.toLowerCase() !== String(host ?? "").toLowerCase();
	} catch {
		return true;
	}
}

/** The routes a caller with no token yet must reach to get one, or that check a secret of their own. */
const DOORS = new Set(["/api/hello", "/api/pair", "/api/login", "/api/tokens/session", "/api/gdocs/call", "/api/google/callback"]);

export function isDoor(path: string): boolean {
	return DOORS.has(path) || path.startsWith("/api/web/");
}

/** A path under `/c/<id>/`, another server passed through this one (`share/relay.ts`), as that server will see it. */
function inner(path: string): string {
	const relayed = /^\/c\/[^/]+(\/.*)$/.exec(path);
	return relayed ? relayed[1]! : path;
}

/** The Decks page and its files, the board runtime and the SDK file: the same for every caller. */
export function isPublic(method: string, path: string): boolean {
	if (method !== "GET" && method !== "HEAD") return false;
	const at = inner(path);
	if (!at.startsWith("/api/") && !(path.startsWith("/c/") && at === path)) return true;
	return at.startsWith("/api/lib/") || at === "/api/sdk/decks.mjs";
}

/**
 * The pages and pictures the harness's own Chromium reads, drawing a board, a card or a canvas for a
 * picture (`boards/thumbs.ts`, `stage/shots.ts`): what its own pass reaches (`passes.ts`, made for no
 * canvas by the harness), GETs alone. No one else reads any of these without a pass or a token.
 */
const OWN_READS = /^\/api\/(?:(?:board|f|thumb|stage-thumb|stage-pen|avatar|revision|google\/image)\/.+|file|pen-file|apps\/[^/]+(?:\/log|\/seen)?)$/;

export function harnessReads(method: string, path: string): boolean {
	return (method === "GET" || method === "HEAD") && OWN_READS.test(path);
}

/** What a refused request is told, by why. */
export function refusal(reason: Refusal | "none"): string {
	switch (reason) {
		case "elsewhere":
			return "This pairing token was given to a page on another site, so it does not work from this one. Pair this page with the harness itself.";
		case "expired":
			return "This token went unused too long and has stopped working. Sign in again: reload the Decks tab, run decks login, or pair again.";
		case "unknown":
			return "This harness did not give out that token, or has taken it back. Sign in again: reload the Decks tab, run decks login, or pair again.";
		default:
			return "Every request to this harness carries a token (Authorization: Bearer …). The Decks tab has one; a terminal gets one with decks login; another site pairs.";
	}
}

/**
 * What a canvas pass may ask for (`passes.ts`): the verbs (`POST /api/v1/<verb>`, which the router keeps
 * to that canvas's own calls, `verbs/router.ts`), their list, the canvas's stream (`/api/v1/events`,
 * kept to that canvas), its drawing (`/api/stage-pen/<canvas>`), whether it still works, its files and
 * pictures (`passCovers`), and what an app item on it shows of its app (`/api/apps/<name>`). Nothing
 * of the person's, no other canvas, nothing passed on.
 */
export function canvasMay(method: string, path: string, canvas: string, placed: (deckPath: string) => boolean = () => false): boolean {
	const read = method === "GET" || method === "HEAD";
	if (method === "POST" && /^\/api\/v1\/[^/]+$/.test(path)) return path !== "/api/v1/events";
	if (read && (path === "/api/v1" || path === "/api/v1/events")) return true;
	if (read && path.startsWith("/api/stage-pen/")) return decodedSegment(path.slice("/api/stage-pen/".length)) === canvas;
	if (path === "/api/session") return true;
	// A card on its canvas written out for the harness's Chrome to draw (`/api/snapshot`, which checks the card is on it).
	if (method === "POST" && path === "/api/snapshot") return true;
	if (read && /^\/api\/apps\/[^/]+$/.test(path)) return true;
	if (path.startsWith("/c/")) return false;
	if (read) {
		const decoded = decodedSegment(path);
		if (decoded !== undefined && passCovers(canvas, decoded, placed)) return true;
	}
	return isPublic(method, path);
}

function decodedSegment(segment: string): string | undefined {
	try {
		return decodeURIComponent(segment);
	} catch {
		return undefined;
	}
}

/** What a canvas pass is told when it asks for anything else. */
export const CANVAS_ONLY = "A canvas pass reads and changes its one canvas, and nothing else.";

/** What the gate needs of the harness. */
export interface Gate {
	tokens: Pick<TokenStore, "verify">;
	passes: Pick<Passes, "openCanvas" | "openApp">;
	/** Whether a card or board at this deck path is placed on a canvas (`verbs/router.ts`, `boardOnCanvas`): a canvas pass reads it too. */
	placedOn?(path: string, canvas: string): boolean;
}

/** What a request with a canvas pass that does not check out is told. */
export const PASS_REFUSED = "This canvas pass has run out, was signed out, or no longer reaches this canvas. The page asks for a new one; reload the canvas if it does not.";

/**
 * Who a token is, from the request it came on: refused when another site sends a token that is not
 * for another site. A Decks tab's token, a terminal's, an agent's and an app's are used where they
 * were given, never from a page elsewhere; a site's is bound to its site (`TokenStore.verify`).
 */
export function verifyOn(gate: Pick<Gate, "tokens">, token: string | undefined, headers: Record<string, string | string[] | undefined>): Verified | { ok: false; reason: "kind" } {
	const seen = gate.tokens.verify(token, { origin: originOf(headers) });
	if (seen.ok && fromAnotherSite(headers) && seen.principal.kind !== "site") return { ok: false, reason: "kind" };
	return seen;
}

/** The gate for HTTP. */
export function guard(gate: Gate) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const cross = fromAnotherSite(req.headers);
		/*
		 * Another site's page reads the answer only with CORS, and a public page reaches an address on
		 * your own network only with Chrome's private-network permission. The preflight before a
		 * request carries no token, so it is answered for anyone; the request after it is not.
		 * `/api/web` is the Decks extension, which has its own pairing and is left as it was.
		 */
		if (cross && req.path.startsWith("/api/") && !req.path.startsWith("/api/web/")) {
			const origin = originOf(req.headers);
			if (origin) {
				res.setHeader("Vary", "Origin");
				res.setHeader("Access-Control-Allow-Origin", origin);
				res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Decks-Agent, X-Decks-App, X-Decks-Person, X-Decks-Stage, X-Decks-Edit");
				res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
				res.setHeader("Access-Control-Expose-Headers", "X-Decks-Stand-In, Content-Disposition");
				if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
				if (req.method === "OPTIONS") {
					res.status(204).end();
					return;
				}
			}
		}
		const door = isDoor(req.path);
		const token = bearerOf(req.headers);
		/*
		 * A canvas pass (`passes.ts`): the canvas frame's calls, its stream and its drawing, checked on
		 * every use against the token it was made with and the role on the canvas now. From the frame's
		 * own sandboxed page, which has no origin of its own, so from another site as far as the browser says.
		 */
		if (isCanvasPass(token)) {
			const pass = gate.passes.openCanvas(token);
			if (!pass) {
				res.status(401).type("text").send(PASS_REFUSED);
				return;
			}
			// The harness's own Chromium, reading what it draws for a picture (`harnessReads`): a pass it made for no canvas.
			const own = pass.by === HARNESS_ID && pass.canvas === "" && harnessReads(req.method, req.path);
			if (!own && !canvasMay(req.method, req.path, pass.canvas, (deckPath) => gate.placedOn?.(deckPath, pass.canvas) ?? false)) {
				res.status(403).type("text").send(CANVAS_ONLY);
				return;
			}
			req.principal = { kind: "canvas", canvas: pass.canvas, role: pass.role };
			next();
			return;
		}
		/*
		 * An app's server, on the pass it was started with (`passes.ts`): that app, while that run of it
		 * goes. A program on this machine, never a page: one sent from another site was copied out.
		 */
		if (isAppPass(token)) {
			const pass = gate.passes.openApp(token);
			if (!pass || pass.holder !== "server" || cross) {
				res.status(401).type("text").send("This app pass is not one this harness's app holds now: the app stopped, or this is a tab's. An app's server is given its own as DECKS_TOKEN when it starts.");
				return;
			}
			req.principal = { kind: "app", name: pass.app };
			next();
			return;
		}
		if (token) {
			const seen = verifyOn(gate, token, req.headers);
			if (seen.ok) {
				req.principal = seen.principal;
				req.tokenId = seen.id;
				next();
				return;
			}
			// A door is still open to a token that has run out: that is how a caller gets a new one.
			if (door) {
				next();
				return;
			}
			res.status(401).type("text").send(seen.reason === "kind" ? "This token is for the harness's own pages and programs, not for a page on another site. Pair that site with the harness." : refusal(seen.reason));
			return;
		}
		/*
		 * A canvas pass in the address: one of its canvas's files or pictures, or a card placed on it, for
		 * an image, a module or a sheet that cannot send a header. Checked as a header's would be, the pass
		 * taken out, and the request goes on as the route's own path.
		 */
		const carried = splitPathPass(req.url);
		if (carried && (req.method === "GET" || req.method === "HEAD")) {
			const path = decodedPath(carried.rest);
			const pass = gate.passes.openCanvas(carried.pass);
			if (pass && path !== undefined && passCovers(pass.canvas, path, (deckPath) => gate.placedOn?.(deckPath, pass.canvas) ?? false)) {
				req.url = carried.rest;
				req.principal = { kind: "canvas", canvas: pass.canvas, role: pass.role };
				// The pass in the page's address is not sent on as the Referer of what it loads.
				res.setHeader("Referrer-Policy", "no-referrer");
				/*
				 * Readable by a sandboxed page: the canvas frame fetches its cards and imports their modules
				 * with `Origin: null`. The pass in the address is the credential, and what it admits is the
				 * canvas's own files, which that frame shows anyway. A board picture's stand-in mark too, or the
				 * frame keeps the stand-in and never asks again for the picture (`render/engine.ts`).
				 */
				res.setHeader("Access-Control-Allow-Origin", "*");
				res.setHeader("Access-Control-Expose-Headers", "X-Decks-Stand-In, Content-Disposition");
				next();
				return;
			}
			res.status(401).type("text").send(PASS_REFUSED);
			return;
		}
		// Every file and picture is read on a pass or a token: nothing but the doors and the public page without.
		if (door || isPublic(req.method, req.path)) {
			next();
			return;
		}
		res.status(401).type("text").send(refusal("none"));
	};
}

/**
 * The gate for a socket at `/ws`, which runs the person's commands: only the person's token or a
 * site's, from `decks_token` in its address or a bearer header. Answers the principal, or nothing.
 */
export function socketPrincipal(gate: Pick<Gate, "tokens">, request: IncomingMessage): Principal | undefined {
	const token = queryTokenOf(request.url) ?? bearerOf(request.headers);
	const seen = verifyOn(gate, token, request.headers);
	if (!seen.ok) return undefined;
	return seen.principal.kind === "person" || seen.principal.kind === "site" ? seen.principal : undefined;
}
