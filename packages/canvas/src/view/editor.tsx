import { emptyDocument, parse, type PenDocument } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { createEffect, createMemo, createRoot, createSignal, on, untrack } from "solid-js";
import { fitInto, frames } from "../camera/camera.ts";
import { topBoxes } from "../model/boxes.ts";
import { createAgentViews } from "../camera/agent-views.ts";
import { canvasBox } from "../camera/insets.ts";
import type { CanvasEngine } from "../render/engine.ts";
import { createDrawing } from "../model/drawing.ts";
import { canvasMeasure } from "../render/measure.ts";
import { setCanvasScheme } from "../base/theme.ts";
import { penSelection, setPenSelection } from "../edit/pen-tools.ts";

export type { CanvasHandle, CanvasOptions, Editor, EditorOwnState, EditorState } from "./types.ts";
import type { Editor, EditorOptions } from "./types.ts";
import { drawing as inkOn } from "../ink/ink.ts";
import { createEditorHandle } from "./editor-handle.ts";
import { createEditorView } from "./editor-view.tsx";
import { createEditorPages } from "./editor-pages.ts";
import { createEditorCamera } from "./editor-camera.ts";

/** A camera that shows everything on the drawing, in a host this big. */
export function fitAll(doc: PenDocument, view: { width: number; height: number }, look: "light" | "dark" = "light"): Camera {
	return fitInto(topBoxes(doc, look), view, canvasBox(view));
}



/**
 * The Decks canvas editor, made inside a host's own Solid tree: the stage, its camera, the
 * drawing's tools and properties, and ink. The canvas frame (`frame/inside/frame.tsx`) makes it where
 * its layout wants the stage, with its own mode and ink given in `state`.
 *
 * One canvas to a page: the tools and the host's answers are module state, as they are in the
 * Decks app.
 */
export function createEditor(options: EditorOptions): Editor {
	const size = () => options.size?.() ?? { width: innerWidth, height: innerHeight };
	// No text is an empty drawing.
	const first: PenDocument = options.text.trim() ? parse(options.text) : emptyDocument();
	const base = options.base ?? (typeof location === "undefined" ? "/" : location.href);

	// ---- views, per scope (`options.views`) ----
	const views = options.views ? createAgentViews(options.views.key ?? "canvas", options.views.storage) : undefined;
	const boxesOf = topBoxes;
	/** The view kept for a scope, if it still shows something on this drawing. */
	const kept = (scope: string | undefined, d: PenDocument, scheme: "light" | "dark") => {
		const v = scope && views ? views.of(scope, undefined) : undefined;
		return v && frames(v.camera, size(), boxesOf(d, scheme)) ? v : undefined;
	};
	const firstScope = options.views ? untrack(options.views.scope) : undefined;
	const firstView = kept(firstScope, first, options.dark ? "dark" : "light");

	const opening = firstView?.camera ?? options.camera ?? fitAll(first, size(), options.dark ? "dark" : "light");
	const [camera, setCameraSignal] = createSignal<Camera>(opening);
	/** How many times each card has been told to load again (`reloadCard`). */
	const [reloads, setReloads] = createSignal<Record<string, number>>({});
	const reload = (path: string) => setReloads((all) => ({ ...all, [path]: (all[path] ?? 0) + 1 }));
	const [mode, setModeSignal] = options.state?.mode ?? createSignal<"edit" | "browse">(options.mode ?? "edit");
	const [selected, setSelected] = createSignal<string | undefined>();
	const [dark, setDarkSignal] = createSignal(options.dark === true);
	const look = () => (dark() ? "dark" : "light");
	/*
	 * On the host, and on the page's root as the Decks app does: the menus and panels the canvas
	 * opens in a portal on <body> read their colours from there.
	 */
	const paintScheme = () => {
		setCanvasScheme(look());
		options.onScheme?.(look());
	};
	paintScheme();

	// Laid out with the stage engine's words, as the server lays its drawing out, so an edit shown ahead of it routes its arrows where the server will.
	const drawing = createDrawing(first, { look, measure: canvasMeasure, readOnly: options.readOnly === true, ...(options.onEdits ? { onEdits: options.onEdits } : {}), ...(options.document ? { host: options.document } : {}) });
	/** What the drawing's own addresses are read against; a host that moves between canvases says so with `setDocument`. */
	const [penBase, setPenBase] = createSignal(base);
	/** A glide the host asked for (`glide`): the stage animates to the camera it is given while the token is new. */
	const [ownGlide, setGlideAsk] = createSignal<{ token: number; ms: number }>();
	let glides = 0;
	const { doc, edit, step, movePage, resizePage, removePage, collapsePage } = drawing;

	/** The stage's engine, once the stage is made (`CanvasView` `onEngine`): the layout the handle answers from. */
	let engine: CanvasEngine | undefined;
	const editorCamera = createEditorCamera({ setCameraSignal, options, views, camera, kept, doc, look });
	const { setCamera, putCamera, disposeViews } = editorCamera;
	if (firstView?.selected) setPenSelection([firstView.selected]);

	const editable = !options.readOnly;
	/* Fixed for the canvas's life: plain objects, so no prop of the stage is a computation of its own. */
	/*
	 * The board pill's Hide takes the board off this drawing (its file stays), and Delete, when the host
	 * can delete files, takes it off and asks the host to delete the file too.
	 */
	const editing = editable
		? {
				onPenEdit: edit,
				onResize: resizePage,
				onHide: (path: string) => (options.pages?.onHide ? options.pages.onHide(path) : removePage(path)),
				onCollapse: collapsePage,
				...(options.onDeleteCard
					? {
							onDeleteCard: (path: string) => {
								void Promise.resolve(options.onDeleteCard!(path)).then((deleted) => deleted !== false && removePage(path));
							},
						}
					: {}),
			}
		: {};

	const tools = createRoot((done) => {
		createEffect(on(penSelection, (ids) => options.onSelection?.(ids), { defer: true }));
		return done;
	});

	// With what made the drawing from the last one, when known, so the stage's engines apply just that.
	const pen = createMemo(() => {
		const now = doc();
		const edits = drawing.editsTo(now);
		return { doc: now, base: penBase(), ...(edits ? { edits } : {}), ...(drawing.ownTo(now) ? { own: true as const } : {}) };
	});
	const { pages } = createEditorPages({ options, doc, drawing });
	/* Memos rather than `a() && b()` in the props: the stage reads them in its pointer handlers, outside any owner. */
	const inking = createMemo(() => (options.state?.inking ? options.state.inking() : inkOn()) && mode() === "browse");
	const { surface, root } = createEditorView({
		mode, options, ownGlide, opening, pages, pen, editing, step, inking, setModeSignal, camera, setCamera, selected, setSelected,
		movePage, reloads, reload, editable, doc, edit,
		get asked() { return editorCamera.asked; },
		get engine() { return engine; },
		set engine(next) { engine = next; },
	});

	const { handle } = createEditorHandle({
		setPenBase, drawing, doc, setGlideAsk, putCamera, setDarkSignal, paintScheme, setModeSignal, setSelected, options, selected, size,
		look, edit, step, camera, firstView, reload, disposeViews, tools,
		get engine() { return engine; },
		get glides() { return glides; },
		set glides(next) { glides = next; },
	});
	return { handle, surface, root, dispose: () => handle.dispose() };
}
