import { editDocument, parse, type PenDocument } from "@decks/pen";
import { untrack } from "solid-js";
import { drop, edit, forgetHistory, show, step, type DrawingRun } from "./edits.ts";
import { isPage, pagePath } from "./pages.ts";
import { receive } from "./receive.ts";

// The Drawing object a canvas holds: each of its methods, over the state edits.ts keeps.

/** The object `createDrawing` answers (its `Drawing`), over the state it holds. */
export function drawingApi(d: DrawingRun) {
	const host = d.host;
	const pageId = (path: string) => untrack(d.doc).children?.find((node) => isPage(node) && pagePath(node) === path)?.id;
	const doEdit = (ops: unknown[]) => edit(d, ops);
	return {
		doc: d.doc,
		given: () => (host ? d.given() : d.doc()),
		waiting: d.waiting,
		edit: doEdit,
		step: (direction: "undo" | "redo") => step(d, direction),
		set(next: string | PenDocument, edits?: Parameters<typeof receive>[2], madeHere?: readonly string[], at?: string) {
			const parsed = typeof next === "string" ? parse(next) : next;
			if (host) return receive(d, parsed, edits, madeHere, at);
			show(d, parsed, edits);
			d.undoStack.length = 0;
			d.redoStack.length = 0;
		},
		follow(edits: Parameters<typeof editDocument>[1], madeHere?: readonly string[]) {
			const now = untrack(host ? d.given : d.doc);
			let next: PenDocument;
			try {
				next = editDocument(now, edits);
			} catch {
				return false;
			}
			if (host) {
				receive(d, next, { from: now, edits }, madeHere, d.scope);
				return true;
			}
			show(d, next, { from: now, edits });
			d.undoStack.length = 0;
			d.redoStack.length = 0;
			return true;
		},
		refused(id: string) {
			const what = d.sent.get(id);
			if (what?.step) forgetHistory(d);
			drop(d, id);
		},
		editsTo(at: PenDocument) {
			return d.made && d.made.to === at ? { from: d.made.from, edits: d.made.edits } : undefined;
		},
		ownTo(at: PenDocument) {
			return d.ownDoc === at;
		},
		movePage(path: string, x: number, y: number) {
			const id = pageId(path);
			if (id) doEdit([{ op: "update", id, set: { x: Math.round(x), y: Math.round(y) } }]);
		},
		removePage(path: string) {
			const id = pageId(path);
			if (id) doEdit([{ op: "delete", id }]);
		},
		resizePage(path: string, size: { w: number; h: number }) {
			const id = pageId(path);
			if (id) doEdit([{ op: "update", id, set: { width: Math.round(size.w), height: Math.round(size.h) } }]);
		},
	};
}
