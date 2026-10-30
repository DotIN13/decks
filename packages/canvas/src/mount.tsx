import { baseTheme, emptyDocument, parse, placements, serialize, type Frame, type PenDocument, type PenEdit } from "@decks/pen";
import type { Board, Camera } from "@decks/protocol";
import { batch, createComputed, createEffect, createMemo, createRoot, createSignal, on, Show, untrack, type Accessor, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { render } from "solid-js/web";
import { fitInto, frames } from "./camera/camera.ts";
import { topBoxes } from "./model/boxes.ts";
import { viewToPark } from "./camera/agent-view.ts";
import { createAgentViews, type ViewStorage } from "./camera/agent-views.ts";
import { canvasBox, watchInsets } from "./camera/insets.ts";
import { boardsAhead, boardsOf, cardHeightOp, createDrawing, withContentHeights, type CardHeight } from "./model/drawing.ts";
import { stageMeasure } from "./render/measure.ts";
import type { DocEdits, DrawingWriter } from "./render/types.ts";
import { setCanvasHost, type CanvasHost } from "./host.ts";
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

let insetsWatched = false;

/** How long a card's height is let settle (fonts, pictures) before this page writes it to a drawing it keeps. */
const SETTLE_MS = 600;
/** How many times a card grows at one revision before its readings stop raising it: past that, it is chasing its own height. */
const MAX_GROWS = 8;

/** The empty picture: a board with no picture source is drawn as a blank sheet. */
const BLANK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/%3E";


/**
 * The Decks canvas editor, made inside a host's own Solid tree: the stage, its camera, the
 * drawing's tools and properties, and ink. `mountCanvas` puts one in an element for any page; a
 * Solid app (the canvas frame, `frame/frame.tsx`) makes one where its layout wants the stage, with its
 * own mode and ink given in `state`.
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
	/** How many times each board's page has been told to load again (`reloadBoard`). */
	const [reloads, setReloads] = createSignal<Record<string, number>>({});
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
	const { doc, edit, step, moveBoard, resizeBoard, removeBoard } = drawing;

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

	/*
	 * Each card's content height, as its frame measured it (`CardSurface`'s `onExtent`): the stage draws
	 * a card at least that tall (`withContentHeights`), so none is ever cut, whatever height its item
	 * has. Where the drawing is the host's, the host's server writes the height to it from the same
	 * reading (`board-extent`, `StagePens.raiseCard`); where it is this page's (Studio), it is settled
	 * here, as nobody's edit.
	 */
	const [heights, setHeights] = createSignal<Record<string, CardHeight>>({});
	/** How many times each card has grown at its revision: a card whose script lays out to its own height would grow for ever. */
	const grown = new Map<string, { rev: number; times: number }>();
	const settling = new Map<string, ReturnType<typeof setTimeout>>();
	const measured = (path: string, extent: { rev: number; w: number; h: number }): boolean => {
		const was = untrack(heights)[path];
		if (was && was.w === extent.w && extent.h > was.h) {
			const count = grown.get(path);
			const times = count && count.rev === extent.rev ? count.times + 1 : 1;
			grown.set(path, { rev: extent.rev, times });
			// Not shown, nor passed on to the host, whose server would grow it the same way.
			if (times > MAX_GROWS) return false;
		}
		if (was?.w === extent.w && was.h === extent.h) return true;
		setHeights((all) => ({ ...all, [path]: { w: extent.w, h: extent.h } }));
		if (options.document || !editable) return true;
		clearTimeout(settling.get(path));
		settling.set(
			path,
			setTimeout(() => {
				settling.delete(path);
				const node = untrack(doc).children?.find((one) => (one.metadata as { type?: unknown; path?: unknown } | undefined)?.type === "decks.card" && (one.metadata as { path?: unknown }).path === path);
				const board = untrack(() => boards.find((one) => one.path === path));
				const op = node && board && !board.fills ? cardHeightOp(node, extent.w, extent.h) : undefined;
				if (op) drawing.settle([op]);
			}, SETTLE_MS),
		);
		return true;
	};
	/*
	 * A card resized by hand: a height that cuts its content, at the width it was measured at, is the
	 * person's choice and is kept (`fixedHeight`), the card scrolling what does not fit; any other
	 * height lets it grow to its content again.
	 */
	const resized = (path: string, size: { w: number; h: number }) => {
		const board = untrack(() => boards.find((one) => one.path === path));
		if (!board?.card) return resizeBoard(path, size);
		const content = untrack(heights)[path];
		const cuts = !!content && Math.abs(content.w - size.w) <= 1 && size.h < content.h - 1;
		resizeBoard(path, size, cuts);
	};
	/* Fixed for the canvas's life: plain objects, so no prop of the stage is a computation of its own. */
	/*
	 * The board pill's Hide takes the board off this drawing (its file stays), and Delete, when the host
	 * can delete files, takes it off and asks the host to delete the file too.
	 */
	const editing = editable
		? {
				onPenEdit: edit,
				onResize: resized,
				onHide: (path: string) => (options.boards?.onHide ? options.boards.onHide(path) : removeBoard(path)),
				...(options.onDeleteBoard
					? {
							onDeleteBoard: (path: string) => {
								void Promise.resolve(options.onDeleteBoard!(path)).then((deleted) => deleted !== false && removeBoard(path));
							},
						}
					: {}),
			}
		: {};
	const commenting = { ...(options.onComment ? { onComment: options.onComment } : {}), ...(options.onPillMore ? { onPillMore: options.onPillMore } : {}) };

	const tools = createRoot((done) => {
		createEffect(on(penTool, (tool) => options.onTool?.(tool), { defer: true }));
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
	 * Owned by whoever makes the editor (mountCanvas's own root, or the host's component), never by
	 * an effect that runs again: made in Studio's effect once, the boards stopped following the
	 * drawing, so a board moved once and then stayed where the stage last saw it.
	 */
	/*
	 * The same object for a board from one drawing to the next, its fields changed in place, as the
	 * Decks app's store keeps them: the stage keys each board's slot on its object, and a fresh list
	 * on every edit rebuilt every slot and reloaded every board's page after any drag.
	 */
	const [boards, setBoards] = createStore<Board[]>([]);
	/*
	 * A host's list may be a store of its own (the Decks app's): read whole here, every board and
	 * field, so this follows it; reconciling a store's proxy reads it untracked, and the boards would
	 * show only when something else happened to run this again.
	 */
	createComputed(() => {
		const given = options.boards?.list ? options.boards.list().map((board) => ({ ...board })) : boardsOf(doc());
		// The host's own list is its server's: a board the person moved, sized or took off is shown so until the server has it.
		const listed = options.boards?.list && drawing.waiting() ? boardsAhead(given, drawing.given(), doc()) : given;
		setBoards(reconcile(withContentHeights(listed, doc(), heights()), { key: "path" }));
	});
	/* Memos rather than `a() && b()` in the props: the stage reads them in its pointer handlers, outside any owner. */
	const inking = createMemo(() => (options.state?.inking ? options.state.inking() : inkOn()) && mode() === "browse");
	const stageView = () => (
		<Stage
			mode={mode()}
			onExtent={(path, extent) => {
				if (measured(path, extent)) options.boards?.onExtent?.(path, extent);
			}}
			{...(options.boards?.onOpenLink ? { onOpenBoard: options.boards.onOpenLink } : {})}
			news={options.boards?.news?.() ?? {}}
			{...(options.boards?.onRead ? { onRead: options.boards.onRead } : {})}
			{...(options.onViewport ? { onViewport: options.onViewport } : {})}
			{...(options.onRefer ? { onRefer: options.onRefer } : {})}
			glide={ownGlide()}
			boardPill={true}
			{...(options.onProperties ? { onProperties: options.onProperties } : {})}
			opening={{ get camera() {
				return asked ?? opening;
			} }}
			{...(options.canvasName ? { stageName: options.canvasName() } : {})}
			onTool={() => setPenTool("select")}
			boards={boards}
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
			onMove={moveBoard}
			frame={(slot) => <ItemSlot {...slot} reload={reloads()[slot.board.path]} page={options.boards?.page?.(slot.board.path)} {...(options.boards?.cardScripts && !options.boards.cardScripts(slot.board.path) ? { cardScripts: false, ...(options.boards.onScriptsOn && editable && !slot.board.path.startsWith("shared/") ? { onScriptsOn: () => options.boards!.onScriptsOn!(slot.board.path) } : {}) } : {})} />}
			shots={() => ({ picture: (board, scheme) => options.boards?.picture?.(board.path, scheme) ?? BLANK })}
			{...commenting}
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
		reloadBoard: (path) => setReloads((all) => ({ ...all, [path]: (all[path] ?? 0) + 1 })),
		dispose() {
			disposeViews?.();
			tools();
			setDrawing(false);
			setPenTool("select");
		},
	};
	return { handle, surface, root, dispose: () => handle.dispose() };
}

/**
 * Mount the Decks canvas in `host`: the stage, its camera, the drawing's tools and properties,
 * and ink, editing a `.pen` document held here. Every change the person makes is applied here at
 * once and reported to `onEdits` (or, with `document`, handed to the host); `setDocument` takes
 * one from elsewhere. Any page can use it; a Solid app can use `createEditor` in its own tree.
 */
export function mountCanvas(host: HTMLElement, options: CanvasOptions): CanvasHandle {
	/*
	 * What the host's panels cover, so a fit frames into the canvas between them and the camera
	 * keeps what is picked clear of them: each panel standing beside the canvas says so with
	 * `data-inset="left"` (or right, top, bottom), as the Decks app's do. Once a page.
	 */
	if (!insetsWatched && typeof document !== "undefined") {
		insetsWatched = true;
		watchInsets();
	}
	/*
	 * The scheme on the host, and on the page's root as the Decks app does: the menus and panels the
	 * canvas opens in a portal on <body> read their colours from there.
	 */
	const rootScheme = document.documentElement.dataset.colorScheme;
	// What the canvas asks its host (`host.ts`); a Solid app making the editor itself answers them itself.
	const base = options.base ?? (typeof location === "undefined" ? "/" : location.href);
	const answers: Partial<CanvasHost> = {
		fileUrl: options.resolveUrl ?? ((path) => new URL(path, new URL(base, typeof location === "undefined" ? "http://canvas.invalid/" : location.href)).href),
		canWrite: () => !options.readOnly,
		boardLink: options.boardLink ?? (() => undefined),
		iconUrl: options.icons,
		// A host that reads deck files by path reads the drawing's pictures the same way.
		...(options.resolveUrl ? { pictureUrl: (url: string) => options.resolveUrl!(url) } : {}),
	};
	setCanvasHost(answers);
	let made!: Editor;
	const disposeRender = render(() => {
		made = createEditor({
			...options,
			size: () => ({ width: host.clientWidth, height: host.clientHeight }),
			onScheme: (scheme) => {
				host.dataset.colorScheme = scheme;
				document.documentElement.dataset.colorScheme = scheme;
			},
		});
		return made.root();
	}, host);
	return {
		...made.handle,
		dispose() {
			made.dispose();
			disposeRender();
			delete host.dataset.colorScheme;
			if (rootScheme === undefined) delete document.documentElement.dataset.colorScheme;
			else document.documentElement.dataset.colorScheme = rootScheme;
		},
	};
}
