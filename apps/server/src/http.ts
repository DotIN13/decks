import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { renderShell } from "./boards/shell.ts";
import { LIB_FOREVER, libVersion, splitLibVersion, versionLibRefs } from "./deck/lib-version.ts";
import { normalizeBoardPath } from "./deck/schema.ts";
import { readMeta } from "./deck/meta.ts";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheControlFor, compressedStatic } from "./static.ts";
import { forwardRequest } from "./ports.ts";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { MAX_UPLOAD_BYTES } from "@decks/protocol";
import { fileUrl, PathRefused, resolveFileRequest, resolveInDeck } from "./deck/roots.ts";
import { browse } from "./files/browse.ts";
import { filePreview, previewKind } from "./files/preview.ts";
import { assetHeaders, boardHeaders, quarantine } from "./files/serve.ts";
import { refuseCrossSite, storeAssetStream, UploadRefused, withMedia } from "./files/upload.ts";
import { renderSnapshot } from "./boards/snapshot.ts";
import { pictureType, SMALL_WIDTHS } from "./boards/thumbs.ts";
import type { App } from "./app.ts";
import type { ServerMessage } from "@decks/protocol";
import { buildBundle, bundleFileName } from "./share/bundle.ts";
import { fromAnotherSite, fromPrivateNetwork, tokenOf } from "./share/pairing.ts";
import { Relay } from "./share/relay.ts";

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
	// The deck's `boards/`, or a stage's own board folder (`deck/stage-boards.ts`): both are boards.
	return /^(?:boards|stages\/[^/\0]+\/boards)\/[^\0]*\.x?html?$/i.test(requested.split("\\").join("/").replace(/^\/+/, ""));
}

/** The wildcard segment of `/api/board/*path`, as one forward-slashed string. */
function wildcard(req: Request): string {
	const raw = (req.params as Record<string, string | string[]>).path;
	return Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
}

