import { apply, baseTheme, diff, editDocument, parse, placements, reroute, walk, type Frame, type PenDocument, type PenEdit, type PenNode } from "@decks/pen";
import type { Board } from "@decks/protocol";
import { createSignal, untrack, type Accessor } from "solid-js";
import type { DocEdits } from "./stage/types.ts";

/**
 * The drawing a mounted canvas edits (`mount.tsx`): the document, the person's edits applied to it
 * with `@decks/pen` as the Decks server applies them (arrows routed again after each), their undo
 * and redo, and every change reported as the edits that make it (`diff`).
 *
 * No page in it, so it is tested on its own (`drawing.test.ts`).
 */
export interface Drawing {
	doc: Accessor<PenDocument>;
	/** Pen operations, as the person's edit: applied, kept for undo, reported. False when refused or a no-op. */
	edit(ops: unknown[]): boolean;
	step(direction: "undo" | "redo"): void;
	/**
	 * A newer drawing from elsewhere: shown, not reported, and the person's undo starts again from it.
	 * `edits`, when the host has them, are what made it from the drawing held (`DocEdits`).
	 */
	set(next: string | PenDocument, edits?: DocEdits): void;
	/**
	 * Edits from elsewhere (another device, an agent: what a host hears as a delta), applied to the
	 * drawing held as `set` would show the drawing they make, without the whole text parsed again.
	 * False when they do not apply to it: the host sends the whole drawing then (`set`).
	 */
	follow(edits: readonly PenEdit[]): boolean;
	/** The edits that made `doc` from the drawing before it, when it is the drawing now and they are known: the stage applies them. */
	editsTo(doc: PenDocument): DocEdits | undefined;
	/** A board on the drawing (by its deck path) moved or resized: its item moved or resized. */
	moveBoard(path: string, x: number, y: number): void;
	resizeBoard(path: string, size: { w: number; h: number }): void;
	/** A board taken off the drawing (its file is the host's business): its item deleted. */
	removeBoard(path: string): void;
}

export interface DrawingOptions {
	onEdits?: (edits: PenEdit[], doc: PenDocument) => void;
	/** The scheme the drawing's theme variables are read in. */
	look?: () => "light" | "dark";
	readOnly?: boolean;
	/** How many edits undo reaches back. */
	depth?: number;
	/**
	 * A drawing the host owns, as the Decks app's server owns its canvases: each edit is handed to
	 * `send` as pen operations and nothing changes here until the host's answer arrives (`set`); undo
	 * and redo are the host's too (`step`). Without it the drawing is this page's: edits apply here at
	 * once, are reported to `onEdits`, and undo is kept here (Studio, a sharing site).
	 */
	host?: { send(ops: unknown[]): void; step(direction: "undo" | "redo"): void };
}

export const isBoard = (node: PenNode) => node.type === "browser" && (node.metadata as { type?: string } | undefined)?.type === "decks.board";
export const boardPath = (node: PenNode) => String((node.metadata as { path?: unknown }).path ?? node.id);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The drawing's boards, as the stage takes them. Top-level only: a board's x and y are the canvas's. */
export function boardsOf(doc: PenDocument): Board[] {
	const boards: Board[] = [];
	for (const node of doc.children ?? []) {
		if (!isBoard(node)) continue;
		boards.push({
			path: boardPath(node),
			title: typeof node.name === "string" && node.name ? node.name : boardPath(node),
			x: num(node.x, 0),
			y: num(node.y, 0),
			w: num(node.width, 960),
			h: num(node.height, 640),
			rev: 0,
			inContext: [],
		});
	}
	return boards;
}

