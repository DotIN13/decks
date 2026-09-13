import { existsSync, readFileSync, statSync } from "node:fs";
import { renderShell } from "./boards/shell.ts";
import { normalizeBoardPath } from "./deck/schema.ts";
import { readFlowMeta } from "./deck/meta.ts";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheControlFor, compressedStatic } from "./static.ts";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { MAX_UPLOAD_BYTES } from "@decks/protocol";
import { fileUrl, PathRefused, resolveFileRequest, resolveInDeck } from "./deck/roots.ts";
import { browse } from "./files/browse.ts";
import { assetHeaders, boardHeaders, quarantine } from "./files/serve.ts";
import { refuseCrossSite, storeAsset, UploadRefused } from "./files/upload.ts";
import type { App } from "./app.ts";

/**
 * The HTTP surface: reading files, writing one kind of file, and the built UI.
 *
 * Almost everything that *changes* something goes over the WebSocket, because the
 * socket is where state lives — but bytes are not state. A file the user drags in
 * from the desktop has to arrive as a body on a request (`POST /api/upload`), so
 * this file does have one mutating route, and it is the only way anything in Decks
 * writes a file the user did not name.
 *
 * The routes that turn a URL into a file, plus that one, are the security boundary
 * of the whole app. Every one of them asks `deck/roots.ts` where the path may go
 * and nothing else makes that decision. The upload route adds its own guards, all
 * in `files/upload.ts`: a size cap refused before the body is buffered, a name
 * derived rather than trusted, a refusal to overwrite, and one `Sec-Fetch-Site`
 * check so it is not the easiest way in. What it does not add is authentication —
 * there is none anywhere (DEPLOYMENT §1), and `/ws` next door already runs tool
 * calls for whoever asks, which is what bounds how much this route could matter.
 */

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
	return (req: Request, res: Response, next: NextFunction) => {
		handler(req, res).catch(next);
	};
}

/**
 * Whether a deck-relative path is a board, as opposed to a file a board uses.
 *
 * Answered from the shape of the path rather than by asking the open deck, on
 * purpose: a board written a moment ago is on disk before the watcher has told the
 * deck about it, and a board served as an asset would lose the origin the editor
 * needs — a wrong answer that reads as "editing stopped working".
 */
function isBoardPath(requested: string): boolean {
	return /^boards\/[^\0]*\.x?html?$/i.test(requested.split("\\").join("/").replace(/^\/+/, ""));
}

/** The wildcard segment of `/api/board/*path`, as one forward-slashed string. */
function wildcard(req: Request): string {
	const raw = (req.params as Record<string, string | string[]>).path;
	return Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
}

