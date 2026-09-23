import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Box } from "@decks/pen";
import { resolveInDeck } from "../deck/roots.ts";
import type { StagePens } from "./pens.ts";

type Browser = import("playwright").Browser;

/**
 * A picture of a stage, or of part of one: what pen.dev's `get_screenshot` and `export_nodes` are,
 * for a Decks stage.
 *
 * Taken in the server's own Chromium — the one the dashboard's board pictures come from — loading
 * `shot.html`, a page that draws one stage the way the canvas does: the drawing under and over the
 * boards, and the boards themselves, live, between them. So the picture is what the person sees,
 * boards included, which a render of the drawing alone could not be. Nobody's open canvas is used.
 *
 * `of` says what to take: nothing for everything on the stage, an item's id or a board's path, a
 * list of them, or a box. It is framed with a margin, and drawn at a zoom that keeps the long side
 * to `MAX_CSS` so a whole stage fits a picture someone can read; `scale` multiplies the pixels.
 */

export type ShotFormat = "png" | "jpeg" | "pdf";
export type ShotOf = string | string[] | Partial<Box> | undefined;

export interface ShotRequest {
	stage: string;
	of?: ShotOf;
	scale?: number;
	scheme?: "light" | "dark";
	format?: ShotFormat;
	/** A deck-relative file to write; a fresh one under `.decks/shots/` otherwise. */
	to?: string;
}

export interface Shot {
	/** Deck-relative. */
	file: string;
	bytes: Buffer;
	format: ShotFormat;
	width: number;
	height: number;
	box: Box;
}

export interface ShotHost {
	deck: string;
	pens: StagePens;
	/** Where the web app is served, as the server can reach it: `shot.html` is part of it. */
	webOrigin: () => string;
	borrow: <T>(use: (browser: Browser) => Promise<T>) => Promise<T>;
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
		if (!this.host.pens.names().includes(stage)) throw new Error(`There is no stage "${stage}".`);
		const box = shotBox(this.host.pens, stage, request.of);
		const format: ShotFormat = request.format === "jpeg" || request.format === "pdf" ? request.format : "png";
		const scale = Math.min(3, Math.max(0.25, Number.isFinite(request.scale) ? Number(request.scale) : 1));
		const scheme = request.scheme === "dark" ? "dark" : "light";
		const w = box.x2 - box.x1;
		const h = box.y2 - box.y1;
		const zoom = Math.min(1, MAX_CSS / Math.max(w, h));
		const width = Math.max(1, Math.round(w * zoom));
		const height = Math.max(1, Math.round(h * zoom));
		const query = new URLSearchParams({ stage, x1: String(box.x1), y1: String(box.y1), x2: String(box.x2), y2: String(box.y2), scheme });
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

		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const target = request.to ? resolveInDeck(this.host.deck, request.to) : join(this.host.deck, ".decks", "shots", `${stage}-${stamp}.${format === "jpeg" ? "jpg" : format}`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, bytes);
		return { file: relative(this.host.deck, target), bytes, format, width: Math.round(width * scale), height: Math.round(height * scale), box };
	}
}
