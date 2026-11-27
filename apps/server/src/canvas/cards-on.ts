import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canvasFolder, pageName, referenceFor } from "@decks/hub/layout";
import { slug } from "@decks/deck-kit";
import { ARROW, ids, walk, type Op, type PenNode } from "@decks/pen";
import { CANVAS_META } from "./canvas-files.ts";
import type { Adopt } from "./canvas-refs.ts";
import { copyCardInto, copyFileInto, copyFrameInto } from "./copy-in.ts";
import { cardOf, CARD_ITEM, type CanvasPens } from "./pens.ts";

/**
 * The cards on a canvas: which are placed, where and how big, as its file has them, and each change
 * to one as a single edit of that file.
 *
 * A card on a canvas is a `browser` item of its drawing (`pens.ts`), so several agents on one canvas,
 * and a person on it, each change one card's item and never put back each other's work. A card
 * placed from another canvas is copied into this one's folder first, so the folder stands alone
 * (`copy-in.ts`); where a copy came from is kept beside the drawing (`canvas.json`'s `copiedFrom`),
 * so the same card asked for twice is one copy.
 */

/** A card as a canvas wants it: where it sits, and the size and title its file gives it. */
export interface CardSpot {
	path: string;
	x: number;
	y: number;
	w: number;
	h: number;
	title: string;
	/**
	 * Whether the writer moved or sized the card itself. `false` leaves the item's place or size as the
	 * file has it, which another session on the canvas may have changed; left out, the spot is the truth.
	 */
	moved?: boolean;
	sized?: boolean;
}

export class CanvasCards {
	constructor(private readonly of: CanvasPens) {}

	/**
	 * How a canvas takes in a card or a frame from elsewhere: copied into its own folder
	 * (`canvas/copy-in.ts`). Replaced by the app, which also tells the deck about the copy.
	 */
	adopt: Adopt = {
		card: (canvas, path) => this.copyIn(canvas, path),
		frame: (canvas, ref) => copyFrameInto(this.of.deckPath, ref, canvas),
		file: (canvas, deckPath) => copyFileInto(this.of.deckPath, deckPath, canvas),
	};

	/** Told of each copy a canvas makes, so the deck reads it at once (`app.ts`). */
	copied?: (path: string) => void;

	/** Copy a card into a canvas, and write down where the copy came from (`canvas.json`'s `copiedFrom`). */
	private copyIn(canvas: string, path: string): string {
		const copy = copyCardInto(this.of.deckPath, path, canvas);
		const file = join(this.of.folderOf(canvas), CANVAS_META);
		let meta: Record<string, unknown> = {};
		try {
			meta = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		} catch {
			/* a canvas with no record yet */
		}
		const copied = meta.copiedFrom && typeof meta.copiedFrom === "object" ? (meta.copiedFrom as Record<string, string>) : {};
		writeFileSync(file, `${JSON.stringify({ ...meta, copiedFrom: { ...copied, [copy.slice(canvasFolder(canvas).length + 1)]: path } }, null, "\t")}\n`);
		this.copied?.(copy);
		return copy;
	}

	/**
	 * The canvas's own card for a deck path: the path itself when the card is the canvas's, else the
	 * copy the canvas already made of it (`copiedFrom`), else the path as it was. Copies nothing.
	 */
	copyOf(name: string, path: string): string {
		if ("path" in referenceFor(name, path)) return path;
		let copied: unknown;
		try {
			copied = (JSON.parse(readFileSync(join(this.of.folderOf(name), CANVAS_META), "utf8")) as { copiedFrom?: unknown }).copiedFrom;
		} catch {
			return path;
		}
		if (!copied || typeof copied !== "object") return path;
		for (const [reference, origin] of Object.entries(copied as Record<string, unknown>)) {
			const own = `${canvasFolder(name)}/${reference}`;
			if (origin === path && existsSync(join(this.of.deckPath, own))) return own;
		}
		return path;
	}

	/**
	 * The card a canvas places for a deck path, copied in now when the canvas has no copy of it yet
	 * (`canvas/copy-in.ts`): what an agent's list of cards on its canvas is turned into, so another
	 * canvas's card asked for twice is one copy, not two. A path with no file is left as it is.
	 */
	ownPath(name: string, path: string): string {
		const known = this.copyOf(name, path);
		if (known !== path || "path" in referenceFor(name, path) || !existsSync(join(this.of.deckPath, path))) return known;
		return this.copyIn(name, path);
	}

