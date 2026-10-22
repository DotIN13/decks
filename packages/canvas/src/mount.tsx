import { baseTheme, emptyDocument, parse, placements, serialize, type Frame, type PenDocument, type PenEdit } from "@decks/pen";
import type { Board, Camera } from "@decks/protocol";
import { batch, createComputed, createEffect, createMemo, createRoot, createSignal, on, Show, untrack, type Accessor, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { render } from "solid-js/web";
import { fitInto, frames } from "./camera/camera.ts";
import { viewToPark } from "./camera/agent-view.ts";
import { createAgentViews, type ViewStorage } from "./camera/agent-views.ts";
import { canvasBox, watchInsets } from "./camera/insets.ts";
import { createBoardHost, type MintBoardToken } from "./board-host.ts";
import { boardsOf, createDrawing } from "./drawing.ts";
import { setCanvasHost, type CanvasHost } from "./host.ts";
import { InkBar } from "./ink/InkBar.tsx";
import { setCanvasScheme } from "./lib/theme.ts";
import { PenBar } from "./pen/PenBar.tsx";
import { PlainBoard } from "./plain-board.tsx";
import { Stage, type StageComment } from "./Stage.tsx";
import type { RendererChoice } from "./lib/renderer.ts";
import { drawing as inkOn, setDrawing, setInkTool, type InkTool } from "./state/ink.ts";
import { penSelection, penTool, setPenSelection, setPenTool, type PenTool } from "./state/pen-tools.ts";

/** What a host gives `mountCanvas`. Only `text` is needed. */
export interface CanvasOptions {
	/** The drawing: a `.pen` file's text (`canvas.pen`). */
	text: string;
	/** Draw in the dark scheme. Default: light. */
	dark?: boolean;
	/**
	 * The person changed the drawing: the edits that make the last document into this one
	 * (`@decks/pen`'s `diff`), and the new document. The host saves them; the canvas has already
	 * drawn them. Undo and redo arrive here too, as the edits they make.
	 */
	onEdits?: (edits: PenEdit[], doc: PenDocument) => void;
	/**
	 * The boards on the drawing (its `browser` items with `metadata.type: "decks.board"`), by their
	 * deck path: the address of a board's live page, if it has one here, and of its picture, for
	 * the sheet that draws every board without a page. Absent: boards are drawn as empty frames.
	 */
	boards?: {
		page?(path: string): string | undefined;
		picture?(path: string, scheme: "light" | "dark"): string | undefined;
		/**
		 * A board's own token, for its buttons (`board-host.ts`): the host asks the harness the board's
		 * page came from (`POST /api/tokens { kind: "board", path }`), and the canvas hands it to that
		 * board's frame alone. Undefined, or absent, when a board can have none here: its buttons then
		 * say they have no stage.
		 */
		mintBoardToken?: MintBoardToken;
		/**
		 * Whether a board is a friend's, on a canvas shared with the person (`board-storage.ts`): its frame
		 * is sandboxed with no token, and its `localStorage` is kept by this page under `storageKey`.
		 */
		sandboxed?(path: string): boolean;
		/** Where a sandboxed board's storage is kept in this page's own storage: one key per harness, canvas and board. */
		storageKey?(path: string): string;
		/**
		 * The host's own records of the boards (their revision, format and title), as its server keeps
		 * them, in place of the ones read off the drawing. Read reactively.
		 */
		list?(): Board[];
		/** A board's page measured itself (same-origin pages only): its size and how it reads, for the host's agents. */
		onExtent?(path: string, extent: { rev: number; w: number; h: number; at?: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number; flows?: true }): void;
		/** A double-click on empty canvas: make a board there (or a deck of slides). Absent: nothing happens. */
		onCreate?(at: { x: number; y: number }, format?: "board" | "slides"): void;
		/** The canvas menu's Open document, at a point. */
		onOpenDocument?(at: { x: number; y: number }): void;
		/** A link on a board to another board: open it, and say whether this host has it. */
		onOpenLink?(path: string, from: string): boolean;
		/** Boards written since the person last looked (path to who wrote them): each shows a dot. Read reactively. */
		news?(): Record<string, string>;
		/** The person looked at a board with a dot. */
		onRead?(path: string): void;
		/** Whether the boards' pages may start loading yet (the host may hold them until the canvas has opened). Read reactively. */
		mayStart?(): boolean;
		/** Every board on screen has started. */
		onStarted?(): void;
		/** The host is moving to another canvas: the boards hold still until it has. Read reactively. */
		switching?(): boolean;
		/** Pictures of boards the host takes itself (in the browser), in place of `picture`. */
		shots?(): import("./Stage.tsx").StageShots;
		/** A board's Hide, when the host takes it off the canvas itself (its server); absent: taken off this drawing. */
		onHide?(path: string): void;
		/** Words on a board with a comment waiting on them, kept marked in its page. Read reactively. */
		marks?(path: string): Array<{ id: string; quote: string; component?: string }>;
	};
	/**
	 * The folder the drawing's own relative addresses are read against (image fills, files on the
	 * canvas): normally the URL of the folder the `.pen` file is in. Default: the page's address.
	 */
	base?: string;
	/** Where a deck file is read (an image or a file opened in a tab). Default: `path` against `base`. */
	resolveUrl?: (path: string, rev?: number) => string;
	/** Where an icon's SVG is, before the CDN is asked. */
	icons?: (library: string, name: string, weight: number) => string | undefined;
	/** A link on the drawing that names a board this host opens on the canvas: that board's path. */
	boardLink?: (href: string, base: string) => string | undefined;
	/** `edit` (the default) to change the drawing, `browse` to read it and draw ink over it. */
	mode?: "edit" | "browse";
	/** Nothing can be changed: no tools, no edits. */
	readOnly?: boolean;
	/** Where the camera starts. Default: the view kept for `views.scope`, else a fit of what is on the drawing. */
	camera?: Camera;
	/**
	 * Keep where the person was looking, on this device, per scope: the host says what a view
	 * belongs to and the editor parks and restores it. The Decks app's scope is an agent on a canvas
	 * (`agent@canvas`), so each conversation has its own view; Studio's is the canvas. When the scope
	 * changes, the view is parked under the old one and the new one's comes back, if it still shows
	 * something on the drawing; a scope seen for the first time leaves the camera where it is.
	 */
	views?: {
		scope: () => string | undefined;
		/** Where views are kept: `localStorage` unless said (a test passes its own). */
		storage?: ViewStorage;
		/** What the store is called, so two hosts on one origin keep theirs apart. Default "canvas". */
		key?: string;
	};
	/** The camera moved (a pan, a zoom, a fit). */
	onCamera?: (camera: Camera) => void;
	/** The select tool picked by its key (V): a host with tools of its own puts them down too. */
	onSelectTool?: () => void;
	/** The canvas shown, by name: the stage lands on a new one, and each board's token names it. */
	canvasName?: () => string | undefined;
	/** How big the canvas is on screen, when it changes: a host whose agents ask what the person sees. */
	onViewport?: (viewport: { width: number; height: number }) => void;
	/** Boards or items dragged onto the host's composer, to talk about them. */
	onRefer?: (pills: Array<{ kind: "board" | "item"; id: string; label: string }>) => void;
	/** A swipe in from the screen's left or right edge (touch): the host's side panels. */
	onEdgeSwipe?: { left: () => void; right: () => void; enabled: () => boolean };
	/**
	 * A drawing the host owns (its server): edits go to `send` as pen operations and show when the
	 * host's answer arrives through `setDocument`; undo and redo are `step`'s. Absent: the drawing is
	 * this page's, and `onEdits` hears every change.
	 */
	document?: { send(ops: unknown[]): void; step(direction: "undo" | "redo"): void };
	/** The board selected on the canvas, or none. */
	onSelect?: (path: string | undefined) => void;
	/** Comment on a board or on drawn items (the comment buttons; absent: none). */
	onComment?: (comment: StageComment) => void;
	/** Export drawn items as a picture (the properties panel's export; absent: nothing happens). */
	onExport?: (ids: string[]) => void;
	/**
	 * Draw the canvas's own column of tools. Default: true. A host with its own tools turns it off
	 * and drives them with `setTool`; the properties panel still shows for what is selected.
	 */
	toolbar?: boolean;
	/**
	 * A board's file to delete, from the board pill's Delete: the host deletes it (asking first, if it
	 * likes) and says whether it did; the board then leaves the drawing. Absent: no Delete on the pill.
	 */
	onDeleteBoard?: (path: string) => boolean | void | Promise<boolean | void>;
	/** The host's own menu on the pill (its ⋯): for a board by its path, or for drawn items by their ids. Absent: no ⋯. */
	onPillMore?: (on: { path?: string; ids?: string[] }, anchor: DOMRect) => void;
	/** The pill's Properties was pressed: show the host's own properties panel. Absent: the canvas's own opens. */
	onProperties?: () => void;
	/** How boards are drawn: each a live page (`dom`, the default), or each into its own canvas where the browser can (`canvas-per-board`). */
	renderer?: RendererChoice;
	/** Boards as pictures while the camera moves (`Stage`'s `picturesWhileMoving`): on unless set false, since a pan then moves flat pictures instead of repainting pages. */
	picturesWhileMoving?: boolean;
	/** The tool in hand changed (by `setTool`, a key, or placing what it makes). */
	onTool?: (tool: PenTool) => void;
	/** The drawn items selected changed (their ids), by the person or by `select`. */
	onSelection?: (ids: readonly string[]) => void;
}

/** A mounted canvas. */
export interface CanvasHandle {
	/** A newer drawing arrived from elsewhere (another device, an agent): draw it. Not an edit, so no `onEdits`. */
	setDocument(text: string | PenDocument, base?: string): void;
	/** Move the camera there, gliding unless `ms` is 0: an agent showing the person something. */
	glide(camera: Camera, ms?: number): void;
	/** The drawing as it is now. */
	document(): PenDocument;
	/** The drawing as `.pen` text. */
	text(): string;
	setDark(dark: boolean): void;
	setMode(mode: "edit" | "browse"): void;
	/** Turn ink on (browse mode: pen, marker, eraser and lasso over the canvas) or off, with that ink tool in hand. */
	setDrawing(on: boolean, tool?: InkTool): void;
	/** Take a tool in hand, in edit mode: `select` puts it down. */
	setTool(tool: PenTool): void;
	/** The tool in hand now. */
	tool(): PenTool;
	/** Fit everything on the drawing in the host. */
	fit(): void;
	/** Select these drawn items (a host's list of layers), or none. */
	select(ids: readonly string[]): void;
	/** Apply pen operations as the person's edit (`@decks/pen`'s `Op`s): `onEdits` hears it. */
	edit(ops: unknown[]): void;
	undo(): void;
	redo(): void;
	/** The camera now, and moving it. */
	camera(): Camera;
	setCamera(camera: Camera): void;
	/** A board's file changed where its page comes from (a drop, an agent's edit): its page loads again. */
	reloadBoard(path: string): void;
	/** The canvas opened on the view kept for its scope (`views`), rather than on a fit. */
	readonly restored: boolean;
	dispose(): void;
}

/** A camera that shows everything on the drawing, in a host this big. */
export function fitAll(doc: PenDocument, view: { width: number; height: number }, look: "light" | "dark" = "light"): Camera {
	const placed = placements(doc, { theme: baseTheme(doc, look) });
	const boxes = (doc.children ?? []).map((node) => placed.get(node.id)?.box).filter((box): box is Frame => box !== undefined && box.w > 0 && box.h > 0);
	return fitInto(boxes, view, canvasBox(view));
}

let insetsWatched = false;

/** The empty picture: a board with no picture source is drawn as a blank sheet. */
const BLANK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/%3E";

/**
 * State a host keeps itself and the editor reads and writes (the Decks app's camera, selection and
 * mode are the app's own): each a getter and a setter. What is not given, the editor keeps.
 */
export interface EditorState {
	camera?: [Accessor<Camera>, (camera: Camera) => void];
	/** A glide the host asked for, with the camera it set: the stage animates to it while the token is new. */
	glide?: Accessor<{ token: number; ms: number } | undefined>;
	selected?: [Accessor<string | undefined>, (path: string | undefined) => void];
	mode?: [Accessor<"edit" | "browse">, (mode: "edit" | "browse") => void];
	/** Whether ink is in hand. */
	inking?: Accessor<boolean>;
	/**
	 * The drawing as the host has it (with `document`, the host owns it), and the folder its own
	 * addresses are read against; undefined while there is none to show.
	 */
	pen?: Accessor<{ doc: PenDocument; base: string } | undefined>;
	/** Where the canvas opens: undefined while the host does not know yet. */
	opening?: Accessor<{ camera?: Camera } | undefined>;
}

/** The editor, made in the host's own tree (`createEditor`): its handle, and what it draws. */
export interface Editor {
	handle: CanvasHandle;
	/** The stage alone, for a host that lays out its own work area and tool bars (the Decks app). */
	surface: () => JSX.Element;
	/** The whole editor: the stage in its work area, the drawing's tools and ink (`mountCanvas`). */
	root: () => JSX.Element;
	dispose(): void;
}

/**
 * The Decks canvas editor, made inside a host's own Solid tree: the stage, its camera, the
 * drawing's tools and properties, and ink. `mountCanvas` puts one in an element for any page; a
 * Solid app (the Decks app) makes one where its layout wants the stage, with its own state given
 * in `state`.
 *
 * One canvas to a page: the tools and the host's answers are module state, as they are in the
 * Decks app.
 */
export function createEditor(
	options: CanvasOptions & {
		state?: EditorState;
		/** How big the stage is on screen. Default: the window. */
		size?: () => { width: number; height: number };
		/** The scheme changed (`setDark`): a host paints it where its own styles read it. */
		onScheme?: (scheme: "light" | "dark") => void;
	},
): Editor {
	const size = () => options.size?.() ?? { width: innerWidth, height: innerHeight };
	// No text is an empty drawing: a host that gives its drawing as state (`state.pen`) has none yet.
	const first: PenDocument = options.text.trim() ? parse(options.text) : emptyDocument();
	const base = options.base ?? (typeof location === "undefined" ? "/" : location.href);

	// ---- views, per scope (`options.views`) ----
	const views = options.views ? createAgentViews(options.views.key ?? "canvas", options.views.storage) : undefined;
	const boxesOf = (d: PenDocument, scheme: "light" | "dark") => {
		const placed = placements(d, { theme: baseTheme(d, scheme) });
		return (d.children ?? []).map((node) => placed.get(node.id)?.box).filter((box): box is Frame => box !== undefined && box.w > 0 && box.h > 0);
	};
	/** The view kept for a scope, if it still shows something on this drawing. */
	const kept = (scope: string | undefined, d: PenDocument, scheme: "light" | "dark") => {
		const v = scope && views ? views.of(scope, undefined) : undefined;
		return v && frames(v.camera, size(), boxesOf(d, scheme)) ? v : undefined;
	};
	const firstScope = options.views ? untrack(options.views.scope) : undefined;
	const firstView = kept(firstScope, first, options.dark ? "dark" : "light");

	const opening = firstView?.camera ?? options.camera ?? fitAll(first, size(), options.dark ? "dark" : "light");
	const [camera, setCameraSignal] = options.state?.camera ?? createSignal<Camera>(opening);
	// A host that keeps the camera opens it on the kept view too.
	if (options.state?.camera && firstView) setCameraSignal(firstView.camera);
	/** How many times each board's page has been told to load again (`reloadBoard`). */
	const [reloads, setReloads] = createSignal<Record<string, number>>({});
	const [mode, setModeSignal] = options.state?.mode ?? createSignal<"edit" | "browse">(options.mode ?? "edit");
	const [selected, setSelected] = options.state?.selected ?? createSignal<string | undefined>();
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

	const drawing = createDrawing(first, { look, readOnly: options.readOnly === true, ...(options.onEdits ? { onEdits: options.onEdits } : {}), ...(options.document ? { host: options.document } : {}) });
	/** What the drawing's own addresses are read against; a host that moves between canvases says so with `setDocument`. */
	const [penBase, setPenBase] = createSignal(base);
	/** A glide the host asked for (`glide`): the stage animates to the camera it is given while the token is new. */
	const [ownGlide, setGlideAsk] = createSignal<{ token: number; ms: number }>();
	const glideAsk = () => options.state?.glide?.() ?? ownGlide();
	let glides = 0;
	const { doc, edit, step, moveBoard, resizeBoard, removeBoard } = drawing;

	const setCamera = (next: Camera) => {
		setCameraSignal(next);
		options.onCamera?.(next);
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
				onResize: resizeBoard,
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

	// Each board's frame is handed its own token, by the host's way of asking for one.
	const boardHost = options.boards?.mintBoardToken ? createBoardHost({ mint: options.boards.mintBoardToken }) : undefined;

	// A drawing the host gives as state is the one shown; the editor's own copy follows it, for its board calls.
	if (options.state?.pen) createComputed(() => {
		const given = options.state!.pen!();
		if (given) drawing.set(given.doc);
	});
	const pen = createMemo(() => {
		if (!options.state?.pen) return { doc: doc(), base: penBase() };
		const given = options.state.pen();
		return given ? { doc: doc(), base: given.base } : undefined;
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
		setBoards(reconcile(given, { key: "path" }));
	});
	/* Memos rather than `a() && b()` in the props: the stage reads them in its pointer handlers, outside any owner. */
	const inking = createMemo(() => (options.state?.inking ? options.state.inking() : inkOn()) && mode() === "browse");
	const stageView = () => (
		<Stage
			mode={mode()}
			renderer={options.renderer ?? "dom"}
			picturesWhileMoving={options.picturesWhileMoving !== false}
			boardsMayStart={options.boards?.mayStart ? options.boards.mayStart() : true}
			switching={options.boards?.switching?.() ?? false}
			{...(options.boards?.onStarted ? { onBoardsStarted: options.boards.onStarted } : {})}
			{...(options.boards?.onExtent ? { onExtent: options.boards.onExtent } : {})}
			{...(options.boards?.onCreate && editable ? { onCreateBoard: options.boards.onCreate } : {})}
			{...(options.boards?.onOpenDocument && editable ? { onOpenDocument: options.boards.onOpenDocument } : {})}
			{...(options.boards?.onOpenLink ? { onOpenBoard: options.boards.onOpenLink } : {})}
			news={options.boards?.news?.() ?? {}}
			{...(options.boards?.onRead ? { onRead: options.boards.onRead } : {})}
			{...(options.onViewport ? { onViewport: options.onViewport } : {})}
			{...(options.onRefer ? { onRefer: options.onRefer } : {})}
			{...(options.onEdgeSwipe ? { onEdgeSwipe: options.onEdgeSwipe } : {})}
			glide={glideAsk()}
			boardPill={true}
			{...(options.onProperties ? { onProperties: options.onProperties } : {})}
			opening={options.state?.opening ? options.state.opening() : { camera: opening }}
			{...(options.canvasName ? { stageName: options.canvasName() } : {})}
			onTool={() => {
				setPenTool("select");
				options.onSelectTool?.();
			}}
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
			frame={(slot) => <PlainBoard {...slot} reload={reloads()[slot.board.path]} marks={options.boards?.marks?.(slot.board.path)} page={options.boards?.page?.(slot.board.path)} {...(boardHost ? { boardHost } : {})} {...(options.canvasName ? { stage: options.canvasName } : {})} {...(options.boards?.sandboxed?.(slot.board.path) ? { sandboxed: { key: () => options.boards?.storageKey?.(slot.board.path) ?? slot.board.path } } : {})} />}
			shots={
			options.boards?.shots ??
			(() => ({
			picture: (board, scheme) => options.boards?.picture?.(board.path, scheme) ?? BLANK,
			ownPicture: true,
			}))
			}
			{...commenting}
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
		setDocument: (next, at) => {
			if (at !== undefined) setPenBase(at);
			drawing.set(next);
		},
		// The destination and the journey written together, so the stage never sees one without the other.
		glide: (to, ms = 420) =>
			batch(() => {
				setGlideAsk(ms > 0 ? { token: ++glides, ms } : undefined);
				setCamera(to);
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
		select: (ids) => setPenSelection(ids),
		fit: () => setCamera(fitAll(untrack(doc), size(), look())),
		edit,
		undo: () => step("undo"),
		redo: () => step("redo"),
		camera: () => untrack(camera),
		setCamera,
		restored: firstView !== undefined,
		reloadBoard: (path) => setReloads((all) => ({ ...all, [path]: (all[path] ?? 0) + 1 })),
		dispose() {
			disposeViews?.();
			tools();
			boardHost?.dispose();
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
