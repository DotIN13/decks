import { type AgentView } from "../camera/agent-view.ts";
import { type Drawing } from "../model/drawing.ts";
import type { Setter } from "solid-js";
import { serialize, type PenDocument } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { batch, untrack, type Accessor } from "solid-js";
import type { CanvasEngine } from "../render/engine.ts";
import { setDrawing, setInkTool } from "../ink/ink.ts";
import { penSelection, penTool, setPenSelection, setPenTool } from "../edit/pen-tools.ts";
import type { CanvasHandle } from "./types.ts";
import { fitAll } from "./editor.tsx";
import type { EditorOptions } from "./types.ts";

/** What `createEditorHandle` reads of `createEditor` (`editor.tsx`). */
export interface EditorHandleNeeds {
	readonly engine: CanvasEngine | undefined;
	readonly setPenBase: Setter<string>;
	readonly drawing: Drawing;
	readonly doc: Accessor<PenDocument>;
	readonly setGlideAsk: Setter<{ token: number; ms: number; } | undefined>;
	glides: number;
	readonly putCamera: (next: Camera) => void;
	readonly setDarkSignal: Setter<boolean>;
	readonly paintScheme: () => void;
	readonly setModeSignal: (mode: "edit" | "browse") => void;
	readonly setSelected: Setter<string | undefined>;
	readonly options: EditorOptions;
	readonly selected: Accessor<string | undefined>;
	readonly size: () => { width: number; height: number; };
	readonly look: () => "dark" | "light";
	readonly edit: (ops: unknown[]) => boolean;
	readonly step: (direction: "undo" | "redo") => void;
	readonly camera: Accessor<Camera>;
	readonly firstView: AgentView | undefined;
	readonly reload: (path: string) => { [x: string]: number; };
	readonly disposeViews: (() => void) | undefined;
	readonly tools: () => void;
}

/** The editor's handle: what the host that made it can ask of it. */
export function createEditorHandle(d: EditorHandleNeeds) {
	const handle: CanvasHandle = {
		itemBox: (id) => d.engine?.layout.boxOf(id),
		setDocument: (next, at, made) => {
			if (at !== undefined) d.setPenBase(at);
			d.drawing.set(next, undefined, made);
		},
		applyEdits: (edits, at, made) =>
			batch(() => {
				if (at !== undefined) d.setPenBase(at);
				return d.drawing.follow(edits, made);
			}),
		refused: (id) => d.drawing.refused(id),
		drawn: () => d.doc(),
		// The destination and the journey written together, so the canvas never sees one without the other.
		glide: (to, ms = 420) =>
			batch(() => {
				d.setGlideAsk(ms > 0 ? { token: ++d.glides, ms } : undefined);
				d.putCamera(to);
			}),
		document: () => untrack(d.doc),
		text: () => serialize(untrack(d.doc)),
		setDark(on) {
			d.setDarkSignal(on);
			d.paintScheme();
		},
		setMode(next) {
			if (next === "edit") setDrawing(false);
			setPenTool("select");
			d.setModeSignal(next);
		},
		setDrawing(on, tool) {
			if (on) d.setModeSignal("browse");
			if (tool) setInkTool(tool);
			setDrawing(on);
		},
		setTool(tool) {
			setDrawing(false);
			d.setModeSignal("edit");
			setPenTool(tool);
		},
		tool: () => untrack(penTool),
		select: (ids, page) => {
			setPenSelection(ids);
			if (page === undefined) return;
			d.setSelected(page);
			d.options.onSelect?.(page);
		},
		selection: () => {
			const ids = [...untrack(penSelection)];
			const page = untrack(d.selected);
			const item = page ? (untrack(d.doc).children ?? []).find((one) => (one.metadata as { path?: unknown } | undefined)?.path === page || one.id === page.replace(/^item:/, "")) : undefined;
			return item && !ids.includes(item.id) ? [...ids, item.id] : ids;
		},
		fit: () => d.putCamera(fitAll(untrack(d.doc), d.size(), d.look())),
		edit: d.edit,
		undo: () => d.step("undo"),
		redo: () => d.step("redo"),
		camera: () => untrack(d.camera),
		setCamera: d.putCamera,
		restored: d.firstView !== undefined,
		reloadCard: d.reload,
		dispose() {
			d.disposeViews?.();
			d.tools();
			setDrawing(false);
			setPenTool("select");
		},
	};

	return {
		handle,
	};
}
