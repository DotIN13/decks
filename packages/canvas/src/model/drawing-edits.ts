import type { Setter } from "solid-js";
import { withDecksColors, diff, type PenDocument } from "@decks/pen";
import { untrack, type Accessor } from "solid-js";
import { type DocEdits, type DrawingOptions, type Pending, type Change, PENDING_MS } from "./drawing.ts";

/** What `createDrawingEdits` reads of `createDrawing` (`drawing.ts`), each read when it is used. */
export interface DrawingEditsNeeds {
	readonly options: DrawingOptions;
	readonly doc: Accessor<PenDocument>;
	readonly host: { send(ops: unknown[], edit?: string): void | Promise<boolean>; step(direction: "undo" | "redo", edit?: string): void; } | undefined;
	readonly applied: (prev: PenDocument, ops: unknown[]) => PenDocument;
	readonly nameOne: (what: { step?: "undo" | "redo"; change?: Change; }) => string;
	readonly pending: Pending[];
	readonly setWaiting: Setter<number>;
	readonly show: (next: PenDocument, edits?: DocEdits, own?: boolean) => void;
	readonly flush: () => void;
	readonly commit: (prev: PenDocument, next: PenDocument) => boolean;
	readonly undoStack: PenDocument[];
	readonly depth: number;
	readonly redoStack: PenDocument[];
	readonly given: Accessor<PenDocument>;
	readonly history: { undo: Change[]; redo: Change[]; };
	readonly wait: (id: string, ms: number) => NodeJS.Timeout;
	readonly showOver: (next: PenDocument) => void;
	readonly inFlight: string | undefined;
	readonly stepsAfter: (() => void)[];
}

export function createDrawingEdits(d: DrawingEditsNeeds) {
	const edit = (given: unknown[]) => {
		if (d.options.readOnly || given.length === 0) return false;
		// What the tools make is coloured by the drawing's own light/dark variables: defined here when it lacks them.
		const ops = withDecksColors(untrack(d.doc), given);
		if (d.host) {
			const prev = untrack(d.doc);
			let next: PenDocument | undefined;
			try {
				next = d.applied(prev, ops);
			} catch {
				// Not one this page can make: the host's to answer, as it always was.
				next = undefined;
			}
			if (!next) {
				d.host.send(ops);
				return true;
			}
			const id = d.nameOne({});
			d.pending.push({ id, ops });
			d.setWaiting(d.pending.length);
			// Shown at once, even when nothing changed: the canvas waits for the drawing that answers its gesture.
			d.show(next, { from: prev, edits: diff(prev, next) });
			d.flush();
			return true;
		}
		const prev = untrack(d.doc);
		let next: PenDocument;
		try {
			next = d.applied(prev, ops);
		} catch (error) {
			console.warn("[canvas] an edit was refused:", error instanceof Error ? error.message : error);
			return false;
		}
		if (!d.commit(prev, next)) {
			/*
			 * Nothing changed (an item dropped back where it was), but the canvas is waiting for the drawing
			 * that answers its gesture, as a server sends one whatever the edit did: a fresh copy is that
			 * answer, so what was let go glides back into place now rather than when the canvas gives up.
			 */
			d.show({ ...prev }, { from: prev, edits: [] });
			return false;
		}
		d.undoStack.push(prev);
		if (d.undoStack.length > d.depth) d.undoStack.shift();
		d.redoStack.length = 0;
		return true;
	};

	const step = (direction: "undo" | "redo") => {
		if (d.host) {
			const base = untrack(d.given);
			const stack = direction === "undo" ? d.history.undo : d.history.redo;
			const change = stack[stack.length - 1];
			// Shown ahead only when this page saw the edit it steps through and nothing else since.
			if (!d.pending.length && change && (direction === "undo" ? change.after : change.before) === base) {
				stack.pop();
				(direction === "undo" ? d.history.redo : d.history.undo).push(change);
				const to = direction === "undo" ? change.before : change.after;
				const id = d.nameOne({ step: direction, change });
				d.pending.push({ id, to, base, timer: d.wait(id, PENDING_MS) });
				d.setWaiting(d.pending.length);
				d.showOver(to);
				d.host.step(direction, id);
				return;
			}
			// After the edits still to go, which the host's history has to have first.
			const host = d.host;
			if (d.inFlight || d.pending.some((one) => one.ops && !one.as)) d.stepsAfter.push(() => host.step(direction));
			else d.host.step(direction);
			return;
		}
		const from = direction === "undo" ? d.undoStack : d.redoStack;
		const to = direction === "undo" ? d.redoStack : d.undoStack;
		const target = from.pop();
		if (!target) return;
		const now = untrack(d.doc);
		to.push(now);
		d.commit(now, target);
	};

	return {
		edit,
		step,
	};
}