export function createHttpApp(app: App): Express {
	const server = express();
	server.disable("x-powered-by");
	server.use(express.json({ limit: "8mb" }));

	const api = express.Router();

	api.get("/deck", (_req, res) => {
		res.json({ deck: app.deck.state(), warnings: app.deck.warnings });
	});

	/**
	 * A board, for the frame it renders in — same origin, no sandbox (§4).
	 *
	 * Path-shaped rather than a query parameter so a board's own relative
	 * references resolve: `../lib/board.css` beside a board asks for the sibling
	 * URL and lands back here, on the same guard.
	 */
	api.get(
		"/board/*path",
		asyncRoute(async (req, res) => {
			const requested = wildcard(req);
			const target = resolveInDeck(app.deck.path, requested);
			if (!existsSync(target) || !statSync(target).isFile()) throw new PathRefused(requested, "not a file");
			/*
			 * This route serves the whole deck, not only its boards — a board's own
			 * `../assets/photo.png` and `../lib/board.css` resolve to sibling URLs and
			 * land here. A *board* is what gets the app's origin (§4); everything else
			 * gets the asset treatment, which sandboxes anything a browser would run.
			 * That distinction started mattering the day the user could drop an HTML
			 * file onto a board and have it stored in `assets/`.
			 */
			if (isBoardPath(requested)) boardHeaders(res);
			else assetHeaders(res, target);

			/*
			 * A board that is not a document gets one made for it.
			 *
			 * Two kinds of file need that, and `board.shell` names which: a `.md` is content
			 * rather than a document, and an HTML page from somewhere else has to be wrapped
			 * so it can be put in a *sandboxed* frame. Everything this app writes — a
			 * component board, a flow board, an HTML deck — is already a document and falls
			 * straight through to the file.
			 *
			 * The board record is what decides, because it already knows the format, the size
			 * and the title; re-deriving them here would be a second opinion that can differ
			 * from the one the canvas laid the board out with.
			 *
			 * Anything the deck knows nothing about — an asset, `lib/board.css` — falls
			 * through as well, which is what every non-board request is.
			 */
			/*
			 * `?raw=1` is the shell asking for the file it wraps.
			 *
			 * Without it the shell — which is served at this very URL — would be what its
			 * own embed fetched, and the board would render empty with nothing in any log to
			 * say why. One query parameter rather than a second route, so the reference in
			 * the shell stays *relative* and a nested board resolves its own sibling.
			 */
			const board = req.query.raw === undefined ? app.deck.board(normalizeBoardPath(requested)) : undefined;
			/*
			 * `format !== "component"` is a narrowing rather than a second condition: a board
			 * that needs a shell is never a component board — `shellFor` only answers for a
			 * `.md` file or an HTML page with no board class, and `formatOf` calls both of
			 * those flow. Written out so the compiler knows it too.
			 */
			if (board?.shell && board.format !== "component") {
				res.type("html").send(
					renderShell({
						path: board.path,
						format: board.format,
						shell: board.shell,
						title: board.title,
						w: board.w,
						h: board.h,
						// The fullscreen overlay asks for the same board and wants it to fill the
						// window instead of its own rectangle.
						...(req.query.present === undefined ? {} : { present: true }),
						...(aspectOf(app.deck, board.path) ? { aspect: aspectOf(app.deck, board.path) as string } : {}),
					}),
				);
				return;
			}
			await sendFile(res, target);
		}),
	);

	/**
	 * The board primitives, reachable from a document not served under `/board`.
	 *
	 * A revision preview is served at `/api/revision/<sha>`, so the `../lib/board.css` in
	 * its own markup resolves to `/api/lib/board.css` — not to `/api/board/lib/board.css`,
	 * where the deck's copy lives. Without this alias a previewed board arrived as unstyled
	 * HTML with `board.js` missing, so the time machine looked like it worked (the text was
	 * right) while showing nothing like the board it was previewing.
	 */
	api.get(
		"/lib/*path",
		asyncRoute(async (req, res) => {
			const target = resolveInDeck(app.deck.path, join("lib", wildcard(req)));
			if (!existsSync(target) || !statSync(target).isFile()) throw new PathRefused(wildcard(req), "not a file");
			boardHeaders(res);
			await sendFile(res, target);
		}),
	);

	/**
	 * A file from outside the deck — asked for by path, answered with a redirect.
	 *
	 * The redirect is the interesting part. A browser deletes `..` segments from a
	 * URL path before the request is sent (and treats `%2e%2e` the same way), so a
	 * relative path cannot survive the trip inside the URL — it arrives here in a
	 * query parameter instead, where nothing rewrites it, and leaves as the
	 * absolute path it resolved to. From then on the URL is path-shaped, which is
	 * what makes a foreign page's own relative references land back on this guard.
	 *
	 * `from` is the board that asked, so a relative path means what it would mean
	 * in an `<img src>` on that board.
	 */
	api.get("/file", (req, res) => {
		const path = typeof req.query.path === "string" ? req.query.path : "";
		const from = typeof req.query.from === "string" ? req.query.from : undefined;
		const target = resolveFileRequest(app.deck.roots, { path, from });
		if (!existsSync(target) || !statSync(target).isFile()) throw new PathRefused(path, "not a file");
		// 302 rather than 301: which file a relative path resolves to depends on the
		// deck that is open, and that changes.
		res.redirect(302, fileUrl(target));
	});

	/** The resolved file itself, at its absolute path — read-only and quarantined (§4). */
	api.get(
		"/f/*path",
		asyncRoute(async (req, res) => {
			const requested = `/${wildcard(req)}`;
			const target = resolveFileRequest(app.deck.roots, { path: requested });
			if (!existsSync(target) || !statSync(target).isFile()) throw new PathRefused(requested, "not a file");
			quarantine(res, target);
			await sendFile(res, target);
		}),
	);

	/**
	 * An agent's avatar, which the agent drew itself (§6.2).
	 *
	 * Stored under the deck's `.decks/` so it travels with the deck, and served with
	 * the quarantine headers: it is an SVG, and an SVG is a scriptable document to a
	 * browser even when it is only ever going to be an <img>.
	 */
	api.get(
		"/avatar/:id",
		asyncRoute(async (req, res) => {
			const id = String(req.params.id).replace(/[^\w-]/g, "");
			const target = resolveInDeck(app.deck.path, join(".decks", "avatars", `${id}.svg`));
			if (!existsSync(target)) throw new PathRefused(id, "no avatar for that agent");
			quarantine(res, target);
			await sendFile(res, target);
		}),
	);

	/**
	 * One past version of a board, by content hash (§6.7).
	 *
	 * This is what lets the timeline show what a board looked like at a point in the
	 * conversation without writing anything: the frame loads a revision instead of
	 * the file. Same quarantine headers as any other stored document.
	 */
	api.get(
		"/revision/:sha",
		asyncRoute(async (req, res) => {
			const sha = String(req.params.sha);
			if (!app.boards.revisions.has(sha)) throw new PathRefused(sha, "no such revision");
			res.setHeader("X-Content-Type-Options", "nosniff");
			// Immutable by construction: the name is the hash of the contents.
			res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
			res.type("html").send(app.boards.revisions.read(sha));
		}),
	);

	api.get("/browse", (req, res) => {
		const path = typeof req.query.path === "string" && req.query.path.length > 0 ? req.query.path : undefined;
		res.json(browse(app.deck.roots, path));
	});

	/**
	 * A file the user dropped onto a board, copied into the deck's `assets/` (§3).
	 *
	 * One file per request, its bytes as the body and its name in the query. Not
	 * `multipart/form-data`: a raw body needs no parser and therefore no parser
	 * dependency, and one request per file is what lets the browser report progress
	 * per file and land each one as its own component.
	 *
	 * `express.raw` is where the cap is enforced, and it enforces it twice — it
	 * refuses on `Content-Length` before reading anything, and again on the stream
	 * for a chunked body that lied. Either way the answer is a 413 with a sentence,
	 * not a truncated file.
	 */
	api.post(
		"/upload",
		express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
		(req, res) => {
			refuseCrossSite(typeof req.headers["sec-fetch-site"] === "string" ? req.headers["sec-fetch-site"] : undefined);
			const name = typeof req.query.name === "string" ? req.query.name : "";
			const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
			res.json(storeAsset(app.deck.path, name, bytes));
		},
	);

	/**
	 * The canvas tool, for a runtime that is not in this process (`stage/bridge.ts`).
	 *
	 * opencode's TypeScript tool and antigravity's Python one both end up here, and the
	 * two name themselves differently. Antigravity still holds a token minted per agent;
	 * opencode now shares one server with every other opencode agent, so its tool sends
	 * the session id opencode gave it and the bridge resolves *that* to an agent — with
	 * the shared server's single token in the header proving the caller is the process
	 * Decks spawned. Either way there is no agent id in the URL to get wrong, and a call
	 * from a process that has outlived its agent is refused by the identity rather than
	 * by a guess about who it is.
	 *
	 * `200` even for a failed run, because a tool that failed is not a transport that
	 * failed: the model is supposed to read the message and try something else, and an
	 * HTTP error would be swallowed by whichever client library is between us.
	 */
	api.post("/stage/eval", (req, res) => {
		const header = req.headers.authorization;
		const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
		const body = (req.body ?? {}) as { code?: unknown; sessionID?: unknown };
		const code = typeof body.code === "string" ? body.code : "";
		const sessionID = typeof body.sessionID === "string" ? body.sessionID : undefined;
		void app.bridge.run(token, code, sessionID).then((outcome) => res.json(outcome));
	});

	server.use("/api", api);

	// The built UI, when there is one. In development Vite serves it instead and
	// proxies here, so a missing dist is normal rather than an error.
	const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
	if (existsSync(webDist)) {
		// Compressed and cached by name first (`static.ts`); anything it passes on is sent plain,
		// with the same cache rule.
		server.use(compressedStatic(webDist));
		server.use(
			express.static(webDist, {
				setHeaders: (res, file) => res.setHeader("Cache-Control", cacheControlFor(file.slice(webDist.length).split(sep).join("/"))),
			}),
		);
		server.get("*any", (_req, res) => {
			res.setHeader("Cache-Control", "no-cache");
			res.sendFile(join(webDist, "index.html"));
		});
	}

	// One error handler, because a refusal should read the same wherever it came
	// from: 403 for a path we would not serve, 404 for one that is not there.
	server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
		if (error instanceof PathRefused) {
			res.status(403).type("text/plain").send(error.message);
			return;
		}
		if (error instanceof UploadRefused) {
			res.status(error.status).type("text/plain").send(error.message);
			return;
		}
		// Body-parser's own refusal. Mapped rather than left to fall through, because a
		// file over the cap is a 413 the browser can explain, not a 500 that reads as a
		// crash.
		if ((error as { type?: string }).type === "entity.too.large") {
			res.status(413).type("text/plain").send(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`);
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const code = /ENOENT/.test(message) ? 404 : 500;
		if (code === 500) console.error("[decks]", error);
		res.status(code).type("text/plain").send(message);
	});

	return server;
}

function sendFile(res: Response, target: string): Promise<void> {
	return new Promise((ok, fail) => {
		res.sendFile(target, { acceptRanges: true, dotfiles: "allow" }, (error) => (error ? fail(error) : ok()));
	});
}


/**
 * A deck's declared aspect, read from the file rather than carried on the board record.
 *
 * It is only wanted at the moment a shell is rendered, and the board record is a thing the
 * whole app holds in memory — a field that one route reads once does not belong on it.
 */
function aspectOf(deck: { path: string }, boardPath: string): string | undefined {
	try {
		return readFlowMeta(boardPath, readFileSync(join(deck.path, boardPath), "utf8")).aspect;
	} catch {
		return undefined;
	}
}
