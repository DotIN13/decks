import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { Principal } from "./principal.ts";
import type { Refusal, TokenStore, Verified } from "./tokens.ts";
import { decodedPath, splitPathTicket, ticketOf, type Tickets } from "./tickets.ts";

/**
 * The one gate: every request to the harness, and every socket, is let in on its token, and who is
 * calling is that token's principal (`principal.ts`), put on the request as `req.principal`.
 *
 * Where the token is: `Authorization: Bearer <token>`; for a socket, which cannot set headers,
 * `decks_token` in its address; for one page another site opens in a frame or a tab, a ticket
 * (`decks_ticket`, GET only, for its one path). Nothing else says who is calling: not an
 * `X-Decks-*` header, not reaching the harness from this machine, not being a page on its own address.
 *
 * In front of the gate, in `http.ts`: the names the harness answers to (`hosts.ts`), which goes
 * first, then a forwarded port's and an app's own requests, which are those servers' to answer.
 *
 * What is let in without a token:
 * - the doors (`issue.ts`), where tokens are handed out: `/api/hello`, `/api/pair`,
 *   `/api/studio/connect`, `/api/login`; the opencode plugin's `/api/tokens/session` and the
 *   Google Docs tools' `/api/gdocs/call`, which check opencode's own secret themselves; Google's
 *   sign-in coming back (`/api/google/callback`); and the Decks extension (`/api/web/`), which has
 *   its own pairing;
 * - the Decks page and its files, `lib/` and the SDK file: the same for everyone, and the page is
 *   given a person token only when it is a tab of its own (`issue.ts`);
 * - until boards and files move to their own address (step 4 of the token redesign), the pages a
 *   frame or a picture loads, which cannot carry a header: a board, a file, a picture, an avatar, a
 *   revision, and the app status a board's bar reads. Only to a request that does not come from
 *   another site, as before; they name no caller and give no commands.
 *
 * Everything else without a token is refused with 401, and so is every token that does not check
 * out.
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
const DOORS = new Set(["/api/hello", "/api/pair", "/api/studio/connect", "/api/login", "/api/tokens/session", "/api/gdocs/call", "/api/google/callback"]);

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
 * The pages a frame, a picture or a board's own script loads, which cannot carry a header: let in
 * without a token until they are served from their own address (step 4).
 */
const PAGES = /^\/api\/(?:(?:board|f|thumb|stage-thumb|avatar|revision|google\/image)\/.+|file|apps\/[^/]+(?:\/log|\/seen)?)$/;

export function isPageRead(method: string, path: string): boolean {
	return (method === "GET" || method === "HEAD") && PAGES.test(inner(path));
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
 * What a board's token may ask for: its verbs (`POST /api/v1/<verb>`, which act as that board,
 * `verbs/router.ts`), the list of them, whether it still works (`/api/session`), and the pages
 * anyone's frame may read. Nothing that is the person's (settings, uploads, agents, tickets, other
 * tokens), and nothing passed on to another server (`/c/<id>/`): a board's page is handed its token
 * by the page that framed it (`@decks/canvas/internal/board-host.ts`), and that token is the board and no more.
 */
export function boardMay(method: string, path: string): boolean {
	if (method === "POST" && /^\/api\/v1\/[^/]+$/.test(path)) return true;
	if ((method === "GET" || method === "HEAD") && path === "/api/v1") return true;
	if (path === "/api/session") return true;
	if (path.startsWith("/c/")) return false;
	return isPublic(method, path) || isPageRead(method, path);
}

/**
 * What a canvas frame's token may ask for: the verbs (`POST /api/v1/<verb>`, which the router keeps
 * to that canvas's own calls, `verbs/router.ts`), their list, the canvas's stream (`/api/v1/events`,
 * kept to that canvas), its drawing (`/api/stage-pen/<canvas>`), whether it still works, and the
 * pages anyone's frame may read. Nothing of the person's, no other canvas, nothing passed on.
 */
export function canvasMay(method: string, path: string, canvas: string): boolean {
	if (method === "POST" && /^\/api\/v1\/[^/]+$/.test(path)) return path !== "/api/v1/events";
	if ((method === "GET" || method === "HEAD") && (path === "/api/v1" || path === "/api/v1/events")) return true;
	if ((method === "GET" || method === "HEAD") && path.startsWith("/api/stage-pen/")) return decodedSegment(path.slice("/api/stage-pen/".length)) === canvas;
	if (path === "/api/session") return true;
	// A card on its canvas written out for the harness's Chrome to draw (`/api/snapshot`, which checks the card is on it).
	if (method === "POST" && path === "/api/snapshot") return true;
	if (path.startsWith("/c/")) return false;
	return isPublic(method, path) || isPageRead(method, path);
}

