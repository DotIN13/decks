import { hasPlaceholder, placeholderPicture } from "./live-placeholder.ts";
import { touchedCanvas } from "./camera/touched.ts";
import { BoardCallout } from "./BoardCallout.tsx";
import type { Board, Camera } from "@decks/protocol";
import { For, Show, createEffect, type Component, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { boxOf, fitInto, INTERACT_ZOOM, ONE_LIVE, pan, pinchCamera, toScreen, toWorld, zoomAbout, type Viewport } from "./camera/camera.ts";
import { canvasBox } from "./camera/insets.ts";
import { createCameraController } from "./camera/controller.ts";
import { canvasHost } from "./host.ts";
import MediaPlayer from "./pen/MediaPlayer.tsx";
import { checkStageOrigin, stagePoint } from "./camera/coords.ts";
import type { StageBoardProps } from "./board-slot.ts";
import type { FrameGestureHost } from "./frame-host.ts";
import { zoomKey } from "./zoom-keys.ts";
import { coastStart, createTouches, type Finger, type TouchStep } from "./touch.ts";
import { velocityFrom, type Sample } from "@decks/ui";
import type { RendererChoice } from "./lib/renderer.ts";
import { createRedrawQueue } from "./redraw-queue.ts";
import { openThumbnails } from "./thumb-budget.ts";
import { createAdmission } from "./board-admission.ts";
import type { DocEdits, DrawingWriter, SceneBoard } from "./stage/types.ts";
import { docIndex } from "./pen/doc-index.ts";
import { BoxIndex } from "./spatial.ts";
import { StageInk } from "./pen/StageInk.tsx";
import { inkVariableEdit, isInk, strokeOf } from "./pen/ink.ts";
import { inkSelection, setInkSelection } from "./state/ink.ts";
import { handTool, PEN_TOOL_KEYS, penLive, penTool, setPenBoxes, setPenLive, setPenTool, type PenTool } from "./state/pen-tools.ts";
import { scheme } from "./lib/theme.ts";
import { mediaOf, isCard, ids as penIds, newId, walk, type PenDocument, type PenNode } from "@decks/pen";
import { firstLine } from "./pen/look.ts";
import { isLiveFile } from "./pen/card-frame.ts";
import { parseMarkdown } from "./pen/markdown.ts";
import { untilReleased } from "./held.ts";
import { StageEngine } from "./stage/engine.ts";
import {
	ANCHOR_OUT,
	ANCHOR_PX,
	arrowAnchors,
	arrowEnds as arrowEndsOf,
	boardHandles as boardHandlesOf,
	createStageEditor,
	deleteOps,
	distances as distancesOf,
	dropBox as dropBoxOf,
	dropSlot as dropSlotIn,
	duplicateOps,
	frameUnder as frameUnderIn,
	gripBox as gripBoxOf,
	gripHidden,
	hoverBox as hoverBoxOf,
	idMaker,
	InsertMenu,
	itemHandles,
	kinOutlines,
	moveOps,
	OverlayLayer,
	radiusHandle as radiusHandleOf,
	selectionFrame,
	selectionOutlines,
	TextEditor,
	tsScene,
	tsSeam,
	type Overlay,
} from "./editor/index.ts";


/**
 * `v`, select: the one palette key left. The tools that add things are the stage's own now, armed
 * by `PEN_TOOL_KEYS` (`state/pen-tools.ts`); the ones that inserted components into a board are gone.
 */
const TOOL_KEYS: Record<string, "select"> = { v: "select" };

/**
 * The stage: one transform over the boards, and the gestures that move it.
 *
 * The boards live in world coordinates and never learn about the camera except to
 * counter-scale their title bars; everything else is a single CSS transform on one
 * wrapper. That is what keeps a pan at 60fps with a dozen live documents on
 * screen — the browser composites one layer instead of re-laying-out twelve.
 *
 * Gestures follow the trackpad, because that is what this is used on: two-finger
 * scroll pans, pinch zooms, and a plain wheel zooms only when a modifier says so.
 * Space or middle-button drag pans from anywhere, including across a board.
 *
 * **And they follow a hand, because a phone has no trackpad either.** A touchscreen
 * sends no wheel events at all, so every one of those gestures was missing: pinching
 * the canvas moved it about instead of zooming it, since two fingers were two
 * independent one-finger pans. Two fingers are now one gesture (`touch.ts` reduces
 * them, `pinchCamera` moves the camera) and one finger pans — the rule being that a
 * finger on the canvas moves the canvas unless it landed on something that says
 * otherwise, which on a board means a title bar or a component already selected.
 */
/** Where the stage's pictures of boards come from (`Stage`'s `shots`). */
export interface StageShots {
	/** The picture of a board with no live page, as an address the sheet can fetch. */
	picture(board: Pick<Board, "path" | "rev">, scheme: "light" | "dark"): string;
	/** Under the Canvas renderer, whether a live page draws its own picture (true) or hands it to the sheet. */
	ownPicture: boolean;
}

/** What a comment is about (`Stage`'s `onComment`). */
export interface StageComment {
	path: string;
	title: string;
	quote: string;
	/** The `data-id` of the block the selected words are in, for a comment on words in a board. */
	component?: string;
	items?: string[];
	anchor: () => DOMRect | undefined;
}

/** What the pill's ink actions ask for (`onInk`): the strokes, their canvas and where they are. */
export type InkRequest = { action: "drawing" | "board" | "send"; ids: string[]; canvas: string; box: { x: number; y: number; w: number; h: number } };

export function Stage(props: {
	/**
	 * Browse or edit. The stage draws the difference so it cannot be entered unnoticed.
	 *
	 * This is the guard that replaces a confirmation dialog: pressing the pencil is one
	 * press and immediately reversible, so what stops an accident is that the canvas *looks*
	 * different for as long as it lasts, not a question you learn to dismiss.
	 */
	mode: "browse" | "edit";
	/** How boards are drawn (`lib/renderer.ts`): documents, a canvas each, or one canvas. */
	renderer: RendererChoice;
	/**
	 * While the camera moves, show every board as its picture: pages are hidden and the sheet paints
	 * their pictures, so a pan or zoom moves pictures only. Back to pages when it rests (Studio's choice).
	 */
	picturesWhileMoving?: boolean;
	/**
	 * Whether the app has opened — the deck and the chat you are looking at are drawn — so the
	 * boards may start. Until it is true no board has a document (`admitted` below).
	 */
	boardsMayStart: boolean;
	/** The person has picked another canvas and its camera has not landed yet: no board starts a page (`App.landOnStage`). */
	switching?: boolean;
	/**
	 * What the canvas should do when this conversation's boards first arrive.
	 *
	 * `undefined` means *not known yet* — see the opening effect below — and an object with no
	 * `camera` means nothing was remembered, so the canvas fits what it has.
	 */
	opening?: { camera?: Camera };
	/** Every board on screen at the open has been let in, so less urgent documents may start. */
	onBoardsStarted?: () => void;
	boards: Board[];
	/**
	 * This chat's stage drawing: its `.pen` document and the folder URL its image fills are read
	 * against (`canvas/pen/layer.ts`). Drawn under the boards, with the same camera. `edits`, when the
	 * host has them: what made this drawing from the one it gave before, applied by the engines in
	 * place of finding what changed (`stage/engine.ts`, `setDoc`).
	 */
	pen?: { doc: PenDocument; base: string; edits?: DocEdits; writer?: DrawingWriter };
	/**
	 * The person's edits to the drawing, as pen operations (`stage.pen.edit` on the wire, `decks.canvas.batch` for an agent). Absent
	 * means the drawing is read-only here. Edits are made in edit mode only, so browsing the canvas
	 * never picks a note up by accident.
	 */
	onPenEdit?: (ops: unknown[]) => void;
	/** Take back the person's last edit to the drawing, or put it back (`stage.pen.step`). */
	onPenStep?: (direction: "undo" | "redo") => void;
	/** The draw tool is on: pen, marker, eraser and lasso draw on the stage (`pen/StageInk.tsx`). */
	drawing?: boolean;
	camera: Camera;
	setCamera: (camera: Camera) => void;
	/**
	 * A camera to *arrive* at rather than jump to, when the app has asked for one.
	 *
	 * A request with a token, so the stage can tell a new one from the one it is already carrying
	 * out, and the duration. See `state/camera.ts` for who asks; this file owns the pixels and the
	 * clock, which is why the arithmetic is a pure function in `camera/camera.ts` and the loop is
	 * here.
	 */
	glide?: { token: number; ms: number };
	selected?: string;
	/** The selected board gets the action pill (`BoardCallout`): boards have no title bars, so this is where their actions are. */
	boardPill?: boolean;
	/** The pill's Properties, for a host with its own properties panel; absent, the canvas's own opens. */
	onProperties?: () => void;
	/**
	 * What draws one board: the stage says where it is and what it may do (`board-slot.ts`), the host
	 * draws it. The Decks app's is `board/BoardFrame.tsx`; `mount.tsx` has a plain one.
	 */
	frame: Component<StageBoardProps>;
	/**
	 * Where a board's picture comes from, for the sheet that draws every board with no live page:
	 * its address (`picture`), whether a live page draws its own picture rather than handing it to the
	 * sheet (`ownPicture`, false for HTML-in-Canvas). The Decks app's are its shot adaptors (`canvas/shots/adaptors.ts`).
	 */
	shots: () => StageShots;
	/**
	 * Comment on a board or on drawn items, from the button in a bar or a pill: `path` is the board
	 * (or the drawing's file, with the item ids in `items`), `anchor` where the button is on screen.
	 * Absent: no comment buttons.
	 */
	onComment?: (comment: StageComment) => void;
	onSelect: (path: string | undefined) => void;
	onMove: (path: string, x: number, y: number) => void;
	/** The board dragged to a new size, in board units. The file is what changes. */
	onResize?: (path: string, size: { w: number; h: number }) => void;
	onHide?: (path: string) => void;
	/** The host's own menu for what a pill is on: a board by its path, or drawn items by their ids. */
	onPillMore?: (on: { path?: string; ids?: string[] }, anchor: DOMRect) => void;
	/**
	 * Ink selected, handed to the agent on screen (`inkAgent`): redraw it as a drawing, make a board of it,
	 * or send it as it is, to be read and acted on. Without both, the pill has no such actions.
	 */
	onInk?: (request: InkRequest) => void;
	inkAgent?: string;
	/** Delete a board: off the canvas and its file gone (the board pill's Delete). */
	onDeleteBoard?: (path: string) => void;
	/** The stage being shown, by folder name: a drawing act is drawn only on its own stage. */
	stageName?: string | undefined;
	/** The boards that are news, by path, each with the colour its glow is drawn in (`board/glow.ts`). */
	news?: Record<string, string>;
	/** A board that was news was read on the canvas. */
	onRead?: (path: string) => void;
	/** So the server can answer `decks.view.camera()` with what the user can see. */
	onViewport?: (viewport: Viewport) => void;
	/** How much room a board's content took, measured in its frame once it had mounted. */
	onExtent?: (path: string, extent: { rev: number; w: number; h: number; at?: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void;
	/** A tool picked by its key, which the palette's tooltips have always claimed. */
	onTool?: (tool: "select") => void;
	/**
	 * A link on a board pointing at another board — `true` once the deck has opened it.
	 *
	 * Handed straight through to the frame that asked (`BoardFrame`). `false` is a path this
	 * deck does not hold, which the app has already said in a notice.
	 */
	onOpenBoard?: (path: string, from: string) => boolean;
	/**
	 * Dropped on the composer: talk about it rather than move it.
	 *
	 * Dragging a note or a board onto the box you are typing in is not a request to park it
	 * there, it is a request to mention it — so the drop is undone as a move and what was
	 * dragged arrives here, for the composer to write in. Whole pills rather than ids: what was
	 * dragged is the only thing that knows what to call it, a board by its title and an item by
	 * its name on the stage.
	 */
	onRefer?: (pills: Array<{ kind: "board" | "item"; id: string; label: string }>) => void;
}) {
	/* The host's board, read once: a component, not a value that changes. */
	const Frame = untrack(() => props.frame);
	let element!: HTMLDivElement;
	let worldEl!: HTMLDivElement;
	/** The camera moved: a press in hand runs its last step again (`editor/dom/pointer.ts`, `follow`). */
	const cameraChanged = () => editor.cameraMoved();
	const [view, setView] = createSignal<Viewport>({ width: 0, height: 0 });
	/**
	 * The camera: where it is, whether it is moving, and the one place that moves it (`camera/controller.ts`).
	 * The stage hands it the window, how to place the world and the drawing at a camera, and its host's
	 * camera to follow.
	 */
	const ctl = createCameraController({
		view,
		place: (cam) => {
			worldEl.style.transform = `translate(${view().width / 2}px, ${view().height / 2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
			// The drawing moves in the same call as the boards, so the two can never be a frame apart.
			penLayer.setCamera(cam);
		},
		moved: () => cameraChanged(),
		publish: (cam) => props.setCamera(cam),
		asked: () => ({ camera: props.camera, glide: props.glide }),
		flush: () => penLayer.flush(),
	});
	const { glidePending } = ctl;
	// The camera's motion, as the controller tracks it (`camera/controller.ts`).
	const { moving, scaling, gliding, panning, setPanning } = ctl;
	/*
	 * Boards as pictures for the length of a camera move (`picturesWhileMoving`). Not for a stroke:
	 * on an iPad the pages coming back at the lift held one frame for 0.7 s, and a board's own
	 * animation, which pictures would have stilled, is already held still there (`plain-board.tsx`).
	 */
	// `decks.noPictures` = "1" in localStorage keeps the pages up through a move, for measuring (`pan-heavy`); read last, so this keeps hearing the move.
	const picturesNow = createMemo(() => props.picturesWhileMoving === true && (moving() || panning() || scaling() || gliding()) && !(typeof localStorage !== "undefined" && localStorage.getItem("decks.noPictures") === "1"));
	/**
	 * The board whose page stays up while the camera moves: the selected one, of any kind. Someone
	 * working in a board pans and zooms to follow their work, and a picture there is not the page they
	 * were in: its scroll, its open tab and its typing are not in it, and a document or an app has no
	 * picture at all (`live-placeholder.ts`).
	 */
	const keptLive = createMemo(() => props.selected);
	/** Whether a board whose page is live is drawn as its page now, rather than as its picture. */
	const pageNow = (path: string) => !picturesNow() || keptLive() === path;
	const [spaceHeld, setSpaceHeld] = createSignal(false);
	/** A press pans: Space is held, or the host's hand tool is on (`state/pen-tools.ts`). */
	const grabbing = () => spaceHeld() || handTool();

	/*
	 * Fit into the canvas column rather than into the whole stage.
	 *
	 * Every `fit` on this page goes through here, which is the point: the stage element is
	 * the full window, and half of what it framed used to end up behind a panel. What the
	 * boards should be framed into is the window minus the chrome standing beside it, and
	 * `camera/insets.ts` is the only thing that knows how much that is.
	 */
	const frame = (boxes: Array<{ x: number; y: number; w: number; h: number }>) =>
		fitInto(boxes, view(), canvasBox(view()));

	/** A press is held on the canvas (not on a pill): the drawn items' pill steps aside until it lets go. */
	const [pressHeld, setPressHeld] = createSignal(false);
	onMount(() => {
		const press = (event: PointerEvent) => {
			if (!(event.target as Element | null)?.closest?.(".board-callout")) setPressHeld(true);
		};
		const release = () => setPressHeld(false);
		element.addEventListener("pointerdown", press, { capture: true, passive: true });
		window.addEventListener("pointerup", release, true);
		window.addEventListener("pointercancel", release, true);
		onCleanup(() => {
			element.removeEventListener("pointerdown", press, { capture: true });
			window.removeEventListener("pointerup", release, true);
			window.removeEventListener("pointercancel", release, true);
		});
	});
	onMount(() => {
		// A hand on the canvas holds the view against an agent's show (`camera/touched.ts`).
		for (const kind of ["pointerdown", "wheel", "keydown"] as const) element.addEventListener(kind, touchedCanvas, { capture: true, passive: true });
		onCleanup(() => {
			for (const kind of ["pointerdown", "wheel", "keydown"] as const) element.removeEventListener(kind, touchedCanvas, { capture: true });
		});
		/*
		 * A pinch over anything that is not the canvas (the toolbars, the composer, the conversation,
		 * the panels, a dialog) does nothing. Chrome sends a trackpad pinch as a wheel event with
		 * `ctrlKey`, and one nobody cancels zooms the whole page. The canvas zooms only for a pinch
		 * over the stage itself (`onWheel`).
		 */
		const pinchOver = (event: WheelEvent) => {
			if (event.ctrlKey && !element.contains(event.target as Node | null)) event.preventDefault();
		};
		window.addEventListener("wheel", pinchOver, { capture: true, passive: false });
		onCleanup(() => window.removeEventListener("wheel", pinchOver, { capture: true }));
		const measure = () => {
			const viewport = { width: element.clientWidth, height: element.clientHeight };
			setView(viewport);
			props.onViewport?.(viewport);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		// Everything on the canvas assumes a stage pixel is a client pixel; say so if it is not.
		checkStageOrigin(element);
		onCleanup(() => observer.disconnect());

		const keydown = (event: KeyboardEvent) => {
			/*
			 * ⌘+ / ⌘− / ⌘0, before every other guard in this function.
			 *
			 * Above the typing check as well as the modifier one, because these mean the same
			 * thing wherever the caret is: they do nothing useful in a text field, and the
			 * caret is in the composer most of the time — a zoom that stopped working as soon
			 * as you clicked the input would be the bug in a smaller costume.
			 *
			 * These are the one place a person's habit and the browser's collide. On a canvas
			 * ⌘+ means "zoom in"; Chrome hears "make the page bigger", which enlarges the whole
			 * app — chat column, chrome and all — and leaves the camera exactly where it was.
			 * So they are taken here and the browser's page zoom is declined.
			 *
			 * `zoom-keys.ts` decides which keystroke this is, because the answer is not the
			 * obvious one: the key labelled `+` is `=` unshifted, so matching `"+"` misses
			 * every press that is not on the numpad.
			 */
			const zoom = zoomKey(event);
			if (zoom) {
				if (zoom === "fit") pushCamera(frame(props.boards.map(boxOf)));
				else pushCamera(zoomAbout(ctl.now(), view(), centre(), zoom === "in" ? 1.2 : 1 / 1.2));
				event.preventDefault();
				return;
			}
			const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
			if (typing) return;
			/*
			 * The drawing's own keys, in either mode but not while drawing. None of them fire while a text box has the caret
			 * (above). Delete, the arrows and ⌘D act on what is selected; ⌘Z and ⇧⌘Z step through the
			 * person's own edits; Escape lets go, then puts the tool down; a letter arms a tool
			 * (`PEN_TOOL_KEYS`), from this document only.
			 */
			if (editor.key(event)) {
				event.preventDefault();
				return;
			}
			/*
			 * A key with a modifier on it is not one of ours.
			 *
			 * Every shortcut here is a bare key — `V S C T E` for the tools, `0 1 + -` for
			 * the camera — and none of them wanted a modifier. Without this check the letters
			 * matched anyway, so **⌘C stopped copying**: `event.key` is `"c"` whatever else is
			 * held, so a copy switched the tool to *card* and then `preventDefault()` cancelled
			 * the clipboard. Selecting a line of a reply and copying it did nothing at all, and
			 * ⌘V, ⌘S, ⌘E and ⌘0 were quietly taken the same way.
			 *
			 * `frame-gestures.ts` has had this guard from the start, for the keys it forwards
			 * out of a board — the asymmetry is what hid the bug: anything typed with a board
			 * focused behaved, and only the app's own document swallowed the shortcut. Space
			 * is inside the guard too, because ⌘Space belongs to the OS.
			 */
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.code === "Space") {
				setSpaceHeld(true);
				event.preventDefault();
				return;
			}
			if (shortcut(event.key)) event.preventDefault();
		};
		const keyup = (event: KeyboardEvent) => {
			if (event.code === "Space") setSpaceHeld(false);
		};
		addEventListener("keydown", keydown);
		addEventListener("keyup", keyup);
		onCleanup(() => {
			removeEventListener("keydown", keydown);
			removeEventListener("keyup", keyup);
		});
	});

	/**
	 * How many boards may be put on layers of their own before it stops being a saving.
	 *
	 * A layer is a picture the compositor keeps and can stretch without waking the main
	 * thread, and that trade is a good one until there are so many that compositing them
	 * costs more than drawing them. It reverses, and it was measured rather than guessed —
	 * 1400×900 at 4× CPU throttle, milliseconds of work per finger movement while pinching:
	 *
	 *     12 documents in view   56 on layers · 134 without
	 *     40 documents in view  126 on layers · 181 without
	 *    120 documents in view  700 on layers · 523 without   ← the trade has reversed
	 *
	 * 48 is inside the measured win and well short of the measured loss. Past it the canvas
	 * is slow either way — a hundred live documents at once is its own problem — so the
	 * budget is there to stop this making that case worse, not to rescue it.
	 */
	const LAYER_BUDGET = 48;
	/** How many recently shown boards keep their node, with no page in it (`shownBoards`). */
	const SHOWN_NODES = 32;

	const centre = () => ({ x: view().width / 2, y: view().height / 2 });

	/*
	 * The stage's engine (`stage/engine.ts`): the drawing and the boards' pictures, drawn with WebGPU
	 * on two canvases, one under the board pages and one over them, in the same call that moves the
	 * pages (`writeTransform`). The document, the window's size and the colour scheme reach it here.
	 */
	const penLayer = new StageEngine();
	/* An engine that cannot start says so over the stage (`stage/backends/notice.ts`): no WebGPU and no WebGL 2, most often. */
	const [engineNotice, setEngineNotice] = createSignal<string>();
	penLayer.failed = (notice) => setEngineNotice(notice);
	onCleanup(() => penLayer.dispose());
	/** What the editor asks of the scene (`editor/core/scene.ts`), answered from the engine. */
	const sceneBoards = createMemo(() =>
		props.boards.map((board) => ({ path: board.path, x: board.x, y: board.y, w: board.w, h: board.h })),
	);
	const scene = tsScene(penLayer, () => props.pen?.doc, sceneBoards);
	createEffect(() => penLayer.setView(view()));
	createEffect(() => penLayer.setScheme(scheme()));
	/*
	 * The over canvas is inside the world only to sit after the board pages and before the
	 * selection's outlines and handles. The engine places it, in stage units, at the rectangle it last
	 * drew (the window and a margin round it), so a pan moves it with the world until it is drawn again.
	 */
	createEffect(() => {
		penLayer.setDoc(props.pen?.doc, props.pen?.base ?? "", props.pen?.edits);
		// The drawing has the change in it now, so the panel is no longer showing one (`penLive`).
		if (untrack(penLive)) setPenLive(undefined);
	});

	/**
	 * No board has a title bar: a board is picked by pressing it, and the selected one gets the
	 * action pill (`BoardCallout`) on every device. When a board has a page is `INTERACT_ZOOM`, per
	 * device, high enough on a phone that only a board or two are ever live: thirteen live pages on
	 * a 2 to 10% zoom were what every recorded crash had in common.
	 */
	/** The board the action pill is for: the selected one, while it is on the canvas. */
	/** More than one thing picked together, boards among them or not: the pill goes over the whole group (`calloutItems`). */
	const groupPicked = () => editor.boardPicks().length + editor.items().length > 1;
	const calloutBoard = createMemo(() => (props.selected && !groupPicked() ? props.boards.find((board) => board.path === props.selected) : undefined));
	/**
	 * Boards whose documents are showing, by how many of their frames say so: the sheet is a hole
	 * over each of them, and the board's picture everywhere else. A count and not a set, so a frame
	 * that goes as another comes for the same board never leaves it wrongly unmarked.
	 */
	const [liveBoards, setLiveBoards] = createSignal<ReadonlyMap<string, number>>(new Map());
	/** When each board's page last came up (`shownBoards`). */
	const [shownAt, setShownAt] = createSignal<ReadonlyMap<string, number>>(new Map());
	/**
	 * The boards whose pages were shown most recently, up to `SHOWN_NODES`: they keep their node when the
	 * camera leaves them or zooms out, with no page in it (`mounted` is off). Their pictures are what the
	 * sheet draws there, and without the node a board that had been live did not come back as its picture
	 * after a zoom out (`e2e/checks/drop-lands.mjs`).
	 */
	const shownBoards = createMemo<ReadonlySet<string>>((was) => {
		const onCanvas = new Set(props.boards.map((board) => board.path));
		const next = [...shownAt()]
			.filter(([path]) => onCanvas.has(path))
			.sort((a, b) => b[1] - a[1])
			.slice(0, SHOWN_NODES)
			.map(([path]) => path);
		return was && was.size === next.length && next.every((path) => was.has(path)) ? was : new Set(next);
	});
	const markLive = (path: string, on: boolean) => {
		markLiveCount(path, on);
		if (on) setShownAt((was) => new Map(was).set(path, performance.now()));
	};
	const markLiveCount = (path: string, on: boolean) =>
		setLiveBoards((was) => {
			const next = new Map(was);
			const count = (next.get(path) ?? 0) + (on ? 1 : -1);
			if (count > 0) next.set(path, count);
			else next.delete(path);
			return next;
		});

	/*
	 * Editing the drawing by hand, in edit mode (`state/pen-tools.ts` holds the tool and reads the
	 * editor's selection, `pen/PenBar.tsx` shows them). Every change is sent as the same pen operation an
	 * agent would send, and the drawing redraws from the server's answer; until it arrives, a drag
	 * or a resize is drawn as a preview.
	 *
	 * The editor (`editor/dom/controller.ts`) holds the selection, what the pointer is over, the
	 * gesture in hand and what is drawn for it, stepped by `editor/core/gesture.ts`. The handlers
	 * here follow the pointer and tell it each step.
	 */
	/** Counted up each time the engine lays the drawing out (`penLayer.drawn`): what reads where items are reads it. */
	const [penDrawn, setPenDrawn] = createSignal(0);
	const editor = createStageEditor({
		scene,
		engine: tsSeam(penLayer),
		mode: () => props.mode,
		tool: penTool,
		zoom: () => ctl.now().zoom,
		view: () => {
			const v = view();
			const a = toWorld(ctl.now(), v, { x: 0, y: 0 });
			const b = toWorld(ctl.now(), v, { x: v.width, y: v.height });
			return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
		},
		nextIds: () => freshIds(),
		boards: () => props.boards,
		onPenEdit: (ops) => penEdit(ops),
		effects: {
			element: () => element,
			toScreen: (point) => toScreen(ctl.now(), view(), point),
			box: (id) => penLayer.bounds.get(id) ?? penLayer.placed.get(id)?.box,
			cutFromCarried: (rect) => penLayer.cutFromCarried(rect),
			showCarriedLayer: (on) => penLayer.showCarriedLayer(on),
			pen: () => props.pen,
			get onRefer() {
				return props.onRefer;
			},
			get onOpenBoard() {
				return props.onOpenBoard;
			},
			onSelect: (path) => props.onSelect(path),
			onMove: (path, x, y) => props.onMove(path, x, y),
			onResize: (path, size) => props.onResize?.(path, size),
			toggleMedia: (id, media) => toggleMedia(id, media),
		},
		// The pointer's half (`editor/dom/pointer.ts`): the stage keeps the camera, its finger pool and its pan.
		pointer: {
			element: () => element,
			worldAt: (event) => worldAt(event),
			editable: () => !!props.onPenEdit,
			drawing: () => !!props.drawing,
			mode: () => props.mode,
			tool: penTool,
			spaceHeld: () => grabbing(),
			boardsNear: (at) =>
				boardIndex()
					.search({ x: at.x, y: at.y, w: 0, h: 0 })
					.sort((a, b) => a - b)
					.map((index) => props.boards[index]!),
			rendered: () => renderedPaths(),
			linkAt: (at) => penLayer.linkAt(at),
			onSelect: (path) => props.onSelect(path),
			fingers: () => touches.count(),
			claim: (pointer) => claimed.add(pointer),
			beginTouch: (event) => beginTouch(event),
			pan: (event, how) => panFrom(event, how),
			toggleMedia: (id, media) => toggleMedia(id, media),
			open: { liveFile: (id) => openLiveFile(id) },
			handles: { item: () => penHandles(), board: () => boardHandles(), radius: () => radiusHandle(), arrow: () => arrowEnds() },
		},
		// The drawing's keys (`editor/dom/keys.ts`).
		keys: {
			editable: () => !!props.onPenEdit,
			drawing: () => !!props.drawing,
			tool: penTool,
			boardSelected: () => !!props.selected,
			selectedBoard: () => props.selected,
			canStep: () => !!props.onPenStep,
			step: (direction) => props.onPenStep?.(direction),
			deleteSelected: (selected, ops) => penDeleteSelected(selected, ops),
			setTool: (tool) => setPenTool(tool),
			arm: (tool) => armPenTool(tool),
			onMove: (path, x, y) => props.onMove(path, x, y),
		},
		// The words typed over an item (`editor/dom/TextEditing.tsx`).
		text: {
			pen: () => props.pen,
			scheme: () => scheme(),
			world: () => worldEl,
			redrawn: () => penDrawn(),
			editable: () => !!props.onPenEdit,
			freshId: () => freshId(),
		},
		// What a tool and a double-click on bare canvas add (`editor/dom/InsertMenu.tsx`).
		insert: {
			worldAt: (event) => worldAt(event),
			freshId: () => freshId(),
			idsBut: (id) => freshIds(id),
		},
	});
	/** The file items whose holes the sheet is showing, as of the frame on screen (`liveFiles`): their elements show then and not before. */
	const [holesShown, setHolesShown] = createSignal<ReadonlySet<string>>(new Set());
	let holesAsked: { ids: ReadonlySet<string>; mark: number } | undefined;
	/**
	 * The one film or sound playing, if any.
	 *
	 * **One at a time, on purpose.** A film at rest is paint and costs a picture; a film playing is
	 * a decoder, and eight of those are already the edge of a frame's budget on a machine with no
	 * graphics card — forty-eight cost a thousand times what forty-eight stills cost. So starting
	 * one stops the last, and the canvas never holds more than a single player.
	 */
	const [playing, setPlaying] = createSignal<{ id: string; kind: "video" | "audio"; file: string } | undefined>();
	/** The playing element, for a click on the item to pause and resume. */
	let playingElement: HTMLMediaElement | undefined;
	/** When the one playing was started, so the second press of a double-click does not pause it at once. */
	let playingSince = 0;
	/** Where each film or sound was left, so pressing it again goes on from there. */
	const playedTo = new Map<string, number>();
	/**
	 * A press on a film or a sound: it plays, or the one playing pauses or goes on. The press
	 * selects it as well, as a press on any item does, so it can still be moved and styled.
	 */
	const toggleMedia = (id: string, media: { kind: "video" | "audio"; file: string }) => {
		const now = playing();
		if (now?.id === id && playingElement) {
			if (playingElement.paused) void playingElement.play().catch(() => {});
			else if (performance.now() - playingSince > 400) playingElement.pause();
			return;
		}
		playingSince = performance.now();
		setPlaying({ id, kind: media.kind, file: media.file });
	};
	/*
	 * Boards picked up with the drawing (`editor.boardPicks`): by a marquee, or Shift and a press on a
	 * title bar. They move with the selected items as one selection. The app's own selected board is
	 * a different thing — the one board whose page takes the keys — and a single press on a board is
	 * still only that.
	 */

	/**
	 * Each board as the sheet draws it: where it is, and whether it is a hole or a picture.
	 *
	 * A dragged board is where it was picked up, here: the sheet draws its picture once on the carried
	 * layer and the page slides that with the pointer (`carry` below), so a move redraws nothing.
	 */
	createEffect(() => {
		const live = liveBoards();
		const look = scheme();
		picturesNow();
		// A board drawn into a canvas of its own keeps its own picture: the sheet leaves it alone.
		const own = props.renderer === "canvas-per-board";
		/*
		 * A live board being sized is its page, drawn over the sheet at the new box, so the sheet
		 * keeps it where it was until the file has the size: each step otherwise painted the whole
		 * sheet again, about 10 ms of the worker's time, to move a hole nobody can see. A board
		 * shown as a picture is drawn by the sheet, and one an arrow ends on is followed by the
		 * arrow, so those two are still sent at every step.
		 */
		const resize = editor.sheetResize((path) => live.has(path));
		const sendBoards = (boards: SceneBoard[]) => {
			/*
			 * The engine draws the boards' pictures, and hears of every board: an arrow follows the board it
			 * ends on, and a drawn item over a board gets the click shape that lets it be pressed there.
			 */
			penLayer.setBoards(boards);
		};
		sendBoards(
			props.boards
				.map((board) => {
					const sized = resize?.path === board.path ? resize : undefined;
					return {
						path: board.path,
						x: sized?.x ?? board.x,
						y: sized?.y ?? board.y,
						w: sized?.w ?? board.w,
						h: sized?.h ?? board.h,
						// Under the Canvas renderer a board draws its own picture, unless pictures are taken by
						// HTML-in-Canvas, which hands them to the sheet like the other adaptors (`shots/adaptors.ts`).
						live: (own && props.shots().ownPicture) || (live.has(board.path) && pageNow(board.path)),
						// A live board's picture is kept ready, for a zoom on WebKit or a drag to show at once.
						...(live.has(board.path) ? { ready: true } : {}),
						// A document or an app has no picture worth drawing: a card with its icon and name instead.
						picture: hasPlaceholder(board) ? placeholderPicture(board, look) : props.shots().picture(board, look),
						...(props.news?.[board.path] ? { news: resolveColour(props.news[board.path]!), glow: !paged(board) } : {}),
					};
				}),
		);
	});
	createEffect(() => penLayer.setMoving(panning() || scaling() || moving() || gliding()));
	// The boards a drag carries go with it on the engine's carried layer (`editor/dom/controller.ts`).
	/** The boards whose carried picture is on screen: their pages hide where they were picked up (`BoardFrame`). */
	const [carriedPages, setCarriedPages] = createSignal<ReadonlySet<string>>(new Set());
	penLayer.carrying = setCarriedPages;
	/*
	 * A board a drag carries while the sheet draws it as its picture (its page not live, or pictures
	 * while the canvas moves): its picture goes with the drag, so its page waits unseen too, or it stayed
	 * on screen where the drag began (a finger on a phone's board, `plain-board.tsx`, `fingerDrag`).
	 */
	const draggedAsPicture = createMemo<ReadonlySet<string>>(() => {
		const paths = [...(editor.boardDrag()?.paths ?? []), ...(editor.ownDrag() ? [editor.ownDrag()!.path] : [])];
		const live = liveBoards();
		return new Set(paths.filter((path) => !(live.has(path) && pageNow(path))));
	});
	const resolvedColours = new Map<string, string>();
	/**
	 * A writer's colour as the sheet can paint it. A board with no writer's colour glows in
	 * `var(--color-accent)`, which a canvas does not understand: the 2D one drew it in its default
	 * black and Skia in nothing. So a `var()` is looked up here, on the page, in the current scheme.
	 */
	const resolveColour = (colour: string) => {
		const name = /^var\((--[\w-]+)/.exec(colour.trim())?.[1];
		if (!name) return colour;
		/* Kept per scheme: reading a computed style makes the page recalculate its styles first, and
		   the sheet's boards are re-sent on every move of a board drag, where that cost 8 ms a move. */
		const key = `${scheme()}|${name}`;
		const known = resolvedColours.get(key);
		if (known) return known;
		const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#3b5cf6";
		resolvedColours.set(key, value);
		return value;
	};
	/*
	 * The drawing's placeholder frames are drawn unfinished in its last writer's colour, with its name;
	 * with no writer known, in the accent and with no name.
	 */
	createEffect(() => {
		const writer = props.pen?.writer;
		const color = resolveColour(writer?.color ?? "var(--color-accent)");
		penLayer.setWriter(writer?.name ? { name: writer.name, color } : { color });
	});
	penLayer.drawn = () => {
		editor.textEditing.drawn();
		/*
		 * The answer to a drag has been drawn: the layout is where the drag left things, so the offset
		 * goes (`editor/core/gesture.ts`, `drawn`). Not when the answer *arrives* — the layout is only
		 * redone on the next frame, and for that frame the outline sat on the old layout with no
		 * offset, back where the drag began. A selection of items the drawing no longer has is let
		 * go then too, so the outline goes in the frame the item does.
		 */
		editor.drawn(penLayer.drawnDoc, props.pen?.doc);
		setPenDrawn((n) => n + 1);
	};
	/** Select what was just asked for, which the drawing does not have until the server answers. */
	const selectMade = (made: string[]) => editor.selectMade(made);
	/*
	 * The drawing is edited in both modes — browse keeps the boards' pages as they are, edit opens
	 * them for editing too — but not while the pen is out: ink has its own selection (the lasso).
	 */
	createEffect(() => {
		if (props.drawing) {
			editor.select([]);
			editor.pickBoards([]);
			editor.setText(undefined);
			setPenTool("select");
		}
	});
	/*
	 * The drag as far as the canvas shows it: nothing yet while the carried picture of what was picked
	 * up is on its way (`layer.ts`, `onCarryPending`), so outlines and handles stay on the items, which
	 * the sheet still draws where they were, and both go with the pointer from the same frame.
	 */
	penLayer.onCarryPending = editor.carryPending;
	// A drop's glide: the outlines, handles and size round what glides ride with it, frame by frame.
	penLayer.onGlide = editor.setGlide;
	const shownDrag = editor.shownDrag;
	/** Where each selected item is now, moved by any drag and sized by any resize in progress (`editor/core/overlay.ts`). */
	const penOutlines = createMemo(() => {
		penDrawn();
		return selectionOutlines(
			{
				selection: editor.items(),
				typing: editor.typing(),
				drag: shownDrag(),
				glide: editor.glide(),
				resize: editor.shownResize(),
				boards: scene.boards(),
				boardPicks: editor.boardPicks(),
				boardDrag: editor.boardDrag(),
				ownDrag: editor.ownDrag(),
				selected: props.selected,
				boardResize: editor.boardResize(),
				marquee: editor.marquee(),
			},
			scene,
		);
	});
	/** One item selected, and not a joined arrow (which the server redraws) or a group: it gets handles. */
	const penHandles = createMemo(() => itemHandles(penOutlines(), scene, ctl.zoom()));
	/**
	 * A card is as tall as the markdown in it (`@decks/pen`, `textSize`), the way it is when one is
	 * made. So it is sized by its width alone: the two side handles, and no height written to the
	 * file. Dragging a corner used to pin a height on it, and from then on its words were cut off or
	 * swam in space.
	 */
	const penAnchors = createMemo(() => arrowAnchors(penHandles(), { editable: !!props.onPenEdit, drafting: !!editor.draft(), resizing: !!editor.resize() }, scene));
	/*
	 * Where each selected item is, for the properties panel's position and size: the box the stage
	 * draws, kept current as the drawing changes (`state/pen-tools.ts`).
	 */
	createEffect(() => {
		penDrawn();
		const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
		for (const id of editor.items()) {
			const box = penLayer.placed.get(id)?.box;
			if (box) boxes.set(id, { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
		}
		setPenBoxes(boxes);
	});
	/** The selected board's box, when it alone is selected and can be resized: the same eight handles as an item. */
	const boardHandles = createMemo(() => boardHandlesOf(penOutlines(), { resizable: !!props.onResize, carrying: !!editor.boardDrag() || !!editor.ownDrag(), boards: scene.boards(), zoom: ctl.zoom() }));

	/*
	 * A colour being dragged in the properties panel, drawn on the sheet before it is saved
	 * (`state/pen-tools.ts`, `penLive`). The same preview a drag of an item uses, so the sheet draws
	 * the item once per frame with the new colour in it, and the file takes one edit when the hand
	 * lifts. The worker lets it go when the saved drawing arrives.
	 */
	createEffect(() => {
		const live = penLive();
		penLayer.preview(live?.length ? new Map(live.map((change) => [change.id, { dx: 0, dy: 0, set: change.set }])) : undefined);
	});
	/**
	 * The corner radius and the angle being dragged, for the handles and the outline the canvas draws
	 * round the item. What the *sheet* draws is told separately, as a preview the worker applies to
	 * its own copy (`penLayer.preview`): a turn used to send the whole drawing to the worker on every
	 * frame, which is a relayout of the whole stage sixty times a second, and that was the flicker.
	 *
	 * Neither is cleared when the gesture ends. The worker lets a preview go when the server's answer
	 * arrives — "whatever a drag was previewing is now the drawing itself" — and clearing it first is
	 * what shows the item at its old angle for a frame.
	 */
	/*
	 * The radius (`editor.radius`) is let go of when the drawing comes back with the change in it, not
	 * when the hand lifts (`editor/core/gesture.ts`, `drawn`). The sheet's own preview works that way
	 * already; the outline and the handles are drawn from it, and dropping it first shows the item
	 * upright for the frame or two the save takes. A time limit is for an edit that is refused, which
	 * would otherwise leave the handles turned for an item that is not.
	 */

	{
		const before = penLayer.presented;
		penLayer.presented = () => {
			before?.();
			// The typing's still copy goes once the words are on screen (`editor/dom/TextEditing.tsx`).
			editor.textEditing.presented();
			if (holesAsked && penLayer.shows(holesAsked.mark)) {
				setHolesShown(holesAsked.ids);
				holesAsked = undefined;
			}
			/*
			 * The resize as the sheet has drawn it, which the outline follows: each step is drawn again by
			 * the worker, a frame after the pointer, and an outline on the pointer's size ran a frame ahead
			 * of the shape at every step. Each step waits in the editor for the frame painted with it.
			 */
			editor.presented();
			// The dashed outline of what a tool drew goes once the item is drawn (`editor/dom/InsertMenu.tsx`).
			editor.insert.presented();
		};
	}
	/** A file shown live (`liveFiles`): which item, what it is, and its deck path. */
	type LiveFile = { id: string; file: string; name: string };
	/** The most file items alive at once, the nearest the middle of the screen: a frame each is a page's worth of work. */
	const LIVE_FILES = 12;
	/**
	 * A press on a drawn item's click shape (`pen/layer.ts`). Only items over a board have one, to take
	 * the press from the board's page; on bare canvas the press is the stage's and `pickAt` finds the item.
	 */
	const onDrawn = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".pen-hits");

	/**
	 * What the pill should not sit on (`BoardCallout`): every board and drawn item but those touching the
	 * box it is for, which are the selection itself, what is in it and what holds it.
	 */
	const pillObstacles = (box: { x: number; y: number; w: number; h: number }) => {
		const touches = (o: { x: number; y: number; w: number; h: number }) => o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y;
		const out: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (const board of props.boards) {
			const b = boxOf(board);
			if (!touches(b)) out.push(b);
		}
		for (const [id, placed] of penLayer.placed) {
			const b = penLayer.bounds.get(id) ?? placed.box;
			if (b.w > 0 && b.h > 0 && !touches(b)) out.push(b);
		}
		return out;
	};
	/** For the browser checks: where a drawn item is on screen, since most have no click shape to measure. */
	(globalThis as { __decksPenBox?: (id: string) => DOMRect | undefined }).__decksPenBox = (id) => {
		const placed = penLayer.placed.get(id);
		if (!placed || !element) return undefined;
		const box = penLayer.bounds.get(id) ?? placed.box;
		const a = toScreen(ctl.now(), view(), { x: box.x, y: box.y });
		const b = toScreen(ctl.now(), view(), { x: box.x + box.w, y: box.y + box.h });
		const r = element.getBoundingClientRect();
		return new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y);
	};
	/** For the browser checks: the frame a drop at a point on the screen would go into, and its box. */
	(globalThis as { __decksFrameUnder?: (clientX: number, clientY: number) => { frame: string | null; world: { x: number; y: number } } }).__decksFrameUnder = (clientX, clientY) => {
		const world = worldAt({ clientX, clientY });
		return { frame: frameUnder(world, []), world };
	};
	/** For the browser checks: every board on the canvas and where it is on screen, node or picture (`rendered`). */
	(globalThis as { __decksBoards?: () => Array<{ path: string; node: boolean; rect: DOMRect }> }).__decksBoards = () => {
		if (!element) return [];
		const r = element.getBoundingClientRect();
		const nodes = renderedPaths();
		return props.boards
			.map((board) => {
				const a = toScreen(ctl.now(), view(), { x: board.x, y: board.y });
				const b = toScreen(ctl.now(), view(), { x: board.x + board.w, y: board.y + board.h });
				return { path: board.path, node: nodes.has(board.path), rect: new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y) };
			});
	};
	/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
	const onCanvas = (target: EventTarget | null) => target === element || onDrawn(target);
	/** The ink on the stage, each stroke in stage pixels, for the eraser and the lasso. */
	const inkStrokes = createMemo(() => {
		penDrawn();
		return [...penLayer.placed.values()].flatMap((placed) => {
			const stroke = placed.node.id.includes("/") ? undefined : strokeOf(placed);
			return stroke ? [stroke] : [];
		});
	});
	const penEdit = (ops: unknown[]) => {
		if (ops.length) props.onPenEdit?.(ops);
	};
	const worldAt = (event: { clientX: number; clientY: number }) => toWorld(ctl.now(), view(), stagePoint(event as PointerEvent));
	const freshId = () => newId(props.pen ? penIds(props.pen.doc) : new Set());
	/** Ids for several new items at once, none the same as another, as any on the stage, or as `also`. */
	const freshIds = (...also: string[]) => idMaker([...(props.pen ? penIds(props.pen.doc) : []), ...also]);

	(globalThis as { __decksPictureAt?: (x: number, y: number) => string | undefined }).__decksPictureAt = (x, y) => (element ? editor.pictureUnder({ clientX: x, clientY: y }) : undefined);
	/*
	 * The card under a screen point and the slot between its blocks there, for files dropped from the
	 * desktop (`app/files.ts`): they go into the card where they land, as a picture or a file dragged
	 * from the canvas does.
	 */
	(globalThis as { __decksCardAt?: (x: number, y: number) => { card: string; index: number; inner: number } | undefined }).__decksCardAt = (x, y) => {
		if (!element) return undefined;
		const at = toWorld(ctl.now(), view(), stagePoint({ clientX: x, clientY: y } as MouseEvent));
		const id = frameUnder(at, []);
		const card = id ? penNode(id) : undefined;
		if (!id || !card || !isCard(card)) return undefined;
		return { card: id, index: dropSlot(id, at, [])?.index ?? (card.children ?? []).length, inner: editor.textEditing.cardInner(card) };
	};

	/** The words an item shows, its own or its children's, on one line: what a comment on it quotes. */
	const quoteOf = (node: PenNode | undefined): string => {
		if (!node) return "";
		const said: string[] = [];
		for (const one of walk([node])) if (typeof one.content === "string" && one.content.trim()) said.push(one.content.trim());
		return said.join(" ").replace(/\s+/g, " ").slice(0, 120);
	};
	/** Take the selected drawn items off the canvas: the Delete key, and the pill's Delete. */
	const penDeleteSelected = (selected = editor.items(), ops = deleteOps(selected, scene)) => {
		if (!selected.length) return;
		// Gone from the sheet at once, and its outline with it in the same frame, not one frame before it.
		penLayer.hide(new Set(selected));
		const mark = penLayer.mark();
		penEdit(ops);
		const clear = () => editor.select((now) => (now === selected ? [] : now));
		editor.afterFrame(mark, clear);
		// A sheet that shows no frame (nothing painting) does not keep the outline.
		setTimeout(clear, 250);
	};

	const armPenTool = (tool: PenTool) => {
		// The board palette's tool goes down first: picking one of its tools puts this one down.
		if (tool !== "select") props.onTool?.("select");
		setPenTool(tool);
	};

	/** An item as the file has it, not as a preview has drawn it. */
	const penNode = (id: string) => (props.pen ? docIndex(props.pen.doc).get(id)?.node : undefined);

	/** Move items by `dx dy`, into a frame or out of one when `into` says (`editor/core/ops.ts`). */
	const penMoveBy = (idsToMove: readonly string[], dx: number, dy: number, into?: string | null, slot?: number) => penEdit(moveOps(scene, idsToMove, dx, dy, into, slot));

	const penDuplicate = () => {
		const { ops, made } = duplicateOps(scene, editor.items(), freshIds());
		penEdit(ops);
		if (made.length) selectMade(made);
	};

	/**
	 * The frame a drop at a point would go into, or `null` for the stage itself (`editor/core/drop.ts`):
	 * what a live drag is aiming at is the editor's (`editor.dropInto`); this answers the page's checks.
	 */
	const frameUnder = (point: { x: number; y: number }, carrying: readonly string[]): string | null => frameUnderIn(scene, point, carrying);
	/** Where in a frame that arranges its children a drop would land (`editor/core/drop.ts`, `dropSlot`). */
	const dropSlot = (frameId: string, point: { x: number; y: number }, carrying: readonly string[]) => dropSlotIn(scene, frameId, point, carrying);
	/** Where the frame a drag would drop into is, for the outline that says so. */
	const dropBox = createMemo(() => dropBoxOf(editor.dropInto(), scene));

	/** A link is under the pointer: the cursor says so. */
	const overLink = editor.overLink;

	/**
	 * Where the player sits, while something is playing: the item's own drawn box.
	 *
	 * It plays on while you work elsewhere on the canvas: letting go of the item, panning or zooming
	 * out does not stop it, because one decoder costs nothing a frame notices and a sound you are
	 * listening to should not end because you clicked away. It goes when it ends, when another is
	 * started, or when the item is gone from the file.
	 */
	const playingBox = createMemo(() => {
		penDrawn();
		const now = playing();
		if (!now) return undefined;
		const node = penLayer.placed.get(now.id)?.node;
		const box = penLayer.bounds.get(now.id);
		const media = mediaOf(node);
		if (!node || !box || !media) return undefined;
		const drag = editor.itemShift(now.id);
		return {
			...now,
			name: String(node.name ?? media.file.split("/").pop() ?? ""),
			...(media.seconds === undefined ? {} : { seconds: media.seconds }),
			...(media.peaks ? { peaks: media.peaks } : {}),
			radius: typeof node.cornerRadius === "number" ? node.cornerRadius : 8,
			x: box.x + drag.dx,
			y: box.y + drag.dy,
			w: box.w,
			h: box.h,
		};
	});
	// What stopped it above is still holding the file open: let it go, so nothing decodes off screen.
	createEffect(() => {
		if (playing() && !playingBox()) setPlaying(undefined);
	});
	/**
	 * The one selected item's corner radius, when it has corners to round: a rounded shape from the
	 * library, or pen's own rectangle or frame. The handle that drags it sits inside the top-left
	 * corner, as it does in a drawing program, and every corner follows it.
	 */
	const radiusHandle = createMemo(() => radiusHandleOf(penHandles(), { editable: !!props.onPenEdit, resizing: !!editor.resize(), drag: editor.drag() }, scene));
	/**
	 * The drawn items the same pill is for, when no board has it, or a group picked together, boards
	 * among them: the box round all of it, and what to call it. Not while one is typed into (its
	 * editor has its own toolbar) or drawn with the pen.
	 */
	/*
	 * What the draw tool's lasso holds (`inkSelection`): the same pill as a selection's, so its strokes can
	 * go to the agent as the select tool's can (Make a drawing, Make a board, Send), and be commented on, duplicated or deleted.
	 */
	const lassoItems = createMemo(() => {
		if (!props.drawing || !props.onInk || !props.inkAgent) return undefined;
		const held = inkSelection();
		const boxes = (held?.ids ?? []).map((id) => penLayer.bounds.get(id) ?? penLayer.placed.get(id)?.box).filter((b): b is NonNullable<typeof b> => !!b);
		if (!held || boxes.length === 0) return undefined;
		const x = Math.min(...boxes.map((b) => b.x));
		const y = Math.min(...boxes.map((b) => b.y));
		return { ids: [...held.ids], box: { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y } };
	});
	const calloutItems = createMemo(() => {
		if ((props.selected && !groupPicked()) || props.drawing || !props.onPenEdit || editor.text()) return undefined;
		const all = penOutlines().filter((one) => one.id);
		const outlines = all.filter((one) => !one.id.startsWith("board:"));
		const boards = all.length - outlines.length;
		if (outlines.length !== editor.items().length || boards !== editor.boardPicks().length || !all.length) return undefined;
		const x = Math.min(...all.map((one) => one.x));
		const y = Math.min(...all.map((one) => one.y));
		const box = { x, y, w: Math.max(...all.map((one) => one.x + one.w)) - x, h: Math.max(...all.map((one) => one.y + one.h)) - y };
		const ids = outlines.map((one) => one.id);
		const words = ids.map((id) => quoteOf(penLayer.placed.get(id)?.node)).filter(Boolean).join(" / ").slice(0, 160);
		const first = penLayer.placed.get(ids[0]!)?.node;
		const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
		const name = boards
			? [count(boards, "board"), ids.length ? count(ids.length, "item") : ""].filter(Boolean).join(", ")
			: ids.length > 1
				? `${ids.length} items`
				: words || (typeof first?.name === "string" ? first.name : first?.type) || "item";
		return { box, ids, words, name };
	});
	/** One drawn item selected, not a line or a group, and nothing being drawn: it shows where an arrow can leave it. */

	/** The two ends of a selected arrow as drawn, for the handles that pick them up. */
	const arrowEnds = createMemo(() => {
		penDrawn();
		return arrowEndsOf({ selection: editor.items(), boardPicks: editor.boardPicks(), drag: shownDrag() }, scene);
	});


	// Moving the camera: the controller's (`camera/controller.ts`).
	const { push: pushCamera, write: writeCamera, glideTo, cancelGlide, coast, cancelCoast, stopped: stoppedMoving } = ctl;

	/**
	 * The camera shortcuts, in one place.
	 *
	 * Called from this document's keydown and from a board frame's — a click on a board
	 * puts focus inside its iframe, and a keypress there never reaches the parent, so
	 * without forwarding the shortcuts stopped working the moment anyone touched a
	 * board. Returns whether the key meant anything, so the caller knows to swallow it.
	 */
	const shortcut = (key: string): boolean => {
		/*
		 * The palette's keys live here rather than in the palette, for the same reason
		 * the camera's do: a click on a board puts focus inside its iframe, so a
		 * keypress arrives in the board's document and is handed back through
		 * `frame-gestures.ts`. A component listening for its own key would hear nothing
		 * the moment anyone touched a board.
		 */
		const tool = TOOL_KEYS[key];
		if (tool && props.onTool) {
			props.onTool(tool);
			return true;
		}
		switch (key) {
			case "0":
				pushCamera(frame(props.boards.map(boxOf)));
				return true;
			case "1": {
				const board = props.boards.find((candidate) => candidate.path === props.selected) ?? props.boards[0];
				if (board) pushCamera(frame([boxOf(board)]));
				return true;
			}
			case "+":
			case "=":
				pushCamera(zoomAbout(ctl.now(), view(), centre(), 1.2));
				return true;
			case "-":
				pushCamera(zoomAbout(ctl.now(), view(), centre(), 1 / 1.2));
				return true;
			default:
				return false;
		}
	};

	/**
	 * Where the pointer is, in stage coordinates — which are the event's own client ones.
	 *
	 * There was a cached `getBoundingClientRect` here, refreshed every 250 ms, and a
	 * subtraction at each of three call sites. The stage element *is* the viewport, so all of
	 * that was adding zero: `camera/coords.ts` sets out why, and `checkStageOrigin` — called
	 * at mount — is what stops it quietly ceasing to be true.
	 */
	const local = stagePoint;

	/**
	 * One wheel gesture, wherever it came from.
	 *
	 * The stage calls this with its own events; a board frame calls it through
	 * `frame-gestures.ts`, because a wheel event inside an iframe never reaches this
	 * document at all. Positions arrive already in stage coordinates.
	 */
	/** A wheel or a trackpad's pinch, already in stage coordinates (`camera/controller.ts`). */
	const wheel = ctl.wheel;

	const onWheel = (event: WheelEvent) => {
		event.preventDefault();
		/*
		 * A sideways scroll over a card's wide table scrolls the table, as it would in a page; Shift and
		 * a wheel is sideways too. Everything else, over a table or not, moves the camera.
		 */
		if (!event.ctrlKey && !event.metaKey && props.pen && !props.drawing) {
			const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
			if (sideways !== 0 && penLayer.scrollBy(worldAt(event), sideways / ctl.now().zoom)) return;
		}
		const at = local(event);
		// `ctrlKey` is a trackpad pinch, not a key anybody pressed; `metaKey` is the
		// deliberate mouse-wheel zoom. Everything else is a two-finger scroll.
		wheel({ x: at.x, y: at.y, deltaX: event.deltaX, deltaY: event.deltaY, zooming: event.ctrlKey || event.metaKey, pinch: event.ctrlKey && !event.metaKey });
	};

	/**
	 * Every finger on the canvas, wherever it landed, and the camera they move.
	 *
	 * **One set of fingers for the whole stage**, and that is the load-bearing decision
	 * here. A pinch does not respect the boundaries of the documents it happens over: one
	 * finger can be inside a board's iframe and the other on bare canvas, or one on a
	 * board's title bar and the other on a third board. Each of those is two event
	 * streams and one gesture, and a tracker per stream turns it into two one-finger pans
	 * — which is precisely the bug that made a pinch shove the canvas about. So the
	 * fingers are pooled here (`touch.ts` reduces the pool), and the other documents feed
	 * them in: `frame-gestures.ts` for a board's own document, `BoardFrame` for its title
	 * bar.
	 *
	 * A finger can also be **claimed** by whoever it landed on — a scrollable embed, a
	 * board being dragged by its bar. A claimed finger still counts towards the pool, so
	 * a second finger makes a pinch with the right positions; it just does not pan. Two
	 * fingers always win: a pinch clears every claim, because zooming out of a board you
	 * had started to drag is a change of mind, not an ambiguity.
	 */
	const touches = createTouches();
	const claimed = new Set<number>();
	/** Fingers this document is carrying, as opposed to ones reported from a frame. */
	const carried = new Set<number>();
	/*
	 * The pan so far, as a path the camera has been dragged along, for the speed at release.
	 * A gesture that was ever more than a one-finger pan of the camera (a pinch, a finger a
	 * board claimed) does not coast.
	 */
	let trail: Sample[] = [];
	let trailAt = { x: 0, y: 0 };
	let noCoast = false;
	/** The gesture so far has been a pinch: its lift ends the moving state at once (`stoppedMoving`). */
	let pinched = false;
	/** Tiles at half density while pinching (`StageEngine.setPinching`); `__decksHalfPinch = false` turns it off, for measuring. */
	const halfWhilePinching = () => (globalThis as { __decksHalfPinch?: boolean }).__decksHalfPinch !== false;
	/**
	 * A finger of this document's, in the stage's own coordinates.
	 *
	 * The pool is kept in stage coordinates because that is the space the camera works
	 * in, and because a board's document has no other way to describe where a finger is —
	 * it converts on its way out (`frame-gestures.ts`). Converting again on the way in
	 * would subtract the stage's offset twice, which is a pinch that walks the canvas 90px
	 * *down* for a gesture that never moved vertically at all: exactly the bug that this
	 * conversion existing in one place instead of two is meant to stop.
	 */
	const fingerOf = (event: PointerEvent): Finger => {
		const at = stagePoint(event);
		return { id: event.pointerId, x: at.x, y: at.y };
	};

	/** One finger's worth of a gesture, from this document or from a board's. */
	const touch = (phase: "down" | "move" | "up", finger: Finger): TouchStep => {
		if (phase === "down") {
			// A finger on the glass stops a coast, the way a hand stops a spinning list.
			cancelCoast();
			touches.down(finger);
			if (touches.count() === 1) {
				trail = [];
				trailAt = { x: 0, y: 0 };
				noCoast = false;
				pinched = false;
			}
			setPanning(true);
			return { kind: "idle" };
		}
		if (phase === "up") {
			touches.up(finger.id);
			claimed.delete(finger.id);
			if (touches.count() === 0) {
				setPanning(false);
				const thrown = noCoast ? undefined : coastStart(velocityFrom(trail, performance.now()));
				trail = [];
				if (thrown) coast(thrown);
				else if (pinched && (globalThis as { __decksPinchTail?: boolean }).__decksPinchTail !== true) stoppedMoving();
				penLayer.setPinching(false);
			}
			return { kind: "idle" };
		}

		const step = touches.move(finger);
		if (step.kind === "pinch") {
			noCoast = true;
			if (!pinched && halfWhilePinching()) penLayer.setPinching(true);
			pinched = true;
			claimed.clear();
			pushCamera(pinchCamera(ctl.now(), view(), step.from, step.to));
			return step;
		}
		if (step.kind === "pan") {
			if (claimed.has(finger.id)) noCoast = true;
			else {
				pushCamera(pan(ctl.now(), step.dx, step.dy));
				trailAt = { x: trailAt.x + step.dx, y: trailAt.y + step.dy };
				trail.push({ ...trailAt, t: performance.now() });
				if (trail.length > 8) trail.shift();
			}
		}
		return step;
	};

	const onTouchMove = (event: PointerEvent) => {
		if (!carried.has(event.pointerId)) return;
		touch("move", fingerOf(event));
	};

	const onTouchEnd = (event: PointerEvent) => {
		if (!carried.has(event.pointerId)) return;
		carried.delete(event.pointerId);
		touch("up", fingerOf(event));
		if (carried.size > 0) return;
		window.removeEventListener("pointermove", onTouchMove);
		window.removeEventListener("pointerup", onTouchEnd);
		window.removeEventListener("pointercancel", onTouchEnd);
	};

	/** Hand back every finger this document is carrying, wherever each one got to. */
	const releaseCarried = () => {
		for (const id of [...carried]) {
			carried.delete(id);
			touch("up", { id, x: 0, y: 0 });
		}
	};

	const beginTouch = (event: PointerEvent) => {
		// A tap on bare canvas clears the selection, exactly as a click does. Decided on
		// the way down rather than on the way up: a pan that starts on empty stage is not
		// a gesture that wants to keep a component selected either.
		if (onCanvas(event.target)) props.onSelect(undefined);
		/*
		 * The browser's own word for "nothing else is down": the primary pointer of a
		 * touch sequence is the first finger on the glass. Anything still carried at that
		 * moment never reported its end, so it is dropped here rather than counted as
		 * half of a pinch that is not happening.
		 */
		if (event.isPrimary && carried.size > 0) releaseCarried();
		if (carried.size === 0) {
			/*
			 * On the window, not on the stage. Capture is a nicety that can be refused,
			 * and without it a finger that slides off the canvas — onto the conversation,
			 * the rail, the composer — lifts somewhere this element never hears about,
			 * and the pool keeps it. The handlers ask `carried` which fingers are theirs,
			 * so listening wider costs nothing and closes that gap.
			 */
			window.addEventListener("pointermove", onTouchMove);
			window.addEventListener("pointerup", onTouchEnd);
			window.addEventListener("pointercancel", onTouchEnd);
		}
		carried.add(event.pointerId);
		touch("down", fingerOf(event));
		try {
			element.setPointerCapture(event.pointerId);
		} catch {
			// Capture is per-pointer and can be refused; the listeners above still carry
			// the gesture for as long as the finger stays over the stage.
		}
	};

	/**
	 * The whole hand, gone: the tab went to the background, or the OS took the gesture.
	 *
	 * Neither of those ends a touch in a way any document is told about — the events
	 * simply stop — so every finger in the pool is released, including the ones reported
	 * from a board's own document, because whatever took the gesture took all of them.
	 * Without this, backgrounding the tab mid-pan is enough to leave the canvas reading
	 * every later touch as a pinch.
	 */
	const lostTouches = () => {
		if (carried.size === 0 && touches.count() === 0) return;
		releaseCarried();
		for (const id of touches.ids()) touches.up(id);
		claimed.clear();
		setPanning(false);
	};
	const onHidden = () => {
		if (document.visibilityState === "hidden") lostTouches();
	};
	/*
	 * Focus moving *into* a board blurs this window too, and that happens on an ordinary
	 * tap — so a bare `blur` handler would throw the gesture away as it began.
	 * `document.hasFocus()` is the difference: it counts a nested frame as this document
	 * having focus, and is false only when the browser or the tab really has lost it.
	 */
	const onBlur = () => {
		if (document.hasFocus()) return;
		lostTouches();
	};
	window.addEventListener("blur", onBlur);
	document.addEventListener("visibilitychange", onHidden);
	onCleanup(() => {
		window.removeEventListener("blur", onBlur);
		document.removeEventListener("visibilitychange", onHidden);
		window.removeEventListener("pointermove", onTouchMove);
		window.removeEventListener("pointerup", onTouchEnd);
		window.removeEventListener("pointercancel", onTouchEnd);
	});

	/** What a board frame hands back when a canvas gesture starts inside it. */
	const gestures: FrameGestureHost = {
		wheel: (gesture) => wheel(gesture),
		touch: (phase, finger) => touch(phase, finger),
		claimTouch: (id) => claimed.add(id),
		pinching: () => touches.count() > 1,
		pan: (dx, dy) => pushCamera(pan(ctl.now(), dx, dy)),
		space: (held) => setSpaceHeld(held),
		spaceHeld: () => grabbing(),
		interactive: () => ctl.now().zoom >= INTERACT_ZOOM,
		/*
		 * Where a world point is on the stage right now, from the camera the gestures are
		 * moving — `ctl.now()`, which is written synchronously in the same handler that
		 * moves the world, so a frame asking mid-gesture gets the camera its event was
		 * dispatched against. This is what lets a board frame convert a finger without
		 * measuring itself: `getBoundingClientRect` on a frame is a forced layout of the
		 * whole stage, and a pinch had two of them per step.
		 */
		screenOf: (world) => {
			const at = toScreen(ctl.now(), view(), world);
			return { x: at.x, y: at.y, scale: ctl.now().zoom };
		},
		key: (name) => shortcut(name),
		/*
		 * Same three keys as the window handler above, and deliberately the same code path —
		 * a board frame forwards the *intent* rather than a key name, because `shortcut` takes
		 * a bare key and `zoom-keys.ts` has already read the modifier.
		 */
		zoom: (direction) => {
			if (direction === "fit") pushCamera(frame(props.boards.map(boxOf)));
			else pushCamera(zoomAbout(ctl.now(), view(), centre(), direction === "in" ? 1.2 : 1 / 1.2));
		},
	};

	/** Where the hovered block's grip goes: in the card's left margin, level with the block's first line. */
	const gripBox = createMemo(() => {
		penDrawn();
		return gripBoxOf({ block: editor.hoverBlock(), busy: !!editor.boardDrag() || panning(), editing: props.mode === "edit" }, scene, (id, node) => {
			// Centred on the block's first line, as the layout sets it: a heading's is taller than a paragraph's.
			const look = editor.textEditing.lookOf(node, penLayer.placed.get(id));
			return firstLine(parseMarkdown(String(node.content ?? ""))[0], look.size, look.line);
		});
	});

	/** The hovered item's box as it is drawn now, or the board under the pointer. */
	const hoverBox = createMemo(() => {
		penDrawn();
		return hoverBoxOf(
			{ editing: props.mode === "edit", item: editor.hoverItem(), typing: editor.typing(), board: editor.hoverBoard() ?? editor.hoverPicture(), selected: props.selected, busy: !!editor.boardDrag() || panning(), boards: scene.boards(), glide: editor.glide() },
			scene,
		);
	});

	/** What the selection and the hovered item sit in and hold: light outlines round their parents and children. */
	const kinBoxes = createMemo(() => {
		penDrawn();
		return kinOutlines(
			{ selection: editor.items(), drag: shownDrag(), glide: editor.glide(), resizing: !!editor.resize(), typing: editor.typing(), editing: props.mode === "edit", hover: editor.hoverItem(), busy: !!editor.boardDrag() || panning() || !!editor.gesture() },
			scene,
		);
	});
	/** One box round everything selected, with its size under it. */
	const penFrame = createMemo(() => selectionFrame(penOutlines()));
	/** Alt held over another item or board, in edit mode: the distances to it from the selection. */
	const penDistances = createMemo(() => {
		const over = hoverBox();
		// A board picked up with the selection is part of it, not something to measure to.
		const path = editor.hoverBoard() ?? editor.hoverPicture();
		const picked = !!over?.board && !!path && editor.boardPicks().includes(path);
		return distancesOf({ editing: props.mode === "edit", alt: editor.altHeld(), busy: !!editor.gesture() || !!editor.boardDrag() || panning(), selection: penFrame(), over: picked ? undefined : over });
	});

	/**
	 * The camera dragged from a press (`editor/core/dispatch.ts`, `pan`): with the middle button, with
	 * Space held, or on bare canvas, which lets the selected board go (`deselect`).
	 */
	const panFrom = (event: PointerEvent, how: { deselect: boolean; middle: boolean }) => {
		const { middle } = how;
		event.preventDefault();
		if (how.deselect) props.onSelect(undefined);
		element.setPointerCapture(event.pointerId);
		setPanning(true);

		let last = { x: event.clientX, y: event.clientY };
		const move = (moveEvent: PointerEvent) => {
			pushCamera(pan(ctl.now(), moveEvent.clientX - last.x, moveEvent.clientY - last.y));
			last = { x: moveEvent.clientX, y: moveEvent.clientY };
			editor.panned();
		};
		// Ended on any sign the button is up, not only its release (`held.ts`).
		const stop = untilReleased({ docs: [document], held: middle ? 4 : 1, capture: element, end: () => finish() });
		const finish = () => {
			stop();
			element.removeEventListener("pointermove", move);
			setPanning(false);
		};
		element.addEventListener("pointermove", move);
	};

	/** The camera boards and their bookkeeping see: the settled one (`camera/controller.ts`). */
	const boardCamera = ctl.settled;
	/**
	 * Which boards are on screen, or within a viewport of it.
	 *
	 * A board off screen is a document not loaded — three of them is nothing, but a
	 * deck of forty each pulling pdf.js is a browser on its knees. The margin is
	 * one viewport, so panning reaches a board that is already rendered.
	 */
	const isVisible = (board: Board) => {
		const v = view();
		if (v.width === 0) return false;
		const cam = boardCamera();
		const topLeft = toScreen(cam, v, { x: board.x, y: board.y });
		const bottomRight = toScreen(cam, v, { x: board.x + board.w, y: board.y + board.h });
		const margin = { x: v.width, y: v.height };
		return (
			bottomRight.x > -margin.x &&
			topLeft.x < v.width + margin.x &&
			bottomRight.y > -margin.y &&
			topLeft.y < v.height + margin.y
		);
	};

	/**
	 * The boards that exist on the page at all: the ones `isVisible` would say yes to, found through a
	 * spatial index (`spatial.ts`) rather than by asking every board — and any board that must stay
	 * whatever the camera does: one whose document is showing (it is let go of by the admission's own
	 * clock, `board-admission.ts`, and leaves here after that), the selected one, the one being
	 * edited, dragged or resized.
	 *
	 * A board outside that is not a node: no frame component, no title bar, nothing re-evaluated when
	 * the camera moves. Every per-board thing a frame of the camera costs — `isVisible`, the admission,
	 * the bar, the glow's read check — is then paid for the boards near the window, not for the stage.
	 * The sheet draws the rest (`pen/scene.ts`), from the same kind of index.
	 */
	/**
	 * The zoom as of the camera's last rest. What a board is given by size — a document, its glow —
	 * changes when the camera stops, never partway through a pinch, where a board crossing the line
	 * would have its page torn down or started mid-gesture.
	 */
	const restZoom = createMemo<number>((was) => (was !== undefined && (moving() || scaling() || panning() || gliding()) ? was : ctl.zoom()));
	/**
	 * Boards are live: the camera rested at this device's live zoom or above (`INTERACT_ZOOM`, 20%
	 * on a desktop), the same zoom at which a page takes the pointer. Below it a board is its picture
	 * on the sheet (`pen/scene.ts`), which also draws its news glow; above it, it has a document and
	 * the page's own glow, which breathes.
	 */
	const liveZoom = createMemo(() => restZoom() >= INTERACT_ZOOM);
	/**
	 * The camera is at the live zoom *now*, not only as of its last rest. `liveZoom` holds the zoom of
	 * the last rest through a gesture, so pages are not dropped and remade mid-gesture; but a page
	 * must never be *started* below the live zoom on its strength. A wheel zoom out from 103% to 3%
	 * whose steps outlasted a movement's end made 377 pages in one task as it finished, still
	 * counting as at 103%, and the page froze for six seconds. One answer for the stage, so a board
	 * re-runs only when it flips.
	 */
	const liveNow = createMemo(() => ctl.zoom() >= INTERACT_ZOOM);
	const boardIndex = createMemo(() => new BoxIndex(props.boards));
	const boardSlot = createMemo(() => new Map(props.boards.map((board, i) => [board.path, i])));
	/** The stage rectangle `isVisible` answers for: the window, and one window more on each side. */
	const reach = () => {
		const v = view();
		const cam = boardCamera();
		const corner = toWorld(cam, v, { x: -v.width, y: -v.height });
		return { x: corner.x, y: corner.y, w: (3 * v.width) / cam.zoom, h: (3 * v.height) / cam.zoom };
	};
	/**
	 * The boards whose page the admission still holds (`createAdmission`, made further down, which
	 * sets this). Leaving reach is not leaving: a page is let go only once it has been gone a while
	 * and the camera has been still, and a node taken away mid-zoom took its page with it, to be
	 * loaded again as the zoom came back.
	 */
	let heldPages: () => readonly string[] = () => [];
	const rendered = createMemo<readonly Board[]>((was) => {
		const boards = props.boards;
		if (view().width === 0) return was ?? [];
		/*
		 * Below the live zoom a board is its picture on the sheet and nothing else, so it has no node:
		 * 400 of them cost a pan step 10 ms of the page's time, and each camera step reached every one.
		 * The stage finds the board under a press itself (`editor/dom/pointer.ts`, `pictureUnder`). Not under the Canvas renderer,
		 * where a board's node draws its own picture.
		 *
		 * Live as of the last rest *and* now: the zoom of the last rest holds through a gesture, and a
		 * wheel zoom out from a board made nodes for 380 boards as their reach grew, to drop them all
		 * when it stopped.
		 */
		const found = new Set(props.renderer !== "dom" || (liveZoom() && liveNow()) ? boardIndex().search(reach()) : []);
		const keep = (path: string | undefined) => {
			const at = path === undefined ? undefined : boardSlot().get(path);
			if (at !== undefined) found.add(at);
		};
		for (const path of liveBoards().keys()) keep(path);
		for (const path of shownBoards()) keep(path);
		if (props.renderer === "dom" && liveZoom()) for (const path of heldPages()) keep(path);
		keep(props.selected);
		for (const path of editor.heldBoards()) keep(path);
		const next = [...found]
			.sort((a, b) => a - b)
			.map((at) => boards[at]!);
		// The same boards as last frame, which is nearly every frame of a pan: the same array, so nothing downstream runs.
		return was && was.length === next.length && next.every((board, i) => board === was[i]) ? was : next;
	});

	/** `rendered`, as a set to look a board up in. */
	const renderedPaths = createMemo(() => new Set(rendered().map((board) => board.path)));
	/** The boards may go on layers while the scale moves: few enough of them near the window. Worked out once per change, not per read. */
	const layered = createMemo(() => scaling() && rendered().filter(isVisible).length <= LAYER_BUDGET);

	/** The camera as of its last rest, as `restZoom` is the zoom. */
	const restCamera = createMemo<Camera>((was) => (was !== undefined && (moving() || scaling() || panning() || gliding()) ? was : props.camera));

	/*
	 * SVGs shown live on the canvas (`liveFileItem`), each as an image. Each is an element in the boards' layer, under the sheet, which draws a hole
	 * where it is (`paint.ts`, `holes`): so it moves with the boards in the same frame, and what is drawn
	 * over it stays over it. As a board's page: only from the live zoom, only near the screen as of the
	 * camera's last rest, the nearest few; while a zoom moves, or the item is being moved or sized, the
	 * sheet draws its still over it instead, and the element waits underneath, still loaded.
	 */
	const liveFiles = createMemo(
		() => {
			penDrawn();
			const cam = restCamera();
			if (cam.zoom < INTERACT_ZOOM || !props.pen) return [] as LiveFile[];
			const v = view();
			const mx = v.width * 0.25;
			const my = v.height * 0.25;
			const near: Array<LiveFile & { d: number }> = [];
			for (const placed of penLayer.placed.values()) {
				const node = placed.node;
				if (!isLiveFile(node) || node.metadata?.kind !== "svg" || typeof node.metadata.file !== "string") continue;
				const box = penLayer.bounds.get(node.id) ?? placed.box;
				const a = toScreen(cam, v, { x: box.x, y: box.y });
				const b = toScreen(cam, v, { x: box.x + box.w, y: box.y + box.h });
				if (b.x < -mx || a.x > v.width + mx || b.y < -my || a.y > v.height + my) continue;
				near.push({ id: node.id, file: node.metadata.file, name: String(node.name ?? node.metadata.file.split("/").pop()), d: Math.hypot((a.x + b.x - v.width) / 2, (a.y + b.y - v.height) / 2) });
			}
			return near.sort((p, q) => p.d - q.d).slice(0, LIVE_FILES).map(({ d: _d, ...file }) => file);
		},
		[],
		{ equals: (a, b) => a.length === b.length && a.every((file, k) => file.id === b[k]!.id && file.file === b[k]!.file && file.name === b[k]!.name) },
	);
	/**
	 * The items the sheet draws as holes: the live ones, and none while a zoom moves. A moved or sized one
	 * stays live: its element goes with the drag as the sheet's hole does (`liveBox`), so an animation being
	 * carried keeps playing, not its still.
	 */
	const fileHoles = createMemo(
		() => {
			if (scaling()) return new Set<string>();
			return new Set(liveFiles().map((file) => file.id));
		},
		new Set<string>(),
		{ equals: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)) },
	);
	createEffect(
		on(fileHoles, (ids) => {
			penLayer.holes(ids);
			holesAsked = { ids, mark: penLayer.mark() };
		}),
	);
	/** Where each live file is on the stage, from the layout the sheet drew. */
	const liveBox = (id: string) => {
		penDrawn();
		const placed = penLayer.placed.get(id);
		const resized = editor.itemResize(id);
		if (resized) return { x: resized.x, y: resized.y, w: resized.w, h: resized.h, radius: Number(placed?.node.cornerRadius ?? 0) || 0 };
		const box = penLayer.bounds.get(id) ?? placed?.box;
		if (!box) return undefined;
		// Carried with the drag, from the frame the sheet carries it in (`shownDrag`).
		const drag = editor.itemShift(id);
		return { x: box.x + drag.dx, y: box.y + drag.dy, w: box.w, h: box.h, radius: Number(placed?.node.cornerRadius ?? 0) || 0 };
	};
	/** A double-click on a live SVG opens it in a tab. */
	const openLiveFile = (id: string): boolean => {
		const index = props.pen ? docIndex(props.pen.doc) : undefined;
		let node: PenNode | undefined;
		for (let at = index?.get(id); at && !node; at = at.parent ? index?.get(at.parent.id) : undefined) if (isLiveFile(at.node)) node = at.node;
		if (!node || typeof node.metadata?.file !== "string") return false;
		editor.select([node.id]);
		window.open(canvasHost().fileUrl(node.metadata.file), "_blank", "noopener");
		return true;
	};
	/**
	 * On a phone, the one board that is live (`ONE_LIVE`): of the boards on screen, the one the
	 * middle of the screen is on, or else nearest it; the one on top where two overlap. Decided
	 * when the camera rests, so a pan hands the page from one board to the next once, at the end.
	 */
	const centreBoard = createMemo<string | undefined>(() => {
		if (!ONE_LIVE || !liveZoom()) return undefined;
		const v = view();
		if (v.width === 0) return undefined;
		const c = restCamera();
		const window = { x: c.x - v.width / 2 / c.zoom, y: c.y - v.height / 2 / c.zoom, w: v.width / c.zoom, h: v.height / c.zoom };
		let best: string | undefined;
		let nearest = Infinity;
		for (const at of boardIndex().search(window)) {
			const board = props.boards[at]!;
			const dx = Math.max(board.x - c.x, 0, c.x - (board.x + board.w));
			const dy = Math.max(board.y - c.y, 0, c.y - (board.y + board.h));
			const d = Math.hypot(dx, dy);
			if (d <= nearest) {
				nearest = d;
				best = board.path;
			}
		}
		return best;
	});
	/** Whether a board is drawn as a page rather than its picture, as far as the zoom decides. */
	const paged = (board: Board) => props.selected === board.path || (ONE_LIVE ? centreBoard() === board.path : liveZoom());


	/**
	 * Which boards have a document, and the gate that holds them at the open
	 * (`board-admission.ts`).
	 *
	 * It is handed `isVisible` rather than owning it, because the render body asks the same
	 * question — and `ctl.lastMoved()` as a getter, because the gestures write it synchronously in
	 * their own handler while this reads it from a timer.
	 */
	/*
	 * Arriving on another canvas: its boards come in at the camera of the canvas just left, and the
	 * camera moves to this canvas's own view a moment later (`App.landOnStage`). Until it has, no
	 * board starts a page: on an 83-board canvas the old camera started 54 pages that the move threw
	 * away half a second later, inside one 2.7 s task.
	 */
	const [landing, setLanding] = createSignal(false);
	let landingTimer: ReturnType<typeof setTimeout> | undefined;
	createEffect(
		on(
			() => props.stageName,
			(name, was) => {
				if (was === undefined || name === was) return;
				setLanding(true);
				clearTimeout(landingTimer);
				landingTimer = setTimeout(() => setLanding(false), 1500);
				// The camera that arrives next is this canvas's.
				createEffect(
					on(
						() => props.camera,
						() => {
							clearTimeout(landingTimer);
							setLanding(false);
						},
						{ defer: true },
					),
				);
			},
		),
	);
	onCleanup(() => clearTimeout(landingTimer));
	const admission = createAdmission({
		boards: () => props.boards,
		isVisible,
		view,
		moving: () => moving() || gliding() || glidePending() || landing() || !!props.switching,
		live: liveNow,
		onScreen: (board) => {
			const v = view();
			const a = toScreen(ctl.settled(), v, { x: board.x, y: board.y });
			const b = toScreen(ctl.settled(), v, { x: board.x + board.w, y: board.y + board.h });
			return b.x > 0 && a.x < v.width && b.y > 0 && a.y < v.height;
		},
		ready: (board) => untrack(liveBoards).has(board.path),
		lastMoved: () => ctl.lastMoved(),
		screenCentre: (board) => toScreen(props.camera, view(), { x: board.x + board.w / 2, y: board.y + board.h / 2 }),
		mayStart: () => props.boardsMayStart,
		onStarted: () => {
			/*
			 * The canvas's own queue, opened by the canvas: a thumbnail is a document on the same
			 * main thread as a board, and of everything on screen at the open it is the least
			 * urgent — so it waits for the boards to take their turn (`thumb-budget.ts`).
			 */
			openThumbnails();
			props.onBoardsStarted?.();
		},
	});
	createEffect(() => admission.begin());
	heldPages = admission.held;
	// At rest below the live zoom no board has a page, kept ones aside, so the admission holds none.
	createEffect(() => {
		if (!liveZoom()) admission.forget();
	});




	// --- the canvas renderers ---------------------------------------------------------

	/**
	 * Settle redraws for every board, a few per frame (`redraw-queue.ts`).
	 *
	 * Under `canvas-per-board` each board draws its own canvas through it, so sixteen boards
	 * settling at once is four frames of work rather than one long one.
	 */
	const redraws = createRedrawQueue({ perFrame: 4 });
	onCleanup(() => redraws.clear());

	/** What each board frame is given for the canvas renderer (`canvas/picture.ts`). */
	const pictures = { queue: redraws };


	/*
	 * Where the canvas opens, the first time this conversation's boards arrive.
	 *
	 * The view this device left it in, when there is one — and otherwise a fit, so the deck opens
	 * looking at itself rather than at world origin.
	 *
	 * `props.opening` is `undefined` until the focused conversation is known, which is not always
	 * before the boards are: fitting at that moment and being told where to look a frame later is
	 * a canvas that lands somewhere and then jumps. So the effect waits for the answer rather
	 * than for the boards alone.
	 */
	let fitted = false;
	createEffect(() => {
		if (fitted || !props.opening || props.boards.length === 0 || view().width === 0) return;
		fitted = true;
		props.setCamera(props.opening.camera ?? frame(props.boards.map(boxOf)));
	});

	/** One board, as the canvas draws it: the host's frame, told where it is and what it may do. */
	const boardNode = (board: Board) => (
		<Frame
			board={board}
			renderer={props.renderer}
			scaling={scaling()}
			moving={moving()}
			pictures={pictures}
			camera={boardCamera()}
			mounted={
				/* The selected board is live at any zoom, on any device. */
				props.selected === board.path ||
				(ONE_LIVE ? centreBoard() === board.path : liveZoom() && admission.mayHaveDocument(board) && admission.isMounted(board, liveNow()))
			}
			visible={isVisible(board)}
			onLive={(on: boolean) => markLive(board.path, on)}
			carried={carriedPages().has(board.path) || draggedAsPicture().has(board.path)}
			selected={props.selected === board.path}
			{...(props.onComment
				? {
						onCommentWords: (words: { quote: string; component?: string; anchor: () => DOMRect | undefined }) =>
							props.onComment?.({ path: board.path, title: board.title, quote: words.quote, anchor: words.anchor, ...(words.component ? { component: words.component } : {}) }),
					}
				: {})}
			sizing={sizingPaths().has(board.path)}
			news={paged(board) ? props.news?.[board.path] : undefined}
			onRead={() => props.onRead?.(board.path)}
			gestures={gestures}
			{...(props.onOpenBoard ? { onOpenBoard: props.onOpenBoard } : {})}
			view={editor.boardView(board.path)}
			{...(props.onExtent ? { onExtent: (extent) => props.onExtent?.(board.path, extent) } : {})}
			onMove={(x, y) => props.onMove(board.path, x, y)}
			{...(props.onResize ? { onResize: (size) => props.onResize?.(board.path, size) } : {})}
			{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
			onOpen={() => pushCamera(frame([boxOf(board)]))}
		/>
	);

	/*
	 * Boards whose size just changed from outside a drag (`decks.canvas.fit`, an agent's `decks.canvas.update`, a write that
	 * measured taller): for `SIZE_MS` their box, title bar and outline ease to the new size rather
	 * than jump (`canvas.css`, `[data-sizing]`). A size the person drags is never eased: it follows
	 * the pointer, and the board takes it while `boardResize` still holds it, so nothing changes here.
	 */
	const SIZE_MS = 280;
	const [sizingPaths, setSizingPaths] = createSignal<ReadonlySet<string>>(new Set());
	const lastSizes = new Map<string, { size: string; since: number }>();
	/** A board that arrived this recently is still taking its measured height: it is not eased. */
	const SETTLE_MS = 2500;
	const sizingTimers = new Map<string, ReturnType<typeof setTimeout>>();
	createEffect(() => {
		const held = editor.resizingBoard();
		const grew: string[] = [];
		for (const board of props.boards) {
			const size = `${board.w}x${board.h}`;
			const before = lastSizes.get(board.path);
			const now = performance.now();
			lastSizes.set(board.path, { size, since: before?.since ?? now });
			if (before !== undefined && before.size !== size && board.path !== held && now - before.since > SETTLE_MS) grew.push(board.path);
		}
		if (grew.length === 0) return;
		untrack(() => setSizingPaths(new Set([...sizingPaths(), ...grew])));
		for (const path of grew) {
			clearTimeout(sizingTimers.get(path));
			sizingTimers.set(
				path,
				setTimeout(() => {
					sizingTimers.delete(path);
					const next = new Set(sizingPaths());
					next.delete(path);
					setSizingPaths(next);
				}, SIZE_MS + 60),
			);
		}
	});
	onCleanup(() => {
		for (const timer of sizingTimers.values()) clearTimeout(timer);
	});

	const stagePenPath = () => (props.stageName ? `canvases/${props.stageName}/canvas.pen` : undefined);
	/** A dragged arrow handle's dashed route, where it sits. */
	const routeShown = editor.route;
	/**
	 * Everything the editor draws over the canvas (`editor/core/overlay.ts`), for `OverlayLayer`. Each
	 * part keeps its own memo above, read here, so a part that has not changed hands the layer the
	 * same value and nothing it draws is touched.
	 */
	const overlay = createMemo<Overlay>(() => ({
		outlines: penOutlines(),
		handles: penHandles(),
		anchors: penAnchors(),
		boardHandles: boardHandles(),
		radius: radiusHandle(),
		radiusDrag: editor.radius(),
		arrow: arrowEnds(),
		hover: hoverBox(),
		kin: kinBoxes(),
		selectionFrame: penFrame(),
		distances: penDistances(),
		grip: gripBox(),
		gripHidden: gripHidden(editor.drag(), !!editor.resize()),
		drop: dropBox(),
		insert: editor.dropSlot()?.line,
		slots: editor.dropNear()?.slots ?? [],
		slotFrames: editor.dropNear()?.frames ?? [],
		joins: editor.joins(),
		sides: editor.sides(),
		guides: editor.guides(),
		draft: editor.draft(),
		route: routeShown(),
		endDraft: editor.endDraft(),
	}));

	return (
		<div
			class="stage"
			/*
			 * Focusable, and focused when a press lands outside a board.
			 *
			 * A press on the canvas is a press on a `<div>`, and a `<div>` takes no focus — so the board's
			 * frame never learned it had lost it, `focusout` never fired inside it, and an open run or caret
			 * stayed open with its outline on while the person had visibly clicked away. Measured: pressing
			 * bare stage left the run `contenteditable` and its border drawn.
			 *
			 * `-1` because this is a place for focus to *land*, not something to tab to, and the outline is
			 * suppressed because the ring would be chrome nobody asked for.
			 */
			tabindex={-1}
			data-mode={props.mode}
			data-renderer={props.renderer}
			data-engine="true"
			data-panning={panning()}
			data-pen-tool={props.onPenEdit && !props.drawing && penTool() !== "select" ? penTool() : undefined}
			data-scaling={layered()}
			data-gliding={gliding()}
			/* Boards drawn as pictures while the camera moves: their pages are hidden (`canvas.css`). */
			data-pictures={picturesNow() ? "true" : undefined}
			/* The camera rests at or above this device's live zoom: boards have pages and take the pointer. */
			data-live={liveZoom() ? "true" : undefined}
			data-moving={moving() || panning() || gliding() ? "true" : undefined}
			/* Moving at one zoom: the world is held as one layer and slid (`canvas.css`). Off in the frame a zoom starts, so the layer is never stretched. */
			data-sliding={(moving() || panning() || gliding()) && !scaling() ? "true" : undefined}
			/* A board being moved or sized: its title bars and news glows step aside until it lands (`canvas.css`). */
			data-carrying={editor.carrying() ? "true" : undefined}
			ref={element}
			onWheel={onWheel}
			onPointerDown={editor.onPointerDown}
			onPointerMove={editor.onPointerMove}
			onPointerLeave={editor.onPointerLeave}
			onDblClick={editor.onDblClick}
			style={{ cursor: grabbing() ? "grab" : overLink() ? "pointer" : undefined }}
		>
			{/* The stage engine could not start (`penLayer.failed`): why, over the stage, where the drawing would be. */}
			<Show when={engineNotice()}>
				{(notice) => (
					<div class="stage-notice" role="alert">
						{notice()}
					</div>
				)}
			</Show>
			<div class="world" data-sizing={sizingPaths().size > 0 ? "true" : undefined} ref={worldEl}>
				{/*
				 * A place for every board on the canvas, in file order, filled while it is within reach.
				 *
				 * A list of only the boards in reach was reconciled as boards came and went, and the
				 * reconciler kept the order by moving nodes: **moving an iframe reloads its page**, and
				 * zooming out from 60 to 40% reloaded six loaded boards of twenty-three. Even a list that
				 * only gains boards in the middle is diffed with moves. So each board has a slot of its own
				 * that never moves (`display: contents`, so it lays nothing out), filled while the board
				 * is within reach: only a slot's inside changes, and boards still stack in file order.
				 */}
				<For each={props.boards} fallback={null}>
					{(board) => (
						<div class="board-slot">
							<Show when={renderedPaths().has(board.path)}>{boardNode(board)}</Show>
						</div>
					)}
				</For>
				{/*
				 * The stage's one sheet — the drawing, and each board's picture or a hole over its
				 * document — and the invisible shapes that catch clicks on the drawing: after the boards,
				 * so over them; a click goes through to a board wherever nothing drawn is in the way. See
				 * `pen/layer.ts` and `pen/scene.ts`.
				 */}
				{/* Files shown live, under the sheet's holes for them (`liveFiles`): after the boards, so over them, as the drawing is. */}
				<For each={liveFiles()}>
					{(file) => {
						const box = () => liveBox(file.id);
						const shown = () => holesShown().has(file.id);
						return (
							<Show when={box()}>
								{(at) => (
									<div
										class="file-live"
										data-live-file={file.id}
										style={{ left: `${at().x}px`, top: `${at().y}px`, width: `${at().w}px`, height: `${at().h}px`, "border-radius": `${at().radius}px`, visibility: shown() ? "visible" : "hidden" }}
									>
										<img src={canvasHost().fileUrl(file.file)} alt={file.name} draggable={false} />
									</div>
								)}
							</Show>
						);
					}}
				</For>
				{/* The engine's canvas over the pages (`stage/engine.ts`): the pictures of boards with no live page, the drawing as tiles with a hole for each board, and what a gesture is moving. */}
				<canvas
					class="stage-engine stage-engine-over"
					aria-hidden="true"
					ref={(canvas) => {
						penLayer.attachCanvas(canvas);
					}}
				/>
				<svg class="pen-hits" aria-hidden="true" width="1" height="1" ref={(svg) => penLayer.attachHits(svg)} />
				{/* By index, not by box: a drag makes a new box every move, and a new element for it every
				    move made the page restyle what it holds (`Index` keeps the element and moves it). */}
				<OverlayLayer
					overlay={overlay}
					zoom={ctl.zoom()}
					sizing={(path) => sizingPaths().has(path)}
					onGrip={editor.onGrip}
					onAnchor={editor.insert.fromAnchor}
					onArrowEnd={editor.onArrowEnd}
					onArrowBend={editor.onArrowBend}
					onHandle={editor.onHandle}
					onRadius={editor.onRadius}
					onBoardHandle={editor.onBoardHandle}
				>
					{/*
					 * The one player, laid over the item it belongs to.
					 *
					 * A real element because nothing else can play: the canvas draws in a worker and there
					 * is no browser in there. It is the same bargain a board makes — a picture until you
					 * are close and have asked — and it is one element, never a wall of them.
					 */}
					<Show when={playingBox()?.id} keyed>
						{(id) => {
							const now = () => playingBox()!;
							const first = now();
							return (
								<Show when={playingBox()}>
									<MediaPlayer
										kind={first.kind}
										src={canvasHost().fileUrl(first.file)}
										name={first.name}
										{...(first.seconds === undefined ? {} : { seconds: first.seconds })}
										{...(first.peaks ? { peaks: first.peaks } : {})}
										box={{ x: now().x, y: now().y, w: now().w, h: now().h }}
										radius={now().radius}
										scheme={scheme()}
										{...(playedTo.get(id) ? { from: playedTo.get(id)! } : {})}
										ref={(element) => (playingElement = element)}
										onEnded={() => {
											playedTo.delete(id);
											setPlaying(undefined);
										}}
										onLeave={(at) => {
											playingElement = undefined;
											if (at > 0.5) playedTo.set(id, at);
										}}
									/>
								</Show>
							);
						}}
					</Show>
				</OverlayLayer>
				<TextEditor text={editor.textEditing} zoom={ctl.zoom()} />
			</div>
			<InsertMenu menu={editor.insert} />
			{/*
				Boards have no title bars: the selected board's name and actions are a pill over it
				(`BoardCallout`), on every device. Kept mounted through a movement and only hidden, so a
				drag that began on its grip keeps the element it captured the pointer on.
			*/}
			<Show when={props.boardPill && !props.drawing ? calloutBoard() : undefined} keyed>
				{(board) => (
					<BoardCallout
						board={board}
						box={boxOf(board)}
						obstacles={() => pillObstacles(boxOf(board))}
						label={`${board.title}: board actions`}
						hidden={moving() || panning() || scaling() || gliding() || editor.carrying()}
						camera={ctl.settled()}
						view={view()}
						onOpen={() => pushCamera(frame([boxOf(board)]))}
						{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
						{...(props.onDeleteBoard ? { onDelete: () => props.onDeleteBoard?.(board.path) } : {})}
						{...(props.onPillMore ? { onMore: (anchor: DOMRect) => props.onPillMore?.({ path: board.path }, anchor) } : {})}
						{...(props.onComment
							? {
									onComment: () =>
										props.onComment?.({
											path: board.path,
											quote: "",
											title: board.title,
											// Under the pill, which follows the board as the camera moves.
											anchor: () => document.querySelector(".stage > .board-callout")?.getBoundingClientRect(),
										}),
								}
							: {})}
					/>
				)}
			</Show>
			<Show when={calloutItems()}>
				{(items) => (
					<BoardCallout
						box={items().box}
						obstacles={() => pillObstacles(items().box)}
						label={`${items().name}: actions`}
						gap={penAnchors() ? ANCHOR_OUT + ANCHOR_PX / 2 + 6 : undefined}
						hidden={pressHeld() || moving() || panning() || scaling() || gliding() || editor.drag().dx !== 0 || editor.drag().dy !== 0 || !!editor.resize()}
						camera={ctl.settled()}
						view={view()}
						onOpen={() => pushCamera(frame([items().box]))}
						// What acts on drawn items: a group of boards alone has only Open.
						{...(items().ids.length
							? {
									...(props.onComment
										? {
												onComment: () =>
													props.onComment?.({
														// A drawn item is found by its canvas's file and its id (`BoardComment.items`).
														path: stagePenPath() ?? "the canvas",
														items: items().ids,
														quote: items().words,
														title: items().name,
														anchor: () => document.querySelector(".stage > .board-callout")?.getBoundingClientRect(),
													}),
											}
										: {}),
									...(props.onInk && props.inkAgent && items().ids.every((id) => { const node = penNode(id); return !!node && isInk(node); })
										? {
												ink: {
													agent: props.inkAgent,
													onDrawing: () => props.onInk?.({ action: "drawing", ids: items().ids, canvas: props.stageName ?? "", box: items().box }),
													onBoard: () => props.onInk?.({ action: "board", ids: items().ids, canvas: props.stageName ?? "", box: items().box }),
													onSend: () => props.onInk?.({ action: "send", ids: items().ids, canvas: props.stageName ?? "", box: items().box }),
												},
											}
										: {}),
									onDuplicate: () => penDuplicate(),
									...(props.onProperties ? { onProperties: props.onProperties } : {}),
									onDelete: () => penDeleteSelected(),
									...(props.onPillMore ? { onMore: (anchor: DOMRect) => props.onPillMore?.({ ids: items().ids }, anchor) } : {}),
								}
							: {})}
					/>
				)}
			</Show>
			<Show when={lassoItems()}>
				{(held) => (
					<BoardCallout
						box={held().box}
						obstacles={() => pillObstacles(held().box)}
						label={`${held().ids.length} strokes: actions`}
						hidden={moving() || panning() || scaling() || gliding()}
						camera={ctl.settled()}
						view={view()}
						onOpen={() => pushCamera(frame([held().box]))}
						ink={{
							agent: props.inkAgent ?? "the agent",
							onDrawing: () => props.onInk?.({ action: "drawing", ids: held().ids, canvas: props.stageName ?? "", box: held().box }),
							onBoard: () => props.onInk?.({ action: "board", ids: held().ids, canvas: props.stageName ?? "", box: held().box }),
							onSend: () => props.onInk?.({ action: "send", ids: held().ids, canvas: props.stageName ?? "", box: held().box }),
						}}
						// The rest of a selection's pill, acting on the lasso's strokes instead of the editor's pick.
						{...(props.onComment
							? {
									onComment: () =>
										props.onComment?.({
											path: stagePenPath() ?? "the canvas",
											items: held().ids,
											quote: "",
											title: `${held().ids.length} ${held().ids.length === 1 ? "stroke" : "strokes"}`,
											anchor: () => document.querySelector(".stage > .board-callout")?.getBoundingClientRect(),
										}),
								}
							: {})}
						onDuplicate={() => {
							const { ops, made } = duplicateOps(scene, held().ids, freshIds());
							penEdit(ops);
							if (made.length) setInkSelection({ path: inkSelection()?.path ?? "stage", ids: made });
						}}
						{...(props.onPillMore ? { onMore: (anchor: DOMRect) => props.onPillMore?.({ ids: held().ids }, anchor) } : {})}
						onDelete={() => {
							penEdit(held().ids.map((id) => ({ op: "delete", id })));
							setInkSelection(undefined);
						}}
					/>
				)}
			</Show>
			<Show when={props.drawing && props.onPenEdit}>
				<StageInk
					camera={props.camera}
					view={view()}
					toStage={(event) => toWorld(ctl.now(), view(), stagePoint(event))}
					strokes={inkStrokes}
					layer={penLayer}
					onEdit={(ops) => penEdit(ops)}
					colourEdit={() => inkVariableEdit(props.pen?.doc)}
					newId={freshId}
					onShift={(ids, dx, dy) => penMoveBy(ids, dx, dy)}
					{...(props.onPenStep ? { onStep: props.onPenStep } : {})}
				/>
			</Show>
		</div>
	);
}
