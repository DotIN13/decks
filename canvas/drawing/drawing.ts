import { parse, type MeasureText, type PenDocument, type PenEdit } from "@decks/pen";
import { createSignal, type Accessor } from "solid-js";
import type { DocEdits } from "../render/types.ts";
import { drawingApi } from "./api.ts";
import type { DrawingHost, DrawingRun } from "./edits.ts";

export { PENDING_MS, together } from "./edits.ts";
export { PAGE_TAGS, cardFrame, isPage, itemKind, pagesAhead, pagesOf } from "./pages.ts";


/**
 * The drawing a canvas edits (`editor.tsx`): the document, the person's edits applied to it
 * with `@decks/pen` as the Decks server applies them (arrows routed again after each), their undo
 * and redo, and every change reported as the edits that make it (`diff`).
 *
 * No page in it, so it is tested on its own (`drawing.test.ts`).
 */
export interface Drawing {
	/** The drawing shown: the host's, with the person's edits still on their way to it on top (`DrawingOptions.host`). */
	doc: Accessor<PenDocument>;
	/** The drawing as the host last gave it, under any of the person's edits on their way: `doc` when there are none. */
	given: Accessor<PenDocument>;
	/** How many of the person's edits are shown ahead of the host's answer. */
	waiting: Accessor<number>;
	/** Pen operations, as the person's edit: applied, kept for undo, reported. False when refused or a no-op. */
	edit(ops: unknown[]): boolean;
	step(direction: "undo" | "redo"): void;
	/**
	 * A newer drawing from elsewhere: shown, not reported, and the person's undo starts again from it.
	 * `edits`, when the host has them, are what made it from the drawing held (`DocEdits`). With a host,
	 * `made` names the person's edits it is the first to have (`stage.pen.delta`'s `made`), which stop
	 * being shown on top of it; the others are shown on top still. `scope` names the drawing (the canvas):
	 * a drawing of another scope drops every edit on its way.
	 */
	set(next: string | PenDocument, edits?: DocEdits, made?: readonly string[], scope?: string): void;
	/**
	 * Edits from elsewhere (another device, an agent: what a host hears as a delta), applied to the
	 * drawing held as `set` would show the drawing they make, without the whole text parsed again.
	 * False when they do not apply to it: the host sends the whole drawing then (`set`).
	 */
	follow(edits: readonly PenEdit[], made?: readonly string[]): boolean;
	/** The host did not make the person's edit (or step) of this name: it is no longer shown. */
	refused(edit: string): void;
	/** The edits that made `doc` from the drawing before it, when it is the drawing now and they are known: the stage applies them. */
	editsTo(doc: PenDocument): DocEdits | undefined;
	/** Whether `doc` is the person's own edit or step, shown at once by their hand: nothing for the stage to glide. */
	ownTo(doc: PenDocument): boolean;
	/** A board on the drawing (by its deck path) moved or resized: its item moved or resized. */
	movePage(path: string, x: number, y: number): void;
	resizePage(path: string, size: { w: number; h: number }): void;
	/** A board taken off the drawing (its file is the host's business): its item deleted. */
	removePage(path: string): void;
}

interface DrawingOptions {
	onEdits?: (edits: PenEdit[], doc: PenDocument) => void;
	/** The scheme the drawing's theme variables are read in. */
	look?: () => "light" | "dark";
	readOnly?: boolean;
	/** How many edits undo reaches back. */
	depth?: number;
	/**
	 * How words are measured to lay an edit out, as the host's server measures them: the stage
	 * engine's (`canvas/render/measure.ts`), so a card sized by its words and the arrows joined to it come
	 * out where the server's drawing will have them. Default: pen's estimate.
	 */
	measure?: MeasureText;
	/**
	 * A drawing the host owns, as the Decks app's server owns its canvases: each edit is handed to
	 * `send` as pen operations with a name of its own (`edit`), and undo and redo are the host's too
	 * (`step`). The edit is shown at once, on top of the drawing the host last gave, until the host
	 * gives a drawing that says it has it (`set`'s `made`); so the person never sees the drawing as it
	 * was before their edit for the round trip. `send` may answer whether the edit was made: refused,
	 * it stops being shown at once; otherwise the host's drawing wins after `PENDING_MS`.
	 * Without a host the drawing is this page's: edits apply here at once, are reported to `onEdits`,
	 * and undo is kept here (Studio, a sharing site).
	 */
	host?: DrawingHost;
}

export function createDrawing(text: string | PenDocument, options: DrawingOptions = {}): Drawing {
	const first = typeof text === "string" ? parse(text) : text;
	const [doc, setDoc] = createSignal<PenDocument>(first);
	const [given, setGiven] = createSignal<PenDocument>(first);
	const [waiting, setWaiting] = createSignal(0);
	const d: DrawingRun = {
		look: options.look ?? (() => "light" as const),
		depth: options.depth ?? 200,
		...(options.measure ? { measure: options.measure } : {}),
		...(options.readOnly ? { readOnly: true } : {}),
		...(options.onEdits ? { onEdits: options.onEdits } : {}),
		...(options.host ? { host: options.host } : {}),
		doc,
		setDoc,
		undoStack: [],
		redoStack: [],
		given,
		setGiven,
		waiting,
		setWaiting,
		pending: [],
		stepsAfter: [],
		history: { undo: [], redo: [] },
		sent: new Map(),
		tab: Math.random().toString(36).slice(2, 8),
		named: 0,
	};
	return drawingApi(d);
}
