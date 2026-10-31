import { baseTheme, emptyDocument, parse, placements, serialize, type Frame, type PenDocument, type PenEdit } from "@decks/pen";
import type { Page, Camera } from "@decks/protocol";
import { batch, createComputed, createEffect, createMemo, createRoot, createSignal, on, Show, untrack, type Accessor, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { fitInto, frames } from "./camera/camera.ts";
import { topBoxes } from "./model/boxes.ts";
import { viewToPark } from "./camera/agent-view.ts";
import { createAgentViews, type ViewStorage } from "./camera/agent-views.ts";
import { canvasBox } from "./camera/insets.ts";
import { pagesAhead, pagesOf, createDrawing } from "./model/drawing.ts";
import { stageMeasure } from "./render/measure.ts";
import type { DocEdits, DrawingWriter } from "./render/types.ts";
import { InkBar } from "./ui/InkBar.tsx";
import { setCanvasScheme } from "./lib/theme.ts";
import { PenBar } from "./ui/PenBar.tsx";
import { ItemSlot } from "./items/item-slot.tsx";
import { Stage, type InkRequest, type StageComment } from "./stage/Stage.tsx";
import { drawing as inkOn, setDrawing, setInkTool, type InkTool } from "./edit/ink.ts";
import { penSelection, penTool, setPenSelection, setPenTool, type PenTool } from "./edit/pen-tools.ts";

export type { CanvasHandle, CanvasOptions, Editor, EditorOwnState, EditorState } from "./types.ts";
import type { CanvasHandle, CanvasOptions, Editor, EditorOwnState, EditorState } from "./types.ts";

/** A camera that shows everything on the drawing, in a host this big. */
export function fitAll(doc: PenDocument, view: { width: number; height: number }, look: "light" | "dark" = "light"): Camera {
	return fitInto(topBoxes(doc, look), view, canvasBox(view));
}

/** The empty picture: a board with no picture source is drawn as a blank sheet. */
const BLANK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/%3E";


/**
 * The Decks canvas editor, made inside a host's own Solid tree: the stage, its camera, the
 * drawing's tools and properties, and ink. The canvas frame (`frame/inside/frame.tsx`) makes it where
 * its layout wants the stage, with its own mode and ink given in `state`.
 *
 * One canvas to a page: the tools and the host's answers are module state, as they are in the
 * Decks app.
 */
export function createEditor(
	options: CanvasOptions & {
		state?: EditorOwnState;
		/** How big the stage is on screen. Default: the window. */
		size?: () => { width: number; height: number };
		/** The scheme changed (`setDark`): a host paints it where its own styles read it. */
		onScheme?: (scheme: "light" | "dark") => void;
	},
): Editor {
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
	const drawing = createDrawing(first, { look, measure: stageMeasure, readOnly: options.readOnly === true, ...(options.onEdits ? { onEdits: options.onEdits } : {}), ...(options.document ? { host: options.document } : {}) });
	/** What the drawing's own addresses are read against; a host that moves between canvases says so with `setDocument`. */
	const [penBase, setPenBase] = createSignal(base);
	/** A glide the host asked for (`glide`): the stage animates to the camera it is given while the token is new. */
	const [ownGlide, setGlideAsk] = createSignal<{ token: number; ms: number }>();
	let glides = 0;
	const { doc, edit, step, movePage, resizePage, removePage } = drawing;

	const setCamera = (next: Camera) => {
		setCameraSignal(next);
		options.onCamera?.(next);
	};
	/*
	 * The camera the host put the canvas at (`setCamera`, `glide`, `fit`), if it has: what the stage opens on
	 * when its boards first arrive, rather than the camera it was made with. A canvas frame is made with the
	 * page's camera as it was, and the page's landing can reach it before its boards do; opening on the
	 * camera it was made with then undid the landing, and the frame told the page so.
	 */
	let asked: Camera | undefined;
	const putCamera = (next: Camera) => {
		asked = next;
		setCamera(next);
	};

	/*
	 * Park the view under its scope as the camera moves (a little after it stops), when the scope
	 * changes, when the page goes and when the canvas is unmounted; bring the new scope's back.
	 */
	const park = (scope: string | undefined) => {
		if (scope && views) views.keep(scope, undefined, viewToPark(untrack(camera), untrack(penSelection)[0]));
	};
	let parkTimer: ReturnType<typeof setTimeout> | undefined;
	const disposeViews = options.views
		? createRoot((done) => {
				const scope = options.views!.scope;
				createEffect(
					on(scope, (next, prev) => {
						if (prev) park(prev);
						const v = kept(next, untrack(doc), untrack(look));
						if (!v) return;
						setCamera(v.camera);
						if (v.selected) setPenSelection([v.selected]);
					}, { defer: true }),
				);
				createEffect(
					on(camera, () => {
						clearTimeout(parkTimer);
						const at = untrack(scope);
						parkTimer = setTimeout(() => park(at), 400);
					}, { defer: true }),
				);
				const onHide = () => park(untrack(scope));
				addEventListener("pagehide", onHide);
				return () => {
					clearTimeout(parkTimer);
					park(untrack(scope));
					removeEventListener("pagehide", onHide);
					done();
				};
			})
		: undefined;
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
		return { doc: now, base: penBase(), ...(edits ? { edits } : {}) };
	});
	/*
	 * Owned by whoever makes the editor (the canvas frame's render root), never by
	 * an effect that runs again: made in Studio's effect once, the boards stopped following the
	 * drawing, so a board moved once and then stayed where the stage last saw it.
	 */
	/*
	 * The same object for a board from one drawing to the next, its fields changed in place, as the
	 * Decks app's store keeps them: the stage keys each board's slot on its object, and a fresh list
	 * on every edit rebuilt every slot and reloaded every board's page after any drag.
	 */
	const [pages, setPages] = createStore<Page[]>([]);
	/*
	 * A host's list may be a store of its own (the Decks app's): read whole here, every board and
	 * field, so this follows it; reconciling a store's proxy reads it untracked, and the boards would
	 * show only when something else happened to run this again.
	 */
	createComputed(() => {
		const given = options.pages?.list ? options.pages.list().map((board) => ({ ...board })) : pagesOf(doc());
		// The host's own list is its server's: a board the person moved, sized or took off is shown so until the server has it.
		setPages(reconcile(options.pages?.list && drawing.waiting() ? pagesAhead(given, drawing.given(), doc()) : given, { key: "path" }));
	});
	/* Memos rather than `a() && b()` in the props: the stage reads them in its pointer handlers, outside any owner. */
	const inking = createMemo(() => (options.state?.inking ? options.state.inking() : inkOn()) && mode() === "browse");
	const stageView = () => (
		<Stage
			mode={mode()}
			{...(options.pages?.onExtent ? { onExtent: options.pages.onExtent } : {})}
			{...(options.pages?.onOpenLink ? { onOpenPage: options.pages.onOpenLink } : {})}
			news={options.pages?.news?.() ?? {}}
			{...(options.pages?.onRead ? { onRead: options.pages.onRead } : {})}
			{...(options.onViewport ? { onViewport: options.onViewport } : {})}
			{...(options.onRefer ? { onRefer: options.onRefer } : {})}
			glide={ownGlide()}
			opening={{ get camera() {
				return asked ?? opening;
			} }}
			{...(options.canvasName ? { stageName: options.canvasName() } : {})}
			onTool={() => setPenTool("select")}
			boards={pages}
			pen={pen()}
			{...editing}
			onPenStep={step}
			drawing={inking()}
			camera={camera()}
			setCamera={setCamera}
			selected={selected()}
			onSelect={(path) => {
			setSelected(path);
			options.onSelect?.(path);
			/* A press on bare canvas takes the focus, which is how an edit in a note or a board ends (as in the Decks app). */
			if (!path) document.querySelector<HTMLElement>(".decks-canvas .stage, .stage")?.focus();
			}}
			onMove={movePage}
			frame={(slot) => <ItemSlot {...slot} reload={reloads()[slot.board.path]} page={options.pages?.page?.(slot.board.path)} {...(options.pages?.cardScripts && !options.pages.cardScripts(slot.board.path) ? { cardScripts: false, ...(options.pages.onScriptsOn && editable && !slot.board.path.startsWith("shared/") ? { onScriptsOn: () => options.pages!.onScriptsOn!(slot.board.path) } : {}) } : {})} />}
			shots={() => ({ picture: (board, scheme) => options.pages?.picture?.(board.path, scheme) ?? BLANK })}
			{...(options.onComment ? { onComment: options.onComment } : {})}
			{...(options.onInk ? { onInk: options.onInk } : {})}
			inkAgent={options.inkAgent?.()}
		/>
	);
	const surface = () => stageView();
	const root = () => (
		<div class="decks-canvas app" data-mode={mode()}>
			<div class="work">
				<div class="surface" data-surface="stage">
					<div class="surface-layer" data-layer="stage">
						{stageView()}
					</div>
				</div>
			</div>
			<Show when={editable && !inking()}>
				<PenBar tools={options.toolbar !== false} doc={doc()} onEdit={edit} onStep={step} onArm={() => {}} onExport={(ids) => options.onExport?.(ids)} />
			</Show>
			<Show when={editable && inking()}>
				<InkBar onDone={() => setDrawing(false)} onStep={step} onDelete={(ids) => edit(ids.map((id) => ({ op: "delete", id })))} />
			</Show>
		</div>
	);

	const handle: CanvasHandle = {
		setDocument: (next, at, made) => {
			if (at !== undefined) setPenBase(at);
			drawing.set(next, undefined, made);
		},
		applyEdits: (edits, at, made) =>
			batch(() => {
				if (at !== undefined) setPenBase(at);
				return drawing.follow(edits, made);
			}),
		refused: (id) => drawing.refused(id),
		drawn: () => doc(),
		// The destination and the journey written together, so the stage never sees one without the other.
		glide: (to, ms = 420) =>
			batch(() => {
				setGlideAsk(ms > 0 ? { token: ++glides, ms } : undefined);
				putCamera(to);
			}),
		document: () => untrack(doc),
		text: () => serialize(untrack(doc)),
		setDark(on) {
			setDarkSignal(on);
			paintScheme();
		},
		setMode(next) {
			if (next === "edit") setDrawing(false);
			setPenTool("select");
			setModeSignal(next);
		},
		setDrawing(on, tool) {
			if (on) setModeSignal("browse");
			if (tool) setInkTool(tool);
			setDrawing(on);
		},
		setTool(tool) {
			setDrawing(false);
			setModeSignal("edit");
			setPenTool(tool);
		},
		tool: () => untrack(penTool),
		select: (ids, page) => {
			setPenSelection(ids);
			if (page === undefined) return;
			setSelected(page);
			options.onSelect?.(page);
		},
		selection: () => {
			const ids = [...untrack(penSelection)];
			const page = untrack(selected);
			const item = page ? (untrack(doc).children ?? []).find((one) => (one.metadata as { path?: unknown } | undefined)?.path === page || one.id === page.replace(/^item:/, "")) : undefined;
			return item && !ids.includes(item.id) ? [...ids, item.id] : ids;
		},
		fit: () => putCamera(fitAll(untrack(doc), size(), look())),
		edit,
		undo: () => step("undo"),
		redo: () => step("redo"),
		camera: () => untrack(camera),
		setCamera: putCamera,
		restored: firstView !== undefined,
		reloadCard: reload,
		reloadBoard: reload,
		dispose() {
			disposeViews?.();
			tools();
			setDrawing(false);
			setPenTool("select");
		},
	};
	return { handle, surface, root, dispose: () => handle.dispose() };
}