export function createDrawing(text: string | PenDocument, options: DrawingOptions = {}): Drawing {
	const look = options.look ?? (() => "light" as const);
	const depth = options.depth ?? 200;
	const [doc, setDoc] = createSignal<PenDocument>(typeof text === "string" ? parse(text) : text);
	/** The person's own edits, to step back and forward through: each entry is the document before (undo) or after (redo). */
	const undoStack: PenDocument[] = [];
	const redoStack: PenDocument[] = [];

	/** Arrows follow what they join: the drawing's arrows are routed again after every edit, as the Decks server does. */
	const rerouted = (next: PenDocument) => {
		const placed = placements(next, { theme: baseTheme(next, look()) });
		const byPath = new Map<string, string>();
		for (const node of walk(next.children ?? [])) if (isBoard(node)) byPath.set(boardPath(node), node.id);
		reroute(next, placed, (name): Frame | undefined => {
			const id = byPath.get(name);
			return id ? placed.get(id)?.box : undefined;
		});
		return next;
	};

	/** What made the drawing now from the one before, when known: `to` is the drawing they made. */
	let made: (DocEdits & { to: PenDocument }) | undefined;
	const show = (next: PenDocument, edits?: DocEdits) => {
		made = edits ? { ...edits, to: next } : undefined;
		setDoc(next);
	};

	/** Show `next` and tell the host what changed. */
	const commit = (prev: PenDocument, next: PenDocument) => {
		const edits = diff(prev, next);
		if (edits.length === 0) return false;
		show(next, { from: prev, edits });
		options.onEdits?.(edits, next);
		return true;
	};

	const edit = (ops: unknown[]) => {
		if (options.readOnly || ops.length === 0) return false;
		if (options.host) {
			options.host.send(ops);
			return true;
		}
		const prev = untrack(doc);
		let next: PenDocument;
		try {
			next = rerouted(apply(prev, ops as Parameters<typeof apply>[1], { theme: baseTheme(prev, look()) }).doc);
		} catch (error) {
			console.warn("[canvas] an edit was refused:", error instanceof Error ? error.message : error);
			return false;
		}
		if (!commit(prev, next)) {
			/*
			 * Nothing changed (an item dropped back where it was), but the stage is waiting for the drawing
			 * that answers its gesture, as a server sends one whatever the edit did: a fresh copy is that
			 * answer, so what was let go glides back into place now rather than when the stage gives up.
			 */
			show({ ...prev }, { from: prev, edits: [] });
			return false;
		}
		undoStack.push(prev);
		if (undoStack.length > depth) undoStack.shift();
		redoStack.length = 0;
		return true;
	};

	const step = (direction: "undo" | "redo") => {
		if (options.host) return options.host.step(direction);
		const from = direction === "undo" ? undoStack : redoStack;
		const to = direction === "undo" ? redoStack : undoStack;
		const target = from.pop();
		if (!target) return;
		const now = untrack(doc);
		to.push(now);
		commit(now, target);
	};

	const boardId = (path: string) => untrack(doc).children?.find((node) => isBoard(node) && boardPath(node) === path)?.id;

	return {
		doc,
		edit,
		step,
		set(next, edits) {
			show(typeof next === "string" ? parse(next) : next, edits);
			undoStack.length = 0;
			redoStack.length = 0;
		},
		follow(edits) {
			const now = untrack(doc);
			let next: PenDocument;
			try {
				next = editDocument(now, edits);
			} catch {
				return false;
			}
			show(next, { from: now, edits });
			undoStack.length = 0;
			redoStack.length = 0;
			return true;
		},
		editsTo(at) {
			return made && made.to === at ? { from: made.from, edits: made.edits } : undefined;
		},
		moveBoard(path, x, y) {
			const id = boardId(path);
			if (id) edit([{ op: "update", id, set: { x: Math.round(x), y: Math.round(y) } }]);
		},
		removeBoard(path) {
			const id = boardId(path);
			if (id) edit([{ op: "delete", id }]);
		},
		resizeBoard(path, size) {
			const id = boardId(path);
			if (id) edit([{ op: "update", id, set: { width: Math.round(size.w), height: Math.round(size.h) } }]);
		},
	};
}