	/** The deck cards on a canvas, in paint order, each where the layout puts it. */
	cards(name: string): Array<{ path: string; id: string; x: number; y: number; w: number; h: number }> {
		const placed = this.of.placedOf(name);
		const out: Array<{ path: string; id: string; x: number; y: number; w: number; h: number }> = [];
		for (const node of walk(this.of.get(name).doc.children)) {
			const path = cardOf(node);
			const box = path ? placed.get(node.id)?.box : undefined;
			if (path && box && !out.some((one) => one.path === path)) out.push({ path, id: node.id, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
		}
		return out;
	}

	/**
	 * Everything drawn on a canvas that is not a card, as boxes: what a card joining the canvas must
	 * not land on (`deck/place.ts`). Only top-level items, since a frame's box already holds what is
	 * in it. Arrows are left out: they run between things, and a card beside two others would
	 * always be sitting on the arrow joining them.
	 */
	drawn(name: string): Array<{ x: number; y: number; w: number; h: number }> {
		const out: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (const { node, box, parent } of this.of.placedOf(name).values()) {
			if (parent !== undefined || cardOf(node) || node.metadata?.type === ARROW) continue;
			if (box.w > 0 && box.h > 0) out.push({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
		}
		return out;
	}

	/**
	 * Make the canvas's cards these: add the ones missing, move and resize the ones that differ, and
	 * take away the rest. Writes only when something changed, and returns whether it did.
	 */
	syncCards(name: string, given: readonly CardSpot[]): boolean {
		const wanted = given.map((spot) => ({ ...spot, path: this.ownPath(name, spot.path) }));
		const entry = this.of.get(name);
		if (entry.error) return false;
		const placed = this.of.placedOf(name);
		const present = new Map<string, PenNode>();
		for (const node of walk(entry.doc.children)) {
			const path = cardOf(node);
			if (path && !present.has(path)) present.set(path, node);
		}
		const taken = ids(entry.doc);
		const ops: Op[] = [];
		for (const spot of wanted) {
			const node = present.get(spot.path);
			if (!node) {
				const base = slug(pageName(spot.path), 40) || "card";
				let id = base;
				for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
				taken.add(id);
				ops.push({
					op: "insert",
					node: { type: "browser", id, name: spot.title, url: `../../${spot.path}`, width: spot.w, height: spot.h, metadata: { type: CARD_ITEM, path: spot.path } },
					box: { x1: spot.x, y1: spot.y },
				});
				continue;
			}
			const set: Record<string, unknown> = {};
			if (spot.sized !== false && node.width !== spot.w) set.width = spot.w;
			if (spot.sized !== false && node.height !== spot.h) set.height = spot.h;
			if (node.name !== spot.title) set.name = spot.title;
			const box = placed.get(node.id)?.box;
			const moved = spot.moved !== false && !!box && (Math.round(box.x) !== spot.x || Math.round(box.y) !== spot.y);
			if (Object.keys(set).length > 0 || moved) ops.push({ op: "update", id: node.id, set, ...(moved ? { box: { x1: spot.x, y1: spot.y } } : {}) });
		}
		const keep = new Set(wanted.map((spot) => spot.path));
		for (const [path, node] of present) if (!keep.has(path)) ops.push({ op: "delete", id: node.id });
		if (ops.length === 0) return false;
		this.of.edit(name, ops);
		return true;
	}

	/** Each card's item in a canvas, by path. */
	private cardItems(name: string): Map<string, PenNode> {
		const present = new Map<string, PenNode>();
		for (const node of walk(this.of.get(name).doc.children)) {
			const path = cardOf(node);
			if (path && !present.has(path)) present.set(path, node);
		}
		return present;
	}

	/** Put cards on a canvas, each at its corner and size; one already there keeps its place and size. */
	placeCards(name: string, given: readonly CardSpot[]): void {
		const spots = given.map((spot) => ({ ...spot, path: this.ownPath(name, spot.path) }));
		const entry = this.of.get(name);
		if (entry.error) return;
		const present = this.cardItems(name);
		const taken = ids(entry.doc);
		const ops: Op[] = [];
		for (const spot of spots) {
			const node = present.get(spot.path);
			if (node) {
				if (node.name !== spot.title) ops.push({ op: "update", id: node.id, set: { name: spot.title } });
				continue;
			}
			const base = slug(pageName(spot.path), 40) || "card";
			let id = base;
			for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
			taken.add(id);
			ops.push({ op: "insert", node: { type: "browser", id, name: spot.title, url: `../../${spot.path}`, width: spot.w, height: spot.h, metadata: { type: CARD_ITEM, path: spot.path } }, box: { x1: spot.x, y1: spot.y } });
		}
		if (ops.length) this.of.edit(name, ops);
	}

	/** Move one card on a canvas, its corner to `x y`. False when the canvas does not hold it. */
	moveCard(name: string, path: string, x: number, y: number): boolean {
		const node = this.cardItems(name).get(this.copyOf(name, path));
		if (!node) return false;
		const box = this.of.placedOf(name).get(node.id)?.box;
		if (box && Math.round(box.x) === Math.round(x) && Math.round(box.y) === Math.round(y)) return true;
		this.of.edit(name, [{ op: "update", id: node.id, set: {}, box: { x1: Math.round(x), y1: Math.round(y) } }]);
		return true;
	}

	/** Size one card on a canvas. False when the canvas does not hold it. */
	sizeCard(name: string, path: string, size: { w?: number; h?: number }): boolean {
		const node = this.cardItems(name).get(this.copyOf(name, path));
		if (!node) return false;
		const set: Record<string, unknown> = {};
		if (size.w !== undefined && node.width !== Math.round(size.w)) set.width = Math.round(size.w);
		if (size.h !== undefined && node.height !== Math.round(size.h)) set.height = Math.round(size.h);
		if (Object.keys(set).length) this.of.edit(name, [{ op: "update", id: node.id, set }]);
		return true;
	}

	/** Take cards off a canvas. */
	removeCards(name: string, paths: readonly string[]): void {
		const present = this.cardItems(name);
		const ops: Op[] = [];
		for (const path of paths) {
			const node = present.get(this.copyOf(name, path));
			if (node) ops.push({ op: "delete", id: node.id });
		}
		if (ops.length) this.of.edit(name, ops);
	}

	/** Point a card's item at another file (a card copied into the canvas's own folder), in the same place. */
	repointCard(name: string, from: string, to: string): void {
		const node = this.cardItems(name).get(from);
		if (!node) return;
		this.of.edit(name, [{ op: "update", id: node.id, set: { url: `../../${to}`, metadata: { ...(node.metadata ?? {}), type: CARD_ITEM, path: to } } }]);
	}
}