function decodedSegment(segment: string): string | undefined {
	try {
		return decodeURIComponent(segment);
	} catch {
		return undefined;
	}
}

/** What a canvas frame's token is told when it asks for anything else. */
export const CANVAS_ONLY = "A canvas frame's token reads and changes its one canvas, and nothing else.";

/** What a board's token is told when it asks for anything else. */
export const BOARD_ONLY = "A board's token calls verbs as that board, and nothing else: not the person's routes, and not another token.";

/** A board's token another server gave out, on its way there through this one (`share/relay.ts`). */
export function relayedBoardToken(path: string, token: string): boolean {
	return path.startsWith("/c/") && token.startsWith("dk_b_");
}

/** What the gate needs of the harness. */
export interface Gate {
	tokens: Pick<TokenStore, "verify">;
	tickets: Pick<Tickets, "admits">;
}

/**
 * Who a token is, from the request it came on: refused when another site sends a token that is not
 * for another site. A Decks tab's token, a terminal's, an agent's and an app's are used where they
 * were given, never from a page elsewhere; a site's is bound to its site (`TokenStore.verify`).
 */
export function verifyOn(gate: Pick<Gate, "tokens">, token: string | undefined, headers: Record<string, string | string[] | undefined>): Verified | { ok: false; reason: "kind" } {
	const seen = gate.tokens.verify(token, { origin: originOf(headers) });
	if (seen.ok && fromAnotherSite(headers) && seen.principal.kind !== "site" && seen.principal.kind !== "board" && seen.principal.kind !== "canvas") return { ok: false, reason: "kind" };
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
		if (token) {
			const seen = verifyOn(gate, token, req.headers);
			if (seen.ok) {
				if (seen.principal.kind === "board" && !boardMay(req.method, req.path)) {
					res.status(403).type("text").send(BOARD_ONLY);
					return;
				}
				if (seen.principal.kind === "canvas" && !canvasMay(req.method, req.path, seen.principal.canvas)) {
					res.status(403).type("text").send(CANVAS_ONLY);
					return;
				}
				req.principal = seen.principal;
				req.tokenId = seen.id;
				next();
				return;
			}
			/*
			 * A board on another server this page reaches through this one, calling that server with the
			 * token it gave: passed on as itself, not as this server's connection (`share/relay.ts`), so it
			 * is that board there and nobody here.
			 */
			if (relayedBoardToken(req.path, token)) {
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
		 * A friend's board, sandboxed, loading what it is made of on the folder ticket in its address
		 * (`tickets.ts`): the ticket taken out, and the request goes on as the route's own path.
		 */
		const carried = splitPathTicket(req.url);
		if (carried && (req.method === "GET" || req.method === "HEAD")) {
			const path = decodedPath(carried.rest);
			if (path !== undefined && gate.tickets.admits(carried.ticket, path)) {
				req.url = carried.rest;
				req.principal = { kind: "page", path } satisfies Principal;
				res.setHeader("Referrer-Policy", "no-referrer");
				/*
				 * Readable by a sandboxed page: the canvas frame fetches its cards and imports their modules
				 * with `Origin: null`. The ticket in the address is the credential, and what it admits is the
				 * canvas's own files, which that frame shows anyway.
				 */
				res.setHeader("Access-Control-Allow-Origin", "*");
				next();
				return;
			}
			res.status(401).type("text").send("This page's ticket has run out, or is not for this file. Reload the canvas.");
			return;
		}
		// One page another site opened in a frame or a tab, by its ticket; it sends no Referer on.
		const ticket = ticketOf(req.originalUrl);
		if ((req.method === "GET" || req.method === "HEAD") && ticket !== undefined) {
			const path = decodedPath(req.originalUrl);
			if (path !== undefined && gate.tickets.admits(ticket, path)) {
				req.principal = { kind: "page", path } satisfies Principal;
				res.setHeader("Referrer-Policy", "no-referrer");
				next();
				return;
			}
		}
		if (door || isPublic(req.method, req.path) || (!cross && isPageRead(req.method, req.path))) {
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
