import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { Box } from "@decks/pen";
import { resolveInDeck } from "../deck/roots.ts";
import type { StagePens } from "./pens.ts";
import type { NativeShots } from "./native-shots.ts";

type Browser = import("playwright").Browser;

/**
 * A picture of a stage, or of part of one: what pen.dev's `get_screenshot` and `export_nodes` are,
 * for a Decks stage.
 *
 * Drawn natively when it can be (`native-shots.ts`): the stage engine's own painter on this
 * machine's graphics card, the drawing over each board's picture of its current revision, with no
 * browser. Otherwise — a PDF, live boards asked for, math, a picture it cannot load, a board not yet
 * pictured — taken in the server's own Chromium, the one the dashboard's board pictures come from,
 * loading `shot.html`, a page that draws one stage the way the canvas does: the drawing under and
 * over the boards, and the boards themselves, live, between them. `how` says which. Nobody's open
 * canvas is used.
 *
 * `of` says what to take: nothing for everything on the stage, an item's id or a board's path, a
 * list of them, or a box. It is framed with a margin, and drawn at a zoom that keeps the long side
 * to `MAX_CSS` so a whole stage fits a picture someone can read; `scale` multiplies the pixels.
 */

export type ShotFormat = "png" | "jpeg" | "pdf";
export type ShotOf = string | string[] | Partial<Box> | undefined;

export interface ShotRequest {
	stage: string;
	/** A .pen file to picture instead of the stage, whole: a saved frame, or any other (`StagePens.penFile`). */
	file?: string;
	of?: ShotOf;
	scale?: number;
	scheme?: "light" | "dark";
	format?: ShotFormat;
	/** A deck-relative file to write; a fresh one under `.decks/shots/` otherwise. */
	to?: string;
	/** The boards as live pages, in the browser, rather than their pictures. */
	live?: boolean;
}

export interface Shot {
	/** Deck-relative. */
	file: string;
	bytes: Buffer;
	format: ShotFormat;
	width: number;
	height: number;
	box: Box;
	/** How it was taken: `native`, or `chromium: <why not native>`. */
	how: "native" | `chromium: ${string}`;
}

export interface ShotHost {
	deck: string;
	pens: StagePens;
	/** Where the web app is served, as the server can reach it: `shot.html` is part of it. */
	webOrigin: () => string;
	borrow: <T>(use: (browser: Browser) => Promise<T>) => Promise<T>;
	/** The native renderer (`native-shots.ts`): the default, with Chromium when it cannot. */
	native?: NativeShots;
}

/** The long side of the page, in CSS pixels: a whole stage is shrunk to fit it. */
const MAX_CSS = 1600;
const MARGIN = 24;
const READY_MS = 20_000;

/** The box `of` names on this stage, with a margin; a sentence when it names nothing. */
export function shotBox(pens: StagePens, stage: string, of: ShotOf): Box {
	const pad = (b: Box, m: number): Box => ({ x1: Math.floor(b.x1 - m), y1: Math.floor(b.y1 - m), x2: Math.ceil(b.x2 + m), y2: Math.ceil(b.y2 + m) });
	if (of && typeof of === "object" && !Array.isArray(of)) {
		const { x1, y1, x2, y2 } = of;
		if ([x1, y1, x2, y2].some((n) => typeof n !== "number" || !Number.isFinite(n)) || x2! <= x1! || y2! <= y1!) {
			throw new Error("A box to picture is { x1, y1, x2, y2 } on the stage, with x2 right of x1 and y2 below y1.");
		}
		return { x1: x1!, y1: y1!, x2: x2!, y2: y2! };
	}
	const placed = pens.placedOf(stage);
	const doc = pens.get(stage).doc;
	const boards = pens.boards(stage);
	const boxOfName = (name: string): Box | undefined => {
		const board = boards.find((one) => one.path === name || one.path === `boards/${name}`);
		const found = board ? placed.get(board.id)?.box : placed.get(name)?.box;
		return found ? { x1: found.x, y1: found.y, x2: found.x + found.w, y2: found.y + found.h } : undefined;
	};
	const names = of === undefined ? doc.children.map((node) => node.id) : Array.isArray(of) ? of : [of];
	const boxes: Box[] = [];
	for (const name of names) {
		const box = boxOfName(String(name));
		if (!box) throw new Error(`"${name}" is not an item or a board on stage ${stage}: stage.pen.read() lists the items, stage.boards() the boards.`);
		boxes.push(box);
	}
	if (boxes.length === 0) throw new Error(`Stage ${stage} has nothing on it to picture.`);
	return pad(
		{
			x1: Math.min(...boxes.map((b) => b.x1)),
			y1: Math.min(...boxes.map((b) => b.y1)),
			x2: Math.max(...boxes.map((b) => b.x2)),
			y2: Math.max(...boxes.map((b) => b.y2)),
		},
		MARGIN,
	);
}