export function createHttpApp(app: App): Express {
	const server = express();
	server.disable("x-powered-by");
	/*
	 * Forwarded ports first (`ports.ts`), before any body is read: the request is somebody
	 * else's server's, and a JSON parser here would eat the body it is waiting for.
	 */
	server.use((req, res, next) => {
		if (!forwardRequest(req, res, app.forwards)) next();
	});
	server.use(express.json({ limit: "8mb" }));

	/*
	 * Another Decks, served from another site, using this server (`share/pairing.ts`).
	 *
	 * This server's own front end is untouched: its requests are same-origin and go straight on.
	 * A request from another site is let through only with a paired token, and then with the
	 * headers that let that site read the answer: CORS, and Chrome's private-network permission,
	 * which a public page needs to call an address on your own network. The preflight before a
	 * request carries no token, so it is answered for anyone; the request after it is not.
	 * `/api/web` is the Decks extension, which has its own pairing and is left as it was.
	 */
	server.use((req, res, next) => {
		const origin = req.headers.origin;
		if (!origin || !req.path.startsWith("/api/") || req.path.startsWith("/api/web/") || !fromAnotherSite(req.headers)) {
			next();
			return;
		}
		res.setHeader("Vary", "Origin");
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Expose-Headers", "X-Decks-Stand-In, Content-Disposition");
		if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
		if (req.method === "OPTIONS") {
			res.status(204).end();
			return;
		}
		if (req.path === "/api/pair" || req.path === "/api/hello" || app.pairing.check(tokenOf(req.headers, req.originalUrl))) {
			next();
			return;
		}
		res.status(401).type("text").send("This Decks has not been paired with that server. Ask it for a pairing code in its Settings.");
	});

	const api = express.Router();
	const relay = new Relay(join(app.deck.path, ".decks", "relay.json"));
	server.all("/c/:id/*rest", asyncRoute((req, res) => relay.pass(req, res)));

	/**
	 * Trade a pairing code for a token: the one route another site may call without one. Answered
	 * with the deck's name, which is what the other front end will call this server.
	 */
	api.post("/pair", (req, res) => {
		const body = (req.body ?? {}) as { code?: unknown; label?: unknown };
		const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
		const origin = String(req.headers.origin ?? "");
		const label = typeof body.label === "string" ? body.label : "";
		// No code from this machine or a private network; over the internet, only with one.
		if (!code && !fromPrivateNetwork(req.socket.remoteAddress, req.headers)) {
			res.status(403).json({ needsCode: true, error: "This server is reached over the internet, so it needs a pairing code. Make one in its Settings, under Other Decks." });
			return;
		}
		const token = code ? app.pairing.redeem(code, origin, label) : app.pairing.grant(origin, label);
		if (!token) {
			res.status(403).json({ needsCode: true, error: "That code is wrong or has expired. Make a new one in the server's Settings." });
			return;
		}
		app.send(app.pairingMessage());
		res.json({ token, name: app.deck.name });
	});

	/**
	 * Pass another server through this one, for a page with no service worker (`share/relay.ts`).
	 * The page names the connection and its token; `/c/<id>/...` below is then that server's.
	 */
	api.post("/relay", (req, res) => {
		const body = (req.body ?? {}) as { id?: unknown; base?: unknown; token?: unknown };
		const refused = typeof body.id === "string" && typeof body.base === "string" && typeof body.token === "string" ? relay.register(body.id, body.base, body.token) : "Name the connection, its address and its token.";
		if (refused) {
			res.status(400).json({ error: refused });
			return;
		}
		res.json({ ok: true });
	});

	/**
	 * Whether this is a Decks server, and which: what the switcher's reachability dot asks. Open to
	 * any site, since it says nothing but the name; `paired` says whether the token sent still works.
	 */
	api.get("/hello", (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json({ decks: true, name: app.deck.name, paired: app.pairing.check(tokenOf(req.headers, req.originalUrl)) });
	});

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
			let requested = wildcard(req);
			// The runtime at a versioned address (`deck/lib-version.ts`): the file is the one in `lib/`.
			const versioned = requested.startsWith("lib/") ? splitLibVersion(requested.slice(4)) : undefined;
			if (versioned) requested = `lib/${versioned.file}`;
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
			if (versioned?.version === libVersion(app.deck.path)) res.setHeader("Cache-Control", LIB_FOREVER);

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
			// A board that has to be rendered *into* a document: a `.md`, a deck, or a page
			// from somewhere else (`deck/kinds.ts`).
			if (board?.shell) {
				res.type("html").send(
					versionLibRefs(renderShell({
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
					}), libVersion(app.deck.path)),
				);
				return;
			}
			// A board's page, with its runtime at the versioned address; the file itself is untouched,
			// and `?raw=1` (its text, for the editor) is the file as it is.
			if (req.query.raw === undefined && isBoardPath(requested) && /\.html?$/i.test(requested)) {
				res.type("html").send(versionLibRefs(await readFile(target, "utf8"), libVersion(app.deck.path)));
				return;
			}
			/*
			 * `?guest=1` is a board that is this web page (`data-bare`, `renderFileBoard`) asking for it
			 * with `lib/embed-guest.js` in it: the page then takes the scrolls it can use and hands the
			 * rest, and every pinch, to the canvas, as a board's own page does, with no click first.
			 * Still the asset's headers, so still sandboxed; the script is ours and reads nothing back.
			 */
			if (req.query.guest !== undefined && !isBoardPath(requested) && /\.html?$/i.test(requested)) {
				res.type("html").send(withGuest(await readFile(target, "utf8"), `${"../".repeat(requested.split("/").length - 1)}lib/embed-guest.js`));
				return;
			}
			await sendFile(res, target);
		}),
	);

	/** How far the server has got keeping a picture of every board (`ThumbService.index`), for the ⋯ menu. */
	api.get("/pictures", (_req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(app.thumbs.progress());
	});

	/**
	 * A picture of a board, for the panel's thumbnails (`boards/thumbs.ts`).
	 *
	 * The answer waits for the picture: an `<img>` has no way to be told "later", and a
	 * request that is held is what lets the newest-first queue know who is still looking.
	 * `v` is the revision the browser knows, and it is only there to make the URL a new one
	 * when the board changes, which is what allows the year of caching: the picture served is
	 * always of the board as it is now. 503 when there is no Chromium here, 404 for no such
	 * board; the gallery draws its plain tile for either.
	 */
	api.get(
		"/thumb/*path",
		asyncRoute(async (req, res) => {
			const board = app.deck.board(normalizeBoardPath(wildcard(req)));
			if (!board) {
				res.status(404).end();
				return;
			}
			let gone = false;
			res.on("close", () => (gone = !res.writableEnded));
			try {
				const scheme = req.query.scheme === "dark" ? "dark" : "light";
				const kind = req.query.whole === "1" ? "whole" : "card";
				// A smaller copy of a whole picture, for a canvas zoomed out (`SMALL_WIDTHS`).
				const width = Number(req.query.w);
				const small = kind === "whole" && SMALL_WIDTHS.includes(width) ? width : undefined;
				const send = async (file: string) => {
					res.type(file.endsWith(".webp") ? "webp" : "jpeg");
					await sendFile(res, file);
				};
				if (kind === "card") {
					const file = await app.thumbs.get(board, scheme, () => gone, kind);
					if (gone) return;
					res.setHeader("Cache-Control", req.query.v === String(board.rev) ? "private, max-age=31536000, immutable" : "no-cache");
					await send(file);
					return;
				}
				/*
				 * A board's picture for the canvas: the one asked for when it is on disk; otherwise
				 * whatever the board has that is nearest (another size, an earlier revision) at once,
				 * not cached and said to be a stand-in so the canvas asks again (`pen/scene.ts`), with
				 * the one asked for made ahead of the background's work. Only a board with no picture at
				 * all waits. Not for a gallery card: an `<img>` would keep the stand-in.
				 */
				const size = small ?? "whole";
				app.thumbs.asked(scheme, "whole");
				const near = app.thumbs.nearest(board, scheme, size);
				if (near && !near.exact) {
					app.thumbs.picture(board, scheme, size).catch(() => {});
					res.setHeader("Cache-Control", "no-store");
					res.setHeader("X-Decks-Stand-In", "1");
					await send(near.file);
					return;
				}
				const file = near?.file ?? (await app.thumbs.picture(board, scheme, size, () => gone));
				if (gone) return;
				res.setHeader("Cache-Control", req.query.v === String(board.rev) ? "private, max-age=31536000, immutable" : "no-cache");
				await send(file);
			} catch (error) {
				if (!gone) res.status(503).type("text").send((error as Error).message);
			}
		}),
	);

	/**
	 * A picture of a whole stage, for the manager's cards (`stage/shots.ts`).
	 *
	 * The board thumbnails' bargain, one level up: the request waits for the picture because an
	 * `<img>` cannot be told "later", `v` is the drawing's revision and is what makes the URL new
	 * when the stage changes, and a year of caching is safe because of it. 503 when this machine
	 * has no Chromium, 404 for no such stage; the card draws its plain tile for either.
	 */
	api.get(
		"/stage-thumb/:name",
		asyncRoute(async (req, res) => {
			const shots = app.stage.shots;
			const pens = app.stage.pens;
			const name = String(req.params.name ?? "");
			if (!shots || !pens || !pens.names().includes(name)) {
				res.status(404).end();
				return;
			}
			const scheme = req.query.scheme === "dark" ? "dark" : "light";
			const { rev } = pens.summary(name);
			try {
				const file = await shots.thumb(name, rev, scheme);
				res.setHeader("Cache-Control", req.query.v === String(rev) ? "private, max-age=31536000, immutable" : "no-cache");
				res.type("jpeg");
				await sendFile(res, file);
			} catch (error) {
				res.status(503).type("text").send((error as Error).message);
			}
		}),
	);

	/**
	 * A canvas as one `.decks` file, to download and open in any Decks (`share/bundle.ts`).
	 *
	 * Pictures already taken go in as they are; one not taken yet gets the time left of a shared
	 * minute, and a board without one is drawn from its page when the reader opens it.
	 */
	api.get(
		"/bundle/:name",
		asyncRoute(async (req, res) => {
			const pens = app.stage.pens;
			const name = String(req.params.name ?? "");
			if (!pens || !pens.names().includes(name)) {
				res.status(404).type("text").send("No such canvas.");
				return;
			}
			const frame = pens.frame("", name) as Extract<ServerMessage, { type: "stage.pen" }>;
			const until = Date.now() + 60_000;
			const { bytes } = await buildBundle({
				deckPath: app.deck.path,
				deckName: app.deck.name,
				board: (path) => app.deck.board(path),
				stage: { dir: join(pens.dir, name), title: pens.titleOf(name), rev: frame.rev, doc: frame.doc, boards: pens.boards(name) },
				picture: async (board, scheme) => {
					const near = app.thumbs.nearest(board, scheme, "whole");
					if (near) return near.file;
					const left = until - Date.now();
					if (left <= 0) return undefined;
					return Promise.race([app.thumbs.get(board, scheme, () => false, "whole"), new Promise<undefined>((done) => setTimeout(() => done(undefined), left))]).catch(() => undefined);
				},
			});
			const file = bundleFileName(pens.titleOf(name));
			res.setHeader("Content-Disposition", `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(file)}`);
			res.setHeader("Cache-Control", "no-store");
			res.type("application/zip").send(bytes);
		}),
	);

	/**
	 * One stage, for `shot.html` to draw (`stage/shots.ts`): its `.pen` document, the folder its
	 * image fills are read against, and where each board on it is.
	 */
	api.get("/stage-pen/:name", (req, res) => {
		const pens = app.stage.pens;
		const name = String(req.params.name ?? "");
		if (!pens || !pens.names().includes(name)) {
			res.status(404).end();
			return;
		}
		const frame = pens.frame("", name) as { doc: unknown; base: string };
		res.setHeader("Cache-Control", "no-store");
		res.json({ doc: frame.doc, base: frame.base, boards: pens.boards(name).map(({ path, x, y, w, h }) => ({ path, x, y, w, h })) });
	});

	/**
	 * Any .pen file as `shot.html` draws it: a saved frame, or a stage by its file. `path` is relative
	 * to the deck or absolute (`StagePens.penFile`).
	 */
	api.get("/pen-file", (req, res) => {
		const pens = app.stage.pens;
		if (!pens || typeof req.query.path !== "string") {
			res.status(404).end();
			return;
		}
		try {
			const frame = pens.fileFrame(req.query.path);
			const boards = frame.stage ? pens.boards(frame.stage).map(({ path, x, y, w, h }) => ({ path, x, y, w, h })) : [];
			res.setHeader("Cache-Control", "no-store");
			res.json({ doc: frame.doc, base: frame.base, boards });
		} catch (error) {
			res.status(404).type("text").send((error as Error).message);
		}
	});

	/**
	 * A picture of what is selected on an agent's stage, to download: the drawing's Export
	 * button. `of` is a comma-separated list of item ids, or nothing for the whole stage.
	 */
	api.get(
		"/stage-shot",
		asyncRoute(async (req, res) => {
			const shots = app.stage.shots;
			const agent = app.agents.get(String(req.query.agent ?? ""));
			const stage = agent?.stageName(false);
			if (!shots || !stage) {
				res.status(404).type("text").send("That agent has no stage to picture.");
				return;
			}
			const of = typeof req.query.of === "string" && req.query.of ? req.query.of.split(",") : undefined;
			const format = req.query.format === "jpeg" || req.query.format === "pdf" ? req.query.format : "png";
			try {
				const shot = await shots.take({ stage, of, format, scale: 2, scheme: req.query.scheme === "dark" ? "dark" : "light" });
				res.setHeader("Content-Disposition", `attachment; filename="${stage}.${format === "jpeg" ? "jpg" : format}"`);
				res.type(format === "pdf" ? "application/pdf" : format === "jpeg" ? "jpeg" : "png");
				res.send(shot.bytes);
			} catch (error) {
				res.status(503).type("text").send((error as Error).message);
			}
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
			const versioned = splitLibVersion(wildcard(req));
			const target = resolveInDeck(app.deck.path, join("lib", versioned?.file ?? wildcard(req)));
			if (!existsSync(target) || !statSync(target).isFile()) throw new PathRefused(wildcard(req), "not a file");
			boardHeaders(res);
			if (versioned?.version === libVersion(app.deck.path)) res.setHeader("Cache-Control", LIB_FOREVER);
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
		// deck that is open, and that changes. A board that is the page asks for the bridge, and still does there.
		res.redirect(302, `${fileUrl(target)}${req.query.guest === undefined ? "" : "?guest=1"}`);
	});

	/** The resolved file itself, at its absolute path — read-only and quarantined (§4). */
	api.get(
		"/f/*path",
		asyncRoute(async (req, res) => {
			const requested = `/${wildcard(req)}`;
			const target = resolveFileRequest(app.deck.roots, { path: requested });
			if (!existsSync(target) || !statSync(target).isFile()) throw new PathRefused(requested, "not a file");
			quarantine(res, target);
			// A web page outside the deck that is its board, with the bridge in it, as one inside the deck gets (`/board/*path`).
			if (req.query.guest !== undefined && /\.html?$/i.test(target)) {
				res.type("html").send(withGuest(await readFile(target, "utf8"), `${"../".repeat(requested.split("/").length - 1)}board/lib/embed-guest.js`));
				return;
			}
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

	/**
	 * Where a file the picker named sits in the deck, and, for a film or a sound, what it is: the
	 * same `media` an upload answers with, its poster written beside it once. For placing a picked
	 * file on the canvas, which refers to deck files by their deck path and copies nothing. The picker
	 * names deck files by their full path; a file outside the deck answers `inDeck: false`.
	 */
	api.get(
		"/where",
		asyncRoute(async (req, res) => {
			const asked = typeof req.query.path === "string" ? req.query.path : "";
			const root = resolve(app.deck.path);
			const full = resolve(root, asked);
			if (!asked || (full !== root && !full.startsWith(root + sep)) || !existsSync(full) || !statSync(full).isFile()) {
				res.json({ inDeck: false });
				return;
			}
			const path = relative(root, full).split(sep).join("/");
			// Only what is named as a film or a sound is asked of ffmpeg, which reads a still picture as a one-frame film.
			const playable = /\.(mp4|m4v|webm|mov|ogv|mkv|mp3|m4a|aac|wav|flac|ogg|oga|opus|weba)$/i.test(path);
			const asset = playable ? await withMedia(root, { path, name: basename(full), bytes: statSync(full).size, reused: true }) : undefined;
			// A PDF, an SVG or a web page: a picture of it for its card (`files/preview.ts`).
			const preview = previewKind(path) ? await filePreview(root, path) : undefined;
			res.json({ inDeck: true, path, ...(asset?.media ? { media: asset.media } : {}), ...(preview ? { preview } : {}) });
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
	/**
	 * A board drawn from a snapshot of the reader's page (`boards/snapshot.ts`): the page's markup
	 * as it stood, drawn by the server's Chrome at the board's own address. The answer is the picture.
	 */
	api.post(
		"/snapshot",
		express.text({ type: () => true, limit: "24mb" }),
		asyncRoute(async (req, res) => {
			refuseCrossSite(typeof req.headers["sec-fetch-site"] === "string" ? req.headers["sec-fetch-site"] : undefined);
			const path = normalizeBoardPath(typeof req.query.path === "string" ? req.query.path : "");
			if (!app.deck.board(path)) {
				res.status(404).type("text").send("No such board.");
				return;
			}
			const shot = await renderSnapshot(app.thumbs, `http://127.0.0.1:${req.socket.localPort}`, {
				path,
				html: typeof req.body === "string" ? req.body : "",
				w: Number(req.query.w) || 1000,
				h: Number(req.query.h) || 700,
				scheme: req.query.scheme === "dark" ? "dark" : "light",
			});
			res.setHeader("Cache-Control", "no-store");
			res.type(pictureType(shot)).send(shot);
		}),
	);

	api.post(
		"/upload",
		asyncRoute(async (req, res) => {
			refuseCrossSite(typeof req.headers["sec-fetch-site"] === "string" ? req.headers["sec-fetch-site"] : undefined);
			// Refused on the declared length before a byte is read; the stream enforces it again for a body that lied.
			const declared = Number(req.headers["content-length"] ?? 0);
			if (declared > MAX_UPLOAD_BYTES) throw new UploadRefused(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`, 413);
			const name = typeof req.query.name === "string" ? req.query.name : "";
			res.json(await storeAssetStream(app.deck.path, name, req));
		}),
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

	/*
	 * Google Docs (`google/`): signing in as the person, the pictures in a Doc's page, and the
	 * agents' Google Docs tools. The sign-in is started by the page with its own origin, since
	 * behind a proxy this server cannot tell what address the browser used to reach it.
	 */
	api.get("/google/status", (_req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(app.google.state());
	});
	api.get("/google/signin", (req, res) => {
		const origin = typeof req.query.origin === "string" && /^https?:\/\/[^/\s]+$/.test(req.query.origin) ? req.query.origin : `${req.protocol}://${req.get("host")}`;
		try {
			res.redirect(302, app.google.auth.signInUrl(origin));
		} catch (error) {
			res.status(400).type("text/plain").send((error as Error).message);
		}
	});
	const signedIn = (res: Response, said: string, ok: boolean) =>
		res
			.status(ok ? 200 : 400)
			.type("html")
			.send(`<!doctype html><meta charset="utf-8"><title>Google</title><body style="font:16px system-ui;margin:15vh auto;max-width:28em;line-height:1.5"><h1 style="font-size:22px">${ok ? "Signed in" : "Not signed in"}</h1><p>${said.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</p><p>You can close this tab and go back to Decks.</p></body>`);
	api.get(
		"/google/callback",
		asyncRoute(async (req, res) => {
			try {
				const email = await app.google.auth.finish({ code: String(req.query.code ?? ""), state: String(req.query.state ?? ""), ...(req.query.error ? { url: `http://x/?error=${String(req.query.error)}` } : {}) });
				signedIn(res, `Decks can now read and edit the Google Docs ${email} can.`, true);
			} catch (error) {
				signedIn(res, (error as Error).message, false);
			}
		}),
	);
	api.post(
		"/google/code",
		asyncRoute(async (req, res) => {
			try {
				const email = await app.google.auth.finish({ url: String((req.body as { url?: unknown })?.url ?? "") });
				res.json({ ok: true, email });
			} catch (error) {
				res.json({ ok: false, message: (error as Error).message });
			}
		}),
	);
	/** The person's Google Docs for the file picker, the ones they looked at last first; `q` narrows them by name. */
	api.get(
		"/google/docs",
		asyncRoute(async (req, res) => {
			res.setHeader("Cache-Control", "no-store");
			if (!app.google.state().signedIn) {
				res.status(401).json({ error: "Not signed in to Google." });
				return;
			}
			try {
				res.json({ docs: await app.google.api().list(typeof req.query.q === "string" ? req.query.q : undefined) });
			} catch (error) {
				res.status(502).json({ error: (error as Error).message });
			}
		}),
	);
	api.post("/google/signout", (_req, res) => {
		app.google.auth.signOut();
		res.json({ ok: true });
	});
	api.get(
		"/google/image/:doc/:object",
		asyncRoute(async (req, res) => {
			const doc = await app.google.api().get(String(req.params.doc)).catch(() => undefined);
			const uri = doc?.inlineObjects?.[String(req.params.object)]?.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
			const fetched = uri ? await fetch(uri).catch(() => undefined) : undefined;
			if (!fetched?.ok) {
				res.status(404).end();
				return;
			}
			res.setHeader("Content-Type", fetched.headers.get("content-type") ?? "image/png");
			res.setHeader("Cache-Control", "private, max-age=600");
			res.end(Buffer.from(await fetched.arrayBuffer()));
		}),
	);
	/*
	 * The agents' Google Docs tools, for a runtime outside this process (opencode, antigravity),
	 * with the same identity as the canvas tool: a token per agent, or opencode's session id.
	 */
	api.post(
		"/gdocs/call",
		asyncRoute(async (req, res) => {
			const header = req.headers.authorization;
			const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
			const body = (req.body ?? {}) as { tool?: unknown; args?: unknown; sessionID?: unknown };
			const agentId = app.bridge.agentFor(token, typeof body.sessionID === "string" ? body.sessionID : undefined);
			if (!agentId) {
				res.json({ text: "This tool's token is not valid any more. The agent it belonged to has gone.", isError: true });
				return;
			}
			res.json(await app.google.tool(String(body.tool ?? ""), (body.args ?? {}) as Record<string, unknown>, app.agentName(agentId)));
		}),
	);

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
		return readMeta(boardPath, readFileSync(join(deck.path, boardPath), "utf8")).aspect;
	} catch {
		return undefined;
	}
}

/**
 * A web page with `lib/embed-guest.js` put first in its head, so it takes the scrolls it can use and
 * hands the rest to the canvas. A page that brings its own bridge (it says `decks:embed-ready`) is
 * left as it is: two bridges would hand every scroll up twice.
 */
function withGuest(page: string, src: string): string {
	if (page.includes("decks:embed-ready")) return page;
	const tag = `<script src="${src}"></script>`;
	const head = /<head[^>]*>/i.exec(page);
	return head ? `${page.slice(0, head.index + head[0].length)}${tag}${page.slice(head.index + head[0].length)}` : `${tag}${page}`;
}
