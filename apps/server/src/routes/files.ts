import { existsSync, statSync } from "node:fs";
import { sttReady, transcribe } from "../stt.ts";
import { readFile } from "node:fs/promises";
import { LIB_FOREVER, libVersion, splitLibVersion } from "../deck/lib-version.ts";
import { basename, join, relative, resolve, sep } from "node:path";
import { MAX_UPLOAD_BYTES } from "@decks/protocol";
import { fileUrl, NotFound, resolveFileRequest, resolveInDeck, resolveServed } from "../deck/roots.ts";
import { canvasFolder, canvasNameOk, libName } from "../deck/layout.ts";
import { browse } from "../files/browse.ts";
import { filePreview, previewKind } from "../files/preview.ts";
import { boardHeaders, quarantine } from "../files/serve.ts";
import { storeAssetStream, UploadRefused, withMedia } from "../files/upload.ts";
import { actsAsPerson } from "../auth/principal.ts";
import { asyncRoute, wildcard, sendFile, withGuest, type RouteDeps } from "./shared.ts";
import express, { type Router } from "express";

/**
 * Files: the board primitives, files from outside the deck, avatars, where a picked file sits, browsing, speech to text and uploads.
 */
export function register(api: Router, { app }: RouteDeps): void {
	/**
	 * The board primitives, reachable from a document not served under `/board`.
	 *
	 * A revision preview is served at `/api/revision/<sha>`, so the `../lib/board.css` in
	 * its own markup resolves to `/api/lib/board.css` (served as `card.css`) — not to `/api/card/lib/card.css`,
	 * where the deck's copy lives. Without this alias a previewed board arrived as unstyled
	 * HTML with `board.js` missing, so the time machine looked like it worked (the text was
	 * right) while showing nothing like the board it was previewing.
	 */
	api.get(
		"/lib/*path",
		asyncRoute(async (req, res) => {
			const versioned = splitLibVersion(wildcard(req));
			// A page written before cards asks for board.css and board.js: they are card.css and card.js.
			const target = resolveServed(app.deck.path, join("lib", libName(versioned?.file ?? wildcard(req))));
			if (!existsSync(target) || !statSync(target).isFile()) throw new NotFound(wildcard(req));
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
		if (!existsSync(target) || !statSync(target).isFile()) throw new NotFound(path);
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
			if (!existsSync(target) || !statSync(target).isFile()) throw new NotFound(requested);
			quarantine(res, target);
			// A web page outside the deck that is its board, with the bridge in it, as one inside the deck gets (`/card/*path`).
			if (req.query.guest !== undefined && /\.html?$/i.test(target)) {
				res.type("html").send(withGuest(await readFile(target, "utf8"), `${"../".repeat(requested.split("/").length - 1)}card/lib/embed-guest.js`));
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
			if (!existsSync(target)) throw new NotFound(id, "no avatar for that agent");
			quarantine(res, target);
			await sendFile(res, target);
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

	/*
	 * Speech to text for the composer's mic (`stt.ts`): whether this server can, and a recording's words.
	 * The recording is the body, as an upload's file is, and nothing of it is kept.
	 */
	api.get("/stt", (_req, res) => {
		res.json({ server: sttReady() });
	});
	api.post(
		"/stt",
		express.raw({ type: () => true, limit: "25mb" }),
		asyncRoute(async (req, res) => {
			// The person's, in a Decks tab or a terminal, or a paired front end's (Studio).
			if (!actsAsPerson(req.principal)) throw new UploadRefused("Only the person, or a front end paired with this harness, sends this.", 403);
			if (!sttReady()) {
				res.status(503).json({ error: "No speech recogniser on this server." });
				return;
			}
			const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
			if (audio.length === 0) {
				res.status(400).json({ error: "No recording was sent." });
				return;
			}
			try {
				// The model chosen in Settings, or the default (`stt.ts`).
				res.json({ text: await transcribe(audio, String(req.headers["content-type"] ?? "audio/webm"), app.settings.get().sttModel) });
			} catch (error) {
				res.status(502).json({ error: (error as Error).message });
			}
		}),
	);


	/**
	 * A file the user dropped onto a board, copied into the deck's `assets/` (§3), or with
	 * `canvas`, into that canvas's own `files/`.
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
		asyncRoute(async (req, res) => {
			// The person's, in a Decks tab or a terminal, or a paired front end's (Studio).
			if (!actsAsPerson(req.principal)) throw new UploadRefused("Only the person, or a front end paired with this harness, sends this.", 403);
			// Refused on the declared length before a byte is read; the stream enforces it again for a body that lied.
			const declared = Number(req.headers["content-length"] ?? 0);
			if (declared > MAX_UPLOAD_BYTES) throw new UploadRefused(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`, 413);
			const name = typeof req.query.name === "string" ? req.query.name : "";
			/*
			 * Dropped on a canvas, it goes into that canvas's own files/ (`deck/layout.ts`), so the canvas
			 * stands alone, and a friend's canvas you may edit takes it in its folder, which syncs back to
			 * them. A canvas shared with you to view takes nothing: its owner's copy is the one there is.
			 */
			const canvas = typeof req.query.canvas === "string" && req.query.canvas ? req.query.canvas : undefined;
			let into: { folder: string; ref: string } | undefined;
			if (canvas) {
				const pens = app.stage.pens;
				if (!pens || !canvasNameOk(canvas) || !pens.has(canvas)) throw new UploadRefused(`There is no canvas ${canvas} to put the file in.`, 404);
				try {
					pens.mayWrite(canvas);
				} catch (error) {
					throw new UploadRefused((error as Error).message, 403);
				}
				into = { folder: `${canvasFolder(canvas)}/files`, ref: "files" };
			}
			res.json(await storeAssetStream(app.deck.path, name, req, into));
		}),
	);
}