export class StageShots {
	constructor(private host: ShotHost) {}

	async take(request: ShotRequest): Promise<Shot> {
		const { stage } = request;
		const fileFrame = request.file ? this.host.pens.fileFrame(request.file) : undefined;
		if (!fileFrame && !this.host.pens.names().includes(stage)) throw new Error(`There is no stage "${stage}".`);
		let box: Box;
		if (fileFrame?.stage) box = shotBox(this.host.pens, fileFrame.stage, request.of);
		else if (fileFrame) {
			if (!fileFrame.box) throw new Error(`${request.file} has nothing in it to picture.`);
			box = { x1: Math.floor(fileFrame.box.x1 - MARGIN), y1: Math.floor(fileFrame.box.y1 - MARGIN), x2: Math.ceil(fileFrame.box.x2 + MARGIN), y2: Math.ceil(fileFrame.box.y2 + MARGIN) };
		} else box = shotBox(this.host.pens, stage, request.of);
		const format: ShotFormat = request.format === "jpeg" || request.format === "pdf" ? request.format : "png";
		const scale = Math.min(3, Math.max(0.25, Number.isFinite(request.scale) ? Number(request.scale) : 1));
		const scheme = request.scheme === "dark" ? "dark" : "light";
		const w = box.x2 - box.x1;
		const h = box.y2 - box.y1;
		const zoom = Math.min(1, MAX_CSS / Math.max(w, h));
		const width = Math.max(1, Math.round(w * zoom));
		const height = Math.max(1, Math.round(h * zoom));
		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const named = fileFrame ? (fileFrame.stage ?? basename(request.file!).replace(/\.pen$/, "")) : stage;
		const target = request.to ? resolveInDeck(this.host.deck, request.to) : join(this.host.deck, ".decks", "shots", `${named}-${stamp}.${format === "jpeg" ? "jpg" : format}`);
		mkdirSync(dirname(target), { recursive: true });
		const shot = { file: relative(this.host.deck, target), format, width: Math.round(width * scale), height: Math.round(height * scale), box };

		/*
		 * Natively when it can be (`native-shots.ts`): the drawing over the boards' pictures, with no
		 * browser. A PDF, live boards, and whatever the native renderer says it cannot draw as the
		 * person would see it go to the browser page below, and `how` says why.
		 */
		const native = this.host.native;
		const why = format === "pdf" ? "a PDF is printed by the browser" : request.live ? "live boards were asked for" : !native ? "this server has no native renderer" : undefined;
		let notNative = why;
		if (native && !why) {
			const drawn = fileFrame?.stage ? this.host.pens.drawingOf(fileFrame.stage) : fileFrame ? { doc: fileFrame.doc, base: fileFrame.base } : this.host.pens.drawingOf(stage);
			const onStage = fileFrame?.stage ?? (fileFrame ? undefined : stage);
			const boards = onStage ? this.host.pens.boards(onStage).map(({ path, x, y, w, h }) => ({ path, x, y, w, h })) : [];
			const outcome = await native.take({ doc: drawn.doc, base: drawn.base, boards, box, scale: zoom * scale, width: shot.width, height: shot.height, scheme, format: format === "jpeg" ? "jpeg" : "png", out: target });
			if (outcome.ok) return { ...shot, bytes: readFileSync(target), how: "native" as const };
			notNative = outcome.why;
		}

		const query = new URLSearchParams({ ...(fileFrame?.stage ? { stage: fileFrame.stage } : fileFrame ? { pen: request.file! } : { stage }), x1: String(box.x1), y1: String(box.y1), x2: String(box.x2), y2: String(box.y2), scheme });
		const url = `${this.host.webOrigin()}/shot.html?${query}`;

		const bytes = await this.host.borrow(async (browser) => {
			const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: scheme, reducedMotion: "reduce" });
			try {
				const page = await context.newPage();
				await page.goto(url, { waitUntil: "load", timeout: READY_MS });
				await page.waitForFunction("window.__shotReady === true || typeof window.__shotFailed === 'string'", undefined, { timeout: READY_MS });
				const failed = await page.evaluate("window.__shotFailed");
				if (typeof failed === "string") throw new Error(`The stage page could not draw: ${failed}`);
				if (format === "pdf") return await page.pdf({ width: `${width}px`, height: `${height}px`, printBackground: true, pageRanges: "1" });
				return await page.screenshot({ type: format, ...(format === "jpeg" ? { quality: 90 } : {}), animations: "disabled", timeout: 15_000 });
			} finally {
				await context.close().catch(() => {});
			}
		});
		writeFileSync(target, bytes);
		return { ...shot, bytes, how: `chromium: ${notNative}` as const };
	}

	/**
	 * Measure one board where no canvas has: `measure.html` lays it out at its own size in this
	 * Chromium and runs the canvas's own measurement on it. Undefined when the board never got ready.
	 */
	async measure(board: { path: string; w: number; h: number }): Promise<{ w: number; h: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } | undefined> {
		const query = new URLSearchParams({ path: board.path, w: String(Math.round(board.w)), h: String(Math.round(board.h)) });
		const url = `${this.host.webOrigin()}/measure.html?${query}`;
		return this.host.borrow(async (browser) => {
			const context = await browser.newContext({ viewport: { width: Math.max(320, Math.round(board.w)), height: Math.max(240, Math.round(board.h)) }, reducedMotion: "reduce" });
			try {
				const page = await context.newPage();
				await page.goto(url, { waitUntil: "load", timeout: READY_MS });
				await page.waitForFunction("window.__measured !== undefined || typeof window.__measureFailed === 'string'", undefined, { timeout: READY_MS });
				const measured = (await page.evaluate("window.__measured ?? null")) as { w: number; h: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } | null;
				return measured ?? undefined;
			} finally {
				await context.close().catch(() => {});
			}
		});
	}

	/**
	 * A picture in another format, drawn again by the server's Chromium: a board's picture is WebP,
	 * and a caller who asked for PNG or JPEG gets that.
	 */
	async convert(bytes: Buffer, format: "png" | "jpeg"): Promise<Buffer> {
		const kind = imageKind(bytes);
		if (!kind || kind.format === format) return bytes;
		const { width, height } = imageSize(bytes);
		if (!width || !height) return bytes;
		return this.host.borrow(async (browser) => {
			const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
			try {
				const page = await context.newPage();
				await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style><img src="data:${kind.mime};base64,${bytes.toString("base64")}" width="${width}" height="${height}">`);
				await page.waitForFunction("document.images[0].complete && document.images[0].naturalWidth > 0", undefined, { timeout: READY_MS });
				return await page.screenshot({ type: format, ...(format === "jpeg" ? { quality: 90 } : { omitBackground: true }), clip: { x: 0, y: 0, width, height }, timeout: 15_000 });
			} finally {
				await context.close().catch(() => {});
			}
		});
	}

	/** Keep a picture of one board where a screenshot keeps its pictures, or at `to`: the deck-relative file. */
	keepBoard(path: string, bytes: Buffer, ext: "png" | "jpg" | "webp", to?: string): string {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const name = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "board";
		const target = to ? resolveInDeck(this.host.deck, to) : join(this.host.deck, ".decks", "shots", `${name}-${stamp}.${ext}`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, bytes);
		return relative(this.host.deck, target);
	}

	/**
	 * A small picture of a whole stage, for the manager's cards, taken once per revision.
	 *
	 * Kept on disk by name, revision and scheme, exactly as a board's picture is
	 * (`boards/thumbs.ts`) and for the same reason: the picture is the expensive part, a browser
	 * asks for it by a URL carrying the revision, and an unchanged stage never misses. Older
	 * revisions of the same stage are removed as they are replaced, so the folder is one file per
	 * stage per scheme rather than a history nobody reads.
	 *
	 * One at a time per stage: two cards asking at once would otherwise start two Chromium pages
	 * for one picture.
	 */
	async thumb(stage: string, rev: number, scheme: "light" | "dark"): Promise<string> {
		const dir = join(this.host.deck, ".decks", "thumbs", "stages");
		const file = join(dir, `${stage}-${rev}-${scheme}.jpg`);
		if (existsSync(file)) return file;
		const key = `${stage}-${scheme}`;
		const waiting = this.thumbing.get(key);
		if (waiting) return waiting;
		const work = (async () => {
			const shot = await this.take({ stage, scheme, format: "jpeg", scale: 1, to: relative(this.host.deck, file) });
			// Whatever this stage's picture was before, at any older revision.
			for (const old of existsSync(dir) ? readdirSync(dir) : []) {
				if (old.startsWith(`${stage}-`) && old.endsWith(`-${scheme}.jpg`) && old !== basename(file)) rmSync(join(dir, old), { force: true });
			}
			void shot;
			return file;
		})();
		this.thumbing.set(key, work);
		try {
			return await work;
		} finally {
			this.thumbing.delete(key);
		}
	}

	/** A picture being taken now, by stage and scheme: the second asker waits for the first. */
	private readonly thumbing = new Map<string, Promise<string>>();
}

/** What a picture's bytes are, by their first ones: a board's whole picture and a browser's snapshot are WebP. */
export function imageKind(bytes: Buffer): { format: "png" | "jpeg" | "webp"; mime: string; ext: "png" | "jpg" | "webp" } | undefined {
	if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47) return { format: "png", mime: "image/png", ext: "png" };
	if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return { format: "jpeg", mime: "image/jpeg", ext: "jpg" };
	if (bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return { format: "webp", mime: "image/webp", ext: "webp" };
	return undefined;
}

/** A PNG's, JPEG's or WebP's size in pixels, read from its header; zeros when it is none of them. */
export function imageSize(bytes: Buffer): { width: number; height: number } {
	if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	if (imageKind(bytes)?.format === "webp" && bytes.length >= 25) {
		const chunk = bytes.toString("latin1", 12, 16);
		// Lossy: a 14-bit width and height after the frame tag and start code.
		if (chunk === "VP8 " && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
		// Lossless: 14 bits each, minus one, packed after the 0x2f signature.
		if (chunk === "VP8L" && bytes.length >= 25) {
			const bits = bytes.readUInt32LE(21);
			return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
		}
		// Extended: the canvas's size, 24 bits each, minus one.
		if (chunk === "VP8X" && bytes.length >= 30) return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		let at = 2;
		while (at + 9 < bytes.length) {
			if (bytes[at] !== 0xff) break;
			const marker = bytes[at + 1]!;
			const length = bytes.readUInt16BE(at + 2);
			// Start-of-frame markers carry the size: C0 to CF, except C4, C8 and CC.
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
			at += 2 + length;
		}
	}
	return { width: 0, height: 0 };
}
