import { normalizeBoardPath } from "../deck/schema.ts";
import { UploadRefused } from "../files/upload.ts";
import { boardOnCanvas } from "../verbs/router.ts";
import { renderSnapshot } from "../pictures/snapshot.ts";
import { squeezed, wireEncoding } from "../pictures/compress.ts";
import { keptWidth, pictureType } from "../pictures/ladder.ts";
import type { ServerMessage } from "@decks/protocol";
import { buildBundle, bundleFileName } from "../share/bundle.ts";
import { actsAsPerson } from "../auth/principal.ts";
import { asyncRoute, wildcard, sendFile, harnessId, type RouteDeps } from "./shared.ts";
import express, { type Router } from "express";

/**
 * Pictures: of every card (`pictures/thumbs.ts`), of a stage, a canvas as a bundle, a stage's .pen for `shot.html`, and a page drawn from a snapshot.
 */
export function register(api: Router, { app }: RouteDeps): void {
	/** How far the server has got keeping a picture of every board (`ThumbService.index`), for the ⋯ menu. */
	api.get("/pictures", (_req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(app.thumbs.progress());
	});

	/**
	 * A picture of a card (`pictures/thumbs.ts`): `whole=1`, and `w=` one of the ladder's rungs
	 * (`SMALL_WIDTHS`) or none for the whole picture; `astc=1` for it compressed for the GPU.
	 *
	 * `v` is the revision the canvas knows, and it is only there to make the URL a new one when the
	 * card changes, which is what allows the year of caching: the picture served is always of the
	 * card as it is now. 400 for a width the ladder does not have, 503 when there is no Chromium
	 * here, 404 for no such card.
	 */
	api.get(
		"/thumb/*path",
		asyncRoute(async (req, res) => {
			const board = app.deck.board(normalizeBoardPath(wildcard(req)));
			if (!board) {
				res.status(404).end();
				return;
			}
			// A rung of the ladder, or the whole picture; any other width is refused.
			const small = req.query.w === undefined ? undefined : keptWidth(Number(req.query.w));
			if (req.query.whole !== "1" || (req.query.w !== undefined && small === undefined)) {
				res.status(400).type("text").send("a card's picture is asked for with whole=1, and w= one of the ladder's widths or none");
				return;
			}
			let gone = false;
			res.on("close", () => (gone = !res.writableEnded));
			try {
				const scheme = req.query.scheme === "dark" ? "dark" : "light";
				const wantsPacked = req.query.astc === "1" && small !== undefined;
				if (wantsPacked) app.thumbs.wantCompressed();
				const send = async (file: string) => {
					res.type(file.endsWith(".webp") ? "webp" : "jpeg");
					await sendFile(res, file);
				};
				/*
				 * The picture asked for when it is on disk; otherwise whatever the card has that is
				 * nearest (another rung, an earlier revision) at once, not cached and said to be a
				 * stand-in so the canvas asks again (`render/engine.ts`), with the one asked for made
				 * ahead of the background's work. Only a card with no picture at all waits.
				 */
				const size = small ?? "whole";
				app.thumbs.asked(scheme);
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
				const kept = req.query.v === String(board.rev) ? "private, max-age=31536000, immutable" : "no-cache";
				// Compressed for the GPU, when the canvas takes it (`astc=1`) and this machine can make it; else the WebP.
				const packed = wantsPacked ? await app.thumbs.compressed(file) : undefined;
				if (gone) return;
				if (packed) {
					res.setHeader("Cache-Control", kept);
					res.setHeader("Vary", "Accept-Encoding");
					res.type("application/vnd.decks.astc");
					// Squeezed on disk (`wireName`), a third to a half of the bytes, for a browser that undoes brotli or gzip.
					const encoding = wireEncoding(req.headers["accept-encoding"]);
					const wire = encoding ? await squeezed(packed, encoding) : undefined;
					if (gone) return;
					if (wire) res.setHeader("Content-Encoding", encoding!);
					await sendFile(res, wire ?? packed);
					return;
				}
				// Asked for compressed and sent the WebP (no encoder, or it failed): not kept, so a later look can have the compressed one.
				res.setHeader("Cache-Control", wantsPacked ? "no-cache" : kept);
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
				stage: { dir: pens.folderOf(name), title: pens.titleOf(name), rev: frame.rev, doc: frame.doc, boards: pens.boards(name) },
				picture: async (board, scheme) => {
					const near = app.thumbs.nearest(board, scheme, "whole");
					if (near) return near.file;
					const left = until - Date.now();
					if (left <= 0) return undefined;
					return Promise.race([app.thumbs.get(board, scheme, () => false), new Promise<undefined>((done) => setTimeout(() => done(undefined), left))]).catch(() => undefined);
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
		const frame = pens.frame("", name) as { doc: unknown; base: string; rev: number; by?: string };
		res.setHeader("Cache-Control", "no-store");
		/*
		 * Each card and board on it with its record (title, revision, card or not, who wrote it and when,
		 * when it was read), at its place on this drawing: what the canvas frame shows them from.
		 */
		const cards = pens.boards(name).flatMap(({ path, x, y, w, h }) => {
			const board = app.deck.board(path);
			return board ? [{ ...board, x, y, w, h }] : [];
		});
		res.json({ doc: frame.doc, base: frame.base, rev: frame.rev, harness: harnessId(app.deck.path), ...(frame.by ? { by: frame.by } : {}), boards: pens.boards(name).map(({ path, x, y, w, h }) => ({ path, x, y, w, h })), cards });
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
	 * button. `of` is a comma-separated list of item ids, or nothing for the whole stage; `box` is
	 * `x1,y1,x2,y2` on the stage instead, `scale` the pixels per CSS pixel (2 by default), and
	 * `live=1` takes it in the browser with live boards. The box taken is answered in `X-Shot-Box`,
	 * and how it was taken (`native`, or `chromium: why`) in `X-Shot-How`.
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
			const box = typeof req.query.box === "string" ? req.query.box.split(",").map(Number) : undefined;
			const of = box ? { x1: box[0], y1: box[1], x2: box[2], y2: box[3] } : typeof req.query.of === "string" && req.query.of ? req.query.of.split(",") : undefined;
			const format = req.query.format === "jpeg" || req.query.format === "pdf" ? req.query.format : "png";
			const scale = typeof req.query.scale === "string" && Number.isFinite(Number(req.query.scale)) ? Number(req.query.scale) : 2;
			const live = req.query.live === "1" || req.query.live === "true";
			try {
				const shot = await shots.take({ stage, of, format, scale, scheme: req.query.scheme === "dark" ? "dark" : "light", ...(live ? { live } : {}) });
				res.setHeader("X-Shot-Box", JSON.stringify(shot.box));
				res.setHeader("X-Shot-How", encodeURIComponent(shot.how));
				res.setHeader("Content-Disposition", `attachment; filename="${stage}.${format === "jpeg" ? "jpg" : format}"`);
				res.type(format === "pdf" ? "application/pdf" : format === "jpeg" ? "jpeg" : "png");
				res.send(shot.bytes);
			} catch (error) {
				res.status(503).type("text").send((error as Error).message);
			}
		}),
	);

	/**
	 * A board or card drawn from a snapshot of the reader's page (`pictures/snapshot.ts`): the page's markup
	 * as it stood, drawn by the server's Chrome at its own address. The answer is the picture. A card's
	 * comes from the canvas frame showing it (`packages/canvas/src/items/card-snapshot.ts`).
	 */
	api.post(
		"/snapshot",
		express.text({ type: () => true, limit: "24mb" }),
		asyncRoute(async (req, res) => {
			// The person's, in a Decks tab or a terminal, a paired front end's (Studio), or a canvas frame's for a card on its canvas.
			const principal = req.principal;
			if (!actsAsPerson(principal) && principal?.kind !== "canvas") throw new UploadRefused("Only the person, a front end paired with this harness, or a canvas frame sends this.", 403);
			const path = normalizeBoardPath(typeof req.query.path === "string" ? req.query.path : "");
			if (!app.deck.board(path)) {
				res.status(404).type("text").send("No such board.");
				return;
			}
			if (principal?.kind === "canvas" && !boardOnCanvas(app, path, principal.canvas)) throw new UploadRefused(`${path} is not on this canvas.`, 403);
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
}
