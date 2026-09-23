import type { Board, Camera, ChatItem, WebStatus } from "@decks/protocol";
import X from "lucide-solid/icons/x";
import { Icon } from "../ui/icons.tsx";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
import type { AgentAct } from "./acts.ts";
import { between, boxOf, easeOutCubic, fitInto, INTERACT_ZOOM, pan, pinchCamera, toScreen, toWorld, zoomAbout, type Viewport } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { checkStageOrigin, stagePoint } from "../camera/coords.ts";
import { BoardFrame, type BoardEditing } from "../board/BoardFrame.tsx";
import type { EditorHost, Tool } from "../board/Editor.ts";
import type { FileDropHost } from "../board/file-drop.ts";
import type { FrameGestureHost } from "../board/frame-gestures.ts";
import { zoomKey } from "./zoom-keys.ts";
import { deckMode, type DeckHandle, type SlideAction, slideKey } from "../present/slide-keys.ts";
import { cssEscape } from "../board/inspect.ts";
import type { LiveWebReply } from "../board/live-chat.ts";
import { createEdgeSwipe } from "./edge-swipe.ts";
import { PALETTE } from "@decks/board-kit";
import { createTouches, type Finger, type TouchStep } from "./touch.ts";
import type { RendererChoice } from "../lib/renderer.ts";
import { createRedrawQueue } from "./redraw-queue.ts";
import { openThumbnails } from "./thumb-budget.ts";
import { createAdmission } from "./board-admission.ts";
import { createOneCanvas } from "./one-canvas.ts";
import { PenLayer, type PenHit, type PenPreview } from "./pen/layer.ts";
import { PEN_TOOL_KEYS, penSelection, penTool, setPenSelection, setPenTool, type PenTool } from "../state/pen-tools.ts";
import { scheme } from "../lib/theme.ts";
import { ARROW, arrowShape, ids as penIds, indexOf, newId, type PenDocument, type PenNode } from "@decks/pen";

/**
 * The palette's keys: `select`, then whatever `@decks/board-kit` says the palette offers.
 *
 * Written out here until the vocabulary had one home; the point of asking the manifest is
 * that a kind with a `key` cannot be missing from the keyboard, and a key cannot outlive
 * the kind it armed.
 */
const TOOL_KEYS: Record<string, Tool> = Object.fromEntries([
	["v", "select"] as const,
	...PALETTE.map((component) => [component.key, component.kind] as const),
]);

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
	 * Whether the app has opened — the deck and the chat you are looking at are drawn — so the
	 * boards may start. Until it is true no board has a document (`admitted` below).
	 */
	boardsMayStart: boolean;
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
	 * against (`canvas/pen/layer.ts`). Drawn under the boards, with the same camera.
	 */
	pen?: { doc: PenDocument; base: string };
	/**
	 * The person's edits to the drawing, as pen operations (`stage.pen.edit` on the wire). Absent
	 * means the drawing is read-only here. Edits are made in edit mode only, so browsing the canvas
	 * never picks a note up by accident.
	 */
	onPenEdit?: (ops: unknown[]) => void;
	/** Take back the person's last edit to the drawing, or put it back (`stage.pen.step`). */
	onPenStep?: (direction: "undo" | "redo") => void;
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
	/**
	 * The board being read on its own, if any — the canvas as a page rather than a map.
	 *
	 * One board, one column: no panning, the zoom free, and the wheel scrolling the document
	 * the way it would in any reader. The chrome is untouched, so everything beside the canvas
	 * still works — which is what makes this a *view* and not `Present`, an overlay that takes
	 * the window and is deliberately browse-only.
	 */
	focus?: string;
	/** Toggle it. The stage owns the key; the app owns which board and when. */
	onFocusToggle?: () => void;
	/** The same, named by a board: the button in its own title bar (`board/BoardFrame.tsx`). */
	onFocusBoard?: (path: string) => void;
	/** Take a deck fullscreen: the app owns the overlay, the stage only asks for it. */
	onPresent?: (path: string, at: number) => void;
	/** Open a flow or slides board as its own source. */
	onEditSource?: (path: string) => void;
	/** The document editor's own way in, from a button in the board's bar. */
	/** The board currently being edited as text, and how to finish. */
	editing?: { path: string; editing: BoardEditing };
	onSelect: (path: string | undefined) => void;
	onMove: (path: string, x: number, y: number) => void;
	/** The board dragged to a new size, in board units. The file is what changes. */
	onResize?: (path: string, size: { w: number; h: number }) => void;
	/**
	 * A double-click that landed on empty canvas, in stage pixels.
	 *
	 * The gesture that makes a board. Absent means the app does not want one, and nothing is
	 * asked of the server.
	 */
	onCreateBoard?: (at: { x: number; y: number }) => void;
	onHide?: (path: string) => void;
	/** Per-board reload counters, from `stage.reload`. */
	nonces?: Record<string, number>;
	cursor?: { path: string; x: number; y: number; label: string; color: string } | null;
	/** What each agent is doing to which board; each frame takes the acts on its board (`canvas/acts.ts`). */
	acts?: Record<string, AgentAct | undefined>;
	/** The boards that are news, by path, each with the colour its glow is drawn in (`board/glow.ts`). */
	news?: Record<string, string>;
	/** A board that was news was read on the canvas. */
	onRead?: (path: string) => void;
	/** Every agent's annotations, across all boards. Each frame takes the ones that are its. */
	marks?: import("./annotations.ts").Mark[];
	/** So the server can answer `stage.camera()` with what the user can see. */
	onViewport?: (viewport: Viewport) => void;
	/** How much room a board's content took, measured in its frame once it had mounted. */
	onExtent?: (path: string, extent: { rev: number; w: number; h: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void;
	editor: EditorHost;
	/** A tool picked by its key, which the palette's tooltips have always claimed. */
	onTool?: (tool: Tool) => void;
	/** A file dropped from the desktop onto a board, per board (`file-drop.ts`). */
	drops: (path: string) => FileDropHost;
	/** Which revision each frame is showing; see `selfEdited` in App. */
	frameRevs?: Record<string, number>;
	/** A conversation, for boards that are a live view of one (`live-chat.ts`). */
	transcript?: (agentId: string) => readonly ChatItem[] | undefined;
	/** Who an agent is, so a mirror can wear their colour. */
	agentIdentity?: (agentId: string) => { name: string; color: string } | undefined;
	/** What that agent is doing, in the sign's own words (`chat/working-sign.ts`). */
	working?: (agentId: string) => string | undefined;
	/** The shared Chrome's state, for its status card (`live-web.js`). */
	webStatus?: () => { status: WebStatus; code?: string } | undefined;
	/** Allow, Deny or Stop pressed on that card. */
	onWebReply?: (reply: LiveWebReply) => void;
	/**
	 * A link on a board pointing at another board — `true` once the deck has opened it.
	 *
	 * Handed straight through to the frame that asked (`BoardFrame`). `false` is a path this
	 * deck does not hold, which the app has already said in a notice.
	 */
	onOpenBoard?: (path: string, from: string) => boolean;
	/** A component on a board carrying code was pressed (`board/board-eval.ts`). */
	onBoardEval?: (path: string, id: string, value: unknown) => void;
	/** While previewing a past point: board path -> revision sha to render instead. */
	preview?: Record<string, string>;
	/**
	 * Leave the preview — Escape, read by the stage's own key handler.
	 *
	 * Here rather than on a window listener so it works with focus inside a board too:
	 * `frame-gestures.ts` forwards a board's keys to the same function. The amber outline
	 * on every board is what says the state is on; this is the way out of it.
	 */
	onLeavePreview?: () => void;
	/**
	 * Swipe in from an edge to open a panel, where there is no cursor to reach with.
	 *
	 * Here rather than in `App` because a board is an iframe: the only place a finger over
	 * a board and a finger over bare canvas look the same is the pool below
	 * (`edge-swipe.ts`).
	 */
	onEdgeSwipe?: { left: () => void; right: () => void; enabled: () => boolean };
}) {
	let element!: HTMLDivElement;
	let worldEl!: HTMLDivElement;
	let localCamera = props.camera;
	/** When the camera last moved, read by `board-admission.ts`. */
	let lastMoved = 0;
	let rafId: number | undefined;
	let pendingCamera: Camera | undefined;
	/*
	 * One glide at a time, and this is its identity.
	 *
	 * Anything that moves the camera itself — a wheel, a pinch, a drag, a key, an op — bumps the
	 * token, and the loop below stops the moment its token is not the current one. A camera the
	 * person is holding must never be argued with, and this counter is the whole of the mechanism
	 * that guarantees it.
	 */
	let glideToken = 0;
	let glideRaf: number | undefined;
	let lastGlideToken = -1;
	/**
	 * A glide the app has asked for and this file has not started yet.
	 *
	 * The camera signal and the glide request arrive in the same batch, and the boards are
	 * rendered from that batch **before** the effect below gets to start the loop — so for one
	 * pass "the camera has moved" is true and "the camera is moving" is not yet, and a board
	 * that the new camera brings into view would begin parsing its document exactly then, at
	 * the top of the flight. This closes that window: the request itself counts as movement.
	 */
	const glidePending = () => props.glide !== undefined && props.glide.token !== lastGlideToken;
	const [view, setView] = createSignal<Viewport>({ width: 0, height: 0 });
	/**
	 * A pan *gesture* is in flight — a finger down, a drag on bare canvas, space and a drag.
	 *
	 * The cursor's own state, and only that (`index.css`: `cursor: grabbing`). It is set on the
	 * press and cleared on the release, so it is true *before* the camera has moved and false the
	 * instant the hand stops. Nothing else reads it: the camera's own state is not something this
	 * signal can answer, because a wheel scroll pans the camera and presses nothing.
	 */
	const [panning, setPanning] = createSignal(false);
	/**
	 * Whether the camera's *scale* is changing right now, as opposed to its position.
	 *
	 * The two are not the same kind of work, and the difference is the whole reason this
	 * signal exists. Moving the world is a transform the compositor already holds pictures
	 * for, so a pan costs almost nothing however many boards are on the canvas. Scaling it
	 * asks every board's document to be drawn again at a size it has never been drawn at —
	 * and a board is an iframe, which is a whole document to redraw. Measured on twelve
	 * boards at 4× CPU throttle: 69ms of work per finger movement while panning, 134ms
	 * while pinching, and the gap grows with the number of boards in view.
	 *
	 * So while the scale is moving, the boards are put on layers of their own
	 * (`index.css`), which lets the compositor stretch the picture it already has instead
	 * of the main thread drawing a new one: 134ms → 56ms, with nothing to see at rest
	 * (measured: 0.2% of pixels differ, at the edges of letters). It is switched off again
	 * a moment after the gesture stops, because a layer is a texture held in memory and a
	 * canvas of them is not free.
	 */
	const [scaling, setScaling] = createSignal(false);
	let scaleSettle: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Whether the camera is moving at all — a pan as well as a zoom.
	 *
	 * `scaling` answers "is the picture the wrong size"; this answers "is the picture in
	 * motion", and the canvas renderers need the second one too. A pan repaints the page, so
	 * Chrome reports every drawable element as changed on every step, and a renderer that
	 * reads a `paint` event as "this document changed" redraws every board on every step of
	 * a pan for nothing. Same tail as the scale settle, for the same reason.
	 */
	const [moving, setMoving] = createSignal(false);
	let moveSettle: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Whether the camera is gliding right now — for the checks, not for the drawing.
	 *
	 * `data-panning` and `data-scaling` are the other two halves of "the camera is moving and this
	 * is what kind of work that is"; this is the third case, a move the app made on the reader's
	 * behalf, and a check has no other way to wait for it to arrive without sleeping.
	 */
	const [gliding, setGliding] = createSignal(false);
	const [spaceHeld, setSpaceHeld] = createSignal(false);

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

	onMount(() => {
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
				/*
				 * In the focus view these are the *page's*: the camera behind it is not on screen,
				 * and zooming something nobody can see is a keystroke that does nothing. Caught
				 * here, before the camera's branch, because `zoomKey` is checked first in this
				 * handler and would otherwise swallow them.
				 */
				if (props.focus) {
					if (zoom === "fit") fitFocus();
					else setFocusZoom((current) => Math.min(4, Math.max(0.1, current * (zoom === "in" ? 1.2 : 1 / 1.2))));
					event.preventDefault();
					return;
				}
				if (zoom === "fit") pushCamera(frame(props.boards.map(boxOf)));
				else pushCamera(zoomAbout(localCamera, view(), centre(), zoom === "in" ? 1.2 : 1 / 1.2));
				event.preventDefault();
				return;
			}
			const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
			if (typing) return;
			/*
			 * And an open editor owns the keyboard.
			 *
			 * A key pressed while the caret is in a board's document arrives here with the **frame** as
			 * its target, so `typing` above cannot see it — the editable element is in another
			 * document. `frame-gestures.ts` stops the ones it handles for a board's own field editor;
			 * the rich document editor has no such gate, and its canvas is a frame of its own.
			 *
			 * What that cost: the shortcuts here are bare letters, so typing a heading containing a `d`
			 * put the whole canvas into the focus view and threw the edit away — and every `v s c t e`
			 * picked a tool. While something is being edited, none of it is a shortcut.
			 */
			if (props.editing) return;
			/*
			 * The drawing's own keys, in edit mode. None of them fire while a text box has the caret
			 * (above). Delete, the arrows and ⌘D act on what is selected; ⌘Z and ⇧⌘Z step through the
			 * person's own edits; Escape lets go, then puts the tool down; a letter arms a tool
			 * (`PEN_TOOL_KEYS`), from this document only.
			 */
			if (props.mode === "edit" && props.onPenEdit && penKey(event)) {
				event.preventDefault();
				return;
			}
			/*
			 * The view's own two keys, and deliberately *not* in `shortcut`: a board's keys are
			 * forwarded there (`frame-gestures.ts`), so a `d` in that table would be a `d` typed
			 * at whatever board happens to have the focus. These fire only when the keystroke
			 * arrived in the app's own document.
			 */
			if (props.onFocusToggle) {
				if (event.key === "Escape" && props.focus) {
					event.preventDefault();
					props.onFocusToggle();
					return;
				}
				if (event.key === "d" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
					event.preventDefault();
					props.onFocusToggle();
					return;
				}
			}
			/*
			 * A **focused** deck takes the arrows, and an unfocused one takes nothing.
			 *
			 * Clicking a board is the ask. Without that a deck parked in the corner of the
			 * canvas would swallow every arrow key meant for something else — and there is
			 * no conflict to arbitrate with the editor's own nudge, because that only fires
			 * when a component is selected and a deck has no components.
			 */
			const slide = slideKey(event, "focused");
			if (slide && drive(props.selected, slide)) {
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
	 * The slide handle inside a deck board's frame, if that board is a deck and has loaded.
	 *
	 * Found by query rather than by a registry the frames push into. The frames are
	 * same-origin by design (§4) and `Editor.ts` already reaches into their documents, so
	 * this adds no new coupling — and a registry would need every frame to remember to
	 * deregister, which is a lifetime bug waiting for the first board that unmounts
	 * mid-turn.
	 */
	const deckIn = (path: string): DeckHandle | undefined => {
		// By the frame's own path rather than its box: under the one-canvas renderer a
		// document lives in the stage's darkroom, not in the board node.
		const node = element?.querySelector(`iframe[data-path="${cssEscape(path)}"]`) as HTMLIFrameElement | null;
		return (node?.contentWindow as { __deck?: DeckHandle } | null)?.__deck;
	};

	/** Act on a deck, and say whether there was one to act on. */
	const drive = (path: string | undefined, action: SlideAction): boolean => {
		if (!path) return false;
		const board = props.boards.find((candidate) => candidate.path === path);
		if (!board) return false;
		/*
		 * Fullscreen is for any board; the four paging verbs are for a deck.
		 *
		 * The gate was on both, which is why fullscreen existed only for slides: it was a
		 * property of `Present.tsx`, which is an overlay and a second frame and knows nothing
		 * about slides (`present/Present.tsx`). A document wants the window; a component board
		 * wants its own rectangle at 1:1.
		 */
		if (action === "present") {
			// A live board is a view of something the app is already showing; there is no
			// second frame of it that says anything new.
			if (board.live) return false;
			props.onPresent?.(path, board.format === "slides" ? (deckIn(path)?.current() ?? 0) : 0);
			return true;
		}
		if (board.format !== "slides") return false;
		const deck = deckIn(path);
		if (!deck) return false;
		if (action === "next") deck.next();
		else if (action === "prev") deck.prev();
		else if (action === "first") deck.first();
		else if (action === "last") deck.last();
		return true;
	};

	/*
	 * One slide, or the whole deck's shape.
	 *
	 * Driven from here because the *canvas* knows the zoom and a board does not: a document
	 * inside a scaled frame cannot tell how large it is being drawn. The threshold is the
	 * one the canvas already uses for pointer events, so the sheet appears exactly where a
	 * deck stops being pageable.
	 */
	// A memo, so the frames are only asked when the answer changes — not on every frame
	// of a gesture, which is how often the camera does.
	const decksMode = createMemo(() => deckMode(props.camera.zoom, INTERACT_ZOOM));
	createEffect(() => {
		const mode = decksMode();
		for (const board of props.boards) {
			if (board.format !== "slides") continue;
			deckIn(board.path)?.setMode(mode);
		}
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

	/**
	 * The air a focused page keeps around it, in stage pixels.
	 *
	 * Stage pixels and not board ones, because it is the *window* being measured: a margin that
	 * scaled with the page would vanish as you zoomed out and eat the width as you zoomed in.
	 */
	const FOCUS_AIR = 32;

	const centre = () => ({ x: view().width / 2, y: view().height / 2 });

	/*
	 * The drawing under the boards (`canvas/pen/layer.ts`). The camera reaches it through
	 * `writeTransform`; the document, the window's size and the colour scheme through these.
	 */
	const penLayer = new PenLayer();
	onCleanup(() => penLayer.dispose());
	createEffect(() => penLayer.setView(view()));
	createEffect(() => penLayer.setScheme(scheme()));
	createEffect(() => penLayer.setDoc(props.pen?.doc, props.pen?.base ?? ""));
	createEffect(() => penLayer.setBoards(props.boards));

	/*
	 * Editing the drawing by hand, in edit mode (`state/pen-tools.ts` holds the tool and the
	 * selection, `pen/PenBar.tsx` shows them). Every change is sent as the same pen operation an
	 * agent would send, and the drawing redraws from the server's answer; until it arrives, a drag
	 * or a resize is drawn as a preview.
	 */
	const [penDrag, setPenDrag] = createSignal({ dx: 0, dy: 0 });
	const [penResize, setPenResize] = createSignal<{ id: string; x: number; y: number; w: number; h: number } | undefined>();
	const [penMarquee, setPenMarquee] = createSignal<{ x1: number; y1: number; x2: number; y2: number } | undefined>();
	const [penDraft, setPenDraft] = createSignal<{ tool: PenTool; x1: number; y1: number; x2: number; y2: number } | undefined>();
	const [penText, setPenText] = createSignal<{ id: string; box: { x: number; y: number; w: number; h: number }; value: string; card: boolean; fontSize: number; fill: string; fresh?: boolean } | undefined>();
	const [penDrawn, setPenDrawn] = createSignal(0);
	/** When a tool last made an item, so the second press of a double-click does not make a board. */
	let penMadeAt = 0;
	penLayer.drawn = () => {
		/*
		 * The answer to a drag has been drawn: the layout is where the drag left things, so the offset
		 * goes. Not when the answer *arrives* — the layout is only redone on the next frame, and for
		 * that frame the outline sat on the old layout with no offset, back where the drag began.
		 */
		if (penLayer.drawnDoc === props.pen?.doc) {
			setPenDrag({ dx: 0, dy: 0 });
			setPenResize(undefined);
		}
		setPenDrawn((n) => n + 1);
	};
	/** Items made or copied here that the server has not answered with yet: selected, and not let go. */
	const penAwaited = new Set<string>();
	createEffect(() => {
		// A selection of items the drawing no longer has is let go, whoever took them away.
		const doc = props.pen?.doc;
		const present = doc ? penIds(doc) : new Set<string>();
		for (const id of penAwaited) if (present.has(id)) penAwaited.delete(id);
		const selected = untrack(penSelection);
		const kept = selected.filter((id) => present.has(id) || penAwaited.has(id));
		if (kept.length !== selected.length) setPenSelection(kept);
	});
	/** Select what was just asked for, which the drawing does not have until the server answers. */
	const selectMade = (made: string[]) => {
		for (const id of made) penAwaited.add(id);
		setPenSelection(made);
	};
	createEffect(() => {
		if (props.mode !== "edit") {
			setPenSelection([]);
			setPenText(undefined);
			setPenTool("select");
		}
	});
	/** Where each selected item is now, moved by any drag and sized by any resize in progress. */
	const penOutlines = createMemo(() => {
		penDrawn();
		const drag = penDrag();
		const resize = penResize();
		const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
		for (const id of penSelection()) {
			if (resize?.id === id) {
				out.push(resize);
				continue;
			}
			const box = penLayer.bounds.get(id);
			if (box) out.push({ id, x: box.x + drag.dx, y: box.y + drag.dy, w: box.w, h: box.h });
		}
		const marquee = penMarquee();
		if (marquee) out.push({ id: "", x: Math.min(marquee.x1, marquee.x2), y: Math.min(marquee.y1, marquee.y2), w: Math.abs(marquee.x2 - marquee.x1), h: Math.abs(marquee.y2 - marquee.y1) });
		return out;
	});
	/** One item selected, and not a joined arrow (which the server redraws) or a group: it gets handles. */
	const penHandles = createMemo(() => {
		const outlines = penOutlines();
		if (outlines.length !== 1 || !outlines[0]!.id) return undefined;
		const node = penLayer.placed.get(outlines[0]!.id)?.node;
		// A group is as big as what is in it, and pen does not scale children, so it moves but is not sized.
		if (!node || node.metadata?.type === ARROW || node.type === "group") return undefined;
		return outlines[0]!;
	});
	const TEXTY = new Set(["text", "note", "prompt", "context"]);
	const openPenText = (hit: PenHit, fresh?: boolean) => {
		const node = hit.node;
		const card = node.type !== "text";
		const size = typeof node.fontSize === "number" ? node.fontSize : 14;
		const fill = card && typeof node.fill === "string" && node.fill.startsWith("#") ? node.fill : card ? "#fde68a" : "transparent";
		setPenText({ id: hit.id, box: hit.box, value: typeof node.content === "string" ? node.content : "", card, fontSize: size, fill, ...(fresh ? { fresh } : {}) });
	};
	const commitPenText = (value: string) => {
		const open = penText();
		setPenText(undefined);
		if (!open || !props.onPenEdit) return;
		// A text or note made by a tool and left empty was never wanted.
		if (open.fresh && !value.trim()) return props.onPenEdit([{ op: "delete", id: open.id }]);
		const was = penLayer.placed.get(open.id)?.node.content;
		if (value !== was) props.onPenEdit([{ op: "update", id: open.id, set: { content: value } }]);
	};
	/** A press on a drawn item's click shape (`pen/layer.ts`), which is over the boards. */
	const onDrawn = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".pen-hits");
	/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
	const onCanvas = (target: EventTarget | null) => target === element || onDrawn(target);
	const penEdit = (ops: unknown[]) => {
		if (ops.length) props.onPenEdit?.(ops);
	};
	const worldAt = (event: { clientX: number; clientY: number }) => toWorld(localCamera, view(), stagePoint(event as PointerEvent));
	const freshId = () => newId(props.pen ? penIds(props.pen.doc) : new Set());

	/** The keys of the drawing, in edit mode; true when the key was one of them. */
	const penKey = (event: KeyboardEvent): boolean => {
		const selected = penSelection();
		const command = event.metaKey || event.ctrlKey;
		const key = event.key;
		if (command && !event.altKey && key.toLowerCase() === "z" && props.onPenStep) {
			props.onPenStep(event.shiftKey ? "redo" : "undo");
			return true;
		}
		if (selected.length && (key === "Delete" || key === "Backspace")) {
			penEdit(selected.map((id) => ({ op: "delete", id })));
			setPenSelection([]);
			return true;
		}
		if (key === "Escape" && (selected.length || penTool() !== "select")) {
			if (penTool() !== "select") setPenTool("select");
			else setPenSelection([]);
			return true;
		}
		if (selected.length && command && !event.altKey && key.toLowerCase() === "d") {
			penDuplicate();
			return true;
		}
		const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
		if (selected.length && nudge && !command && !event.altKey) {
			const step = event.shiftKey ? 10 : 1;
			penMoveBy(selected, nudge[0]! * step, nudge[1]! * step);
			return true;
		}
		/*
		 * The letters that arm a tool: from the app's own document only — never forwarded from a
		 * board's (`shortcut`) — and only while no board is selected. Words typed over a board with
		 * nothing editable under them fall through to the stage, and an armed tool takes the boards'
		 * pointer away: "Zoo" typed there armed the ellipse, and the next click drew one instead of
		 * selecting what was under it. With a board selected the keys are the board's; a press on
		 * bare canvas lets it go, and then they are the drawing's.
		 */
		const tool = !command && !event.altKey && !props.selected ? PEN_TOOL_KEYS[key] : undefined;
		if (tool) {
			armPenTool(tool);
			return true;
		}
		return false;
	};

	const armPenTool = (tool: PenTool) => {
		// The board palette's tool goes down first: picking one of its tools puts this one down.
		if (tool !== "select") props.onTool?.("select");
		setPenTool(tool);
	};

	/** An item as the file has it, not as a preview has drawn it. */
	const penNode = (id: string) => (props.pen ? indexOf(props.pen.doc).get(id)?.node : undefined);
	const own = (value: unknown) => (typeof value === "number" ? value : 0);

	/**
	 * Move items by `dx dy`: a shift of their own `x` and `y`. A shift rather than a new corner,
	 * because a group's box starts where its children do, not at its own `x` and `y`.
	 */
	const penMoveBy = (idsToMove: readonly string[], dx: number, dy: number) => {
		penEdit(
			idsToMove.flatMap((id) => {
				const node = penNode(id);
				return node ? [{ op: "update", id, set: { x: Math.round(own(node.x) + dx), y: Math.round(own(node.y) + dy) } }] : [];
			}),
		);
	};

	const penDuplicate = () => {
		const taken = props.pen ? penIds(props.pen.doc) : new Set<string>();
		const made: string[] = [];
		const ops = penSelection().flatMap((id) => {
			const node = penNode(id);
			if (!node) return [];
			const as = newId(taken);
			taken.add(as);
			made.push(as);
			return [{ op: "copy", id, as }, { op: "update", id: as, set: { x: own(node.x) + 24, y: own(node.y) + 24 } }];
		});
		penEdit(ops);
		if (made.length) selectMade(made);
	};

	/** Follow one press to its release: `move` on each step past a 3px slop, `done` at the end. */
	const follow = (event: PointerEvent, move: (e: PointerEvent) => void, done: (moved: boolean, e: PointerEvent) => void) => {
		element.setPointerCapture(event.pointerId);
		const start = { x: event.clientX, y: event.clientY };
		let moved = false;
		const onMove = (e: PointerEvent) => {
			if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
			moved = true;
			move(e);
		};
		const finish = (e: PointerEvent) => {
			element.removeEventListener("pointermove", onMove);
			element.removeEventListener("pointerup", finish);
			element.removeEventListener("pointercancel", finish);
			done(moved, e);
		};
		element.addEventListener("pointermove", onMove);
		element.addEventListener("pointerup", finish);
		element.addEventListener("pointercancel", finish);
	};

	/** A press on the drawing in edit mode; true when it was the drawing's to handle. */
	const penPress = (event: PointerEvent): boolean => {
		const at = worldAt(event);
		const tool = penTool();
		if (tool !== "select") {
			event.preventDefault();
			props.onSelect(undefined);
			penCreate(event, tool, at);
			return true;
		}
		// The group under the point, unless a double-click already selected the thing inside it.
		const inner = penLayer.hitTest(at, { deep: true });
		const hit = inner && penSelection().includes(inner.id) ? inner : penLayer.hitTest(at);
		if (hit) {
			event.preventDefault();
			props.onSelect(undefined);
			const selected = penSelection();
			if (event.shiftKey) {
				setPenSelection(selected.includes(hit.id) ? selected.filter((id) => id !== hit.id) : [...selected, hit.id]);
				return true;
			}
			const moving = selected.includes(hit.id) ? selected : [hit.id];
			setPenSelection(moving);
			let offset = { dx: 0, dy: 0 };
			follow(
				event,
				(e) => {
					offset = { dx: (e.clientX - event.clientX) / localCamera.zoom, dy: (e.clientY - event.clientY) / localCamera.zoom };
					setPenDrag(offset);
					penLayer.preview(new Map(moving.map((id) => [id, offset])));
				},
				(moved) => {
					if (moved) penMoveBy(moving, offset.dx, offset.dy);
				},
			);
			return true;
		}
		if (event.shiftKey) {
			event.preventDefault();
			props.onSelect(undefined);
			setPenMarquee({ x1: at.x, y1: at.y, x2: at.x, y2: at.y });
			follow(
				event,
				(e) => {
					const now = worldAt(e);
					setPenMarquee({ x1: at.x, y1: at.y, x2: now.x, y2: now.y });
				},
				() => {
					const m = penMarquee();
					setPenMarquee(undefined);
					if (!m) return;
					const picked = penLayer.within({ x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2), w: Math.abs(m.x2 - m.x1), h: Math.abs(m.y2 - m.y1) });
					setPenSelection([...new Set([...penSelection(), ...picked])]);
				},
			);
			return true;
		}
		setPenSelection([]);
		return false;
	};

	/** The eight handles round a single selection, by the edges each one moves. */
	const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
	const resizeFrom = (event: PointerEvent, handle: (typeof HANDLES)[number]) => {
		const box = penHandles();
		if (event.button !== 0 || !box) return;
		event.preventDefault();
		event.stopPropagation();
		const { id } = box;
		const start = { x: box.x, y: box.y, w: box.w, h: box.h };
		/*
		 * The handles are on what the item draws; the file sizes the box it was given. For most items
		 * they are the same box. For a path drawn in a corner of its viewBox they are not, and the
		 * given box is scaled by as much as the drawn one, about the same point.
		 */
		const given = penLayer.placed.get(id)?.box ?? start;
		const givenFor = (drawn: { x: number; y: number; w: number; h: number }) => {
			const sx = start.w > 0 ? drawn.w / start.w : 1;
			const sy = start.h > 0 ? drawn.h / start.h : 1;
			return { x: drawn.x - (start.x - given.x) * sx, y: drawn.y - (start.y - given.y) * sy, w: given.w * sx, h: given.h * sy };
		};
		let next = start;
		follow(
			event,
			(e) => {
				const dx = (e.clientX - event.clientX) / localCamera.zoom;
				const dy = (e.clientY - event.clientY) / localCamera.zoom;
				let x1 = start.x + (handle.includes("w") ? dx : 0);
				let x2 = start.x + start.w + (handle.includes("e") ? dx : 0);
				let y1 = start.y + (handle.includes("n") ? dy : 0);
				let y2 = start.y + start.h + (handle.includes("s") ? dy : 0);
				// Shift keeps the shape: the wider of the two changes sets both.
				if (e.shiftKey && handle.length === 2 && start.w > 0 && start.h > 0) {
					const scale = Math.max((x2 - x1) / start.w, (y2 - y1) / start.h);
					if (handle.includes("w")) x1 = x2 - start.w * scale;
					else x2 = x1 + start.w * scale;
					if (handle.includes("n")) y1 = y2 - start.h * scale;
					else y2 = y1 + start.h * scale;
				}
				next = { x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)), w: Math.max(4, Math.round(Math.abs(x2 - x1))), h: Math.max(4, Math.round(Math.abs(y2 - y1))) };
				setPenResize({ id, ...next });
				const box = givenFor(next);
				penLayer.preview(new Map<string, PenPreview>([[id, { dx: box.x - given.x, dy: box.y - given.y, w: box.w, h: box.h }]]));
			},
			(moved) => {
				if (!moved) return;
				const box = givenFor(next);
				const r = (n: number) => Math.round(n * 10) / 10;
				penEdit([{ op: "update", id, box: { x1: r(box.x), y1: r(box.y), x2: r(box.x + box.w), y2: r(box.y + box.h) } }]);
			},
		);
	};

	/** What each tool makes, before its box: pen's own items, with nothing of ours in them. */
	const MADE: Record<Exclude<PenTool, "select" | "arrow">, { node: Partial<PenNode> & { type: string }; w: number; h: number }> = {
		rectangle: { node: { type: "rectangle", fill: "#dbe4f0", cornerRadius: 8 }, w: 160, h: 100 },
		ellipse: { node: { type: "ellipse", fill: "#c7ddf7" }, w: 120, h: 120 },
		frame: { node: { type: "frame", name: "Frame", layout: "none", fill: "#ffffff", stroke: "#d0d7de", strokeWidth: 1, cornerRadius: 12, clip: true }, w: 400, h: 300 },
		text: { node: { type: "text", content: "", fontSize: 24 }, w: 240, h: 32 },
		note: { node: { type: "note", content: "" }, w: 240, h: 80 },
	};

	/** The board under a stage point, when there is one: an arrow may start or end on it. */
	const boardAt = (point: { x: number; y: number }) =>
		props.boards.findLast((b) => point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h)?.path;

	/** The innermost free-standing frame under a point: an item drawn inside one belongs to it. */
	const frameAt = (point: { x: number; y: number }) => {
		let best: { id: string; order: number } | undefined;
		for (const placed of penLayer.placed.values()) {
			const { node, box } = placed;
			if (node.type !== "frame" || node.id.includes("/") || node.layout !== "none") continue;
			if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			if (!best || placed.order > best.order) best = { id: node.id, order: placed.order };
		}
		return best?.id;
	};

	const penCreate = (event: PointerEvent, tool: Exclude<PenTool, "select">, at: { x: number; y: number }) => {
		setPenDraft({ tool, x1: at.x, y1: at.y, x2: at.x, y2: at.y });
		follow(
			event,
			(e) => {
				const now = worldAt(e);
				setPenDraft({ tool, x1: at.x, y1: at.y, x2: now.x, y2: now.y });
			},
			(moved, e) => {
				setPenDraft(undefined);
				setPenTool("select");
				penMadeAt = performance.now();
				const end = worldAt(e);
				const id = freshId();
				if (tool === "arrow") {
					// Joined when both ends are on something, so it follows them; a free arrow otherwise.
					const endOf = (point: { x: number; y: number }) => penLayer.hitTest(point)?.id ?? boardAt(point);
					const from = endOf(at);
					const to = endOf(end);
					if (from && to && from !== to) {
						penEdit([{ op: "insert", node: { type: "path", id, metadata: { type: ARROW, from, to } } }]);
					} else if (moved) {
						const shape = arrowShape([[at.x, at.y], [end.x, end.y]], 2);
						penEdit([{ op: "insert", node: { type: "path", id, ...shape, stroke: "#8a8f98", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } }]);
					} else return;
					selectMade([id]);
					return;
				}
				const made = MADE[tool];
				const x1 = Math.round(moved ? Math.min(at.x, end.x) : at.x);
				const y1 = Math.round(moved ? Math.min(at.y, end.y) : at.y);
				const w = moved ? Math.max(8, Math.round(Math.abs(end.x - at.x))) : made.w;
				const h = moved ? Math.max(8, Math.round(Math.abs(end.y - at.y))) : made.h;
				const parent = frameAt(at);
				// A text grows with its words unless a width was drawn for it; its height is always its words'.
				const box = tool === "text" ? (moved ? { x1, y1, x2: x1 + w } : { x1, y1 }) : tool === "note" && !moved ? { x1, y1 } : { x1, y1, x2: x1 + w, y2: y1 + h };
				penEdit([{ op: "insert", ...(parent ? { parent } : {}), node: { ...made.node, id }, box }]);
				selectMade([id]);
				if (tool === "text" || tool === "note") openPenText({ id, node: { ...made.node, id } as PenNode, box: { x: x1, y: y1, w, h } }, true);
			},
		);
	};

	const writeTransform = (cam: Camera) => {
		const v = view();
		worldEl.style.transform = `translate(${v.width / 2}px, ${v.height / 2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
		oneCanvas.requestPicture();
		// The drawing moves in the same call as the boards, so the two can never be a frame apart.
		penLayer.setCamera(cam);
	};

	/**
	 * Say the scale is moving, and arrange to notice when it stops.
	 *
	 * The tail matters: a pinch delivers its steps as separate events with nothing to mark
	 * the end of the *scaling* in particular, and dropping the layers between two frames of
	 * one gesture would pay for them twice. 300ms is longer than any gap inside a gesture
	 * and shorter than anyone would notice holding.
	 */
	const nowMoving = () => {
		if (!moving()) setMoving(true);
		clearTimeout(moveSettle);
		moveSettle = setTimeout(() => setMoving(false), 160);
	};
	onCleanup(() => clearTimeout(moveSettle));

	const nowScaling = () => {
		if (!scaling()) setScaling(true);
		clearTimeout(scaleSettle);
		scaleSettle = setTimeout(() => setScaling(false), 300);
	};
	onCleanup(() => clearTimeout(scaleSettle));



	/**
	 * The focus view: one board, as a page.
	 *
	 * Not a camera trick — the canvas is *not rendered* while this is on, and this is a
	 * separate view with its own scroll box and its own zoom (the `.focus` box below). So the
	 * zoom lives here, because the stage is what owns the frame's wiring and the gesture host
	 * the view's frame reports to.
	 */
	const [focusZoom, setFocusZoom] = createSignal(1);
	let focusEl: HTMLDivElement | undefined;
	const focused = () => props.boards.find((candidate) => candidate.path === props.focus);

	/** The page width filled to the window, never blown up past its own size. */
	const fitFocus = () => {
		const board = focused();
		if (!board) return;
		const width = Math.max(120, view().width - FOCUS_AIR * 2);
		setFocusZoom(Math.min(1, width / board.w));
	};

	/*
	 * Fit on entering, and again when the window changes shape — in this view the window *is*
	 * the page's width. `untrack` around the lookup: boards move and change (an agent writes
	 * one, an extent arrives), and a zoom that jumped every time one did would be worse than no
	 * view at all. What this follows is the view being entered and the window resizing.
	 */
	createEffect(() => {
		if (!props.focus) return;
		const width = view().width;
		if (!width) return;
		untrack(fitFocus);
	});

	/**
	 * Move the camera now: the body `pushCamera` has always been, given the name it deserves.
	 *
	 * A glide is **not a second way to move the camera**. It is a loop that calls this, which is why
	 * an arrival gets everything a finger already had for free: the scale settle (a zooming glide
	 * sets it for its duration, so the boards are redrawn once, at the end), the `lastMoved` stamp
	 * board admission reads, and the camera signal going up once per frame, so the zoom readout
	 * ticks and `camera()` is never a lie about where the view is going.
	 */
	const writeCamera = (cam: Camera) => {
		if (cam.zoom !== localCamera.zoom) nowScaling();
		if (cam.x !== localCamera.x || cam.y !== localCamera.y || cam.zoom !== localCamera.zoom) nowMoving();
		lastMoved = performance.now();
		localCamera = cam;
		writeTransform(cam);
		pendingCamera = cam;
		if (rafId === undefined) {
			rafId = requestAnimationFrame(() => {
				rafId = undefined;
				props.setCamera(pendingCamera!);
				pendingCamera = undefined;
			});
		}
	};

	const cancelGlide = () => {
		glideToken++;
		if (glideRaf !== undefined) {
			cancelAnimationFrame(glideRaf);
			glideRaf = undefined;
		}
		setGliding(false);
	};

	/** A gesture, and the hand wins: it ends any glide before writing its own camera. */
	const pushCamera = (cam: Camera) => {
		cancelGlide();
		writeCamera(cam);
	};

	/**
	 * Arrive at `to` over `ms`, from wherever the camera is *now*.
	 *
	 * From the pixels rather than from the previous target, so two moves in a row read as a change
	 * of mind rather than as the view travelling backwards to a place it never went. The last frame
	 * writes `to` itself, not `between(from, to, 1)` — see the note on `between` about what `a +
	 * (b - a) * 1` does to a fit.
	 */
	const glideTo = (to: Camera, ms: number) => {
		const from = localCamera;
		if (from.x === to.x && from.y === to.y && from.zoom === to.zoom) {
			writeCamera(to);
			return;
		}
		const mine = ++glideToken;
		const at = performance.now();
		setGliding(true);
		/*
		 * `performance.now()`, not the timestamp `requestAnimationFrame` hands the callback.
		 *
		 * They are different clocks, and `at` above is a `performance.now()`. The frame's own
		 * timestamp is when the frame *started*, which is routinely **before** the moment the press
		 * that started this glide was handled — a press arrives during a frame. So `now - at` came out
		 * negative on the first frame, the number was clamped to zero, and the move spent its first
		 * frames re-drawing where it already was: on a loaded machine that cost 20% of the travel,
		 * measured — the camera sat at the start for 50ms and then finished late. It was invisible in
		 * a frame-by-frame assertion, which is happy to see *some* intermediate value, and obvious in
		 * a chart of the curve the samples were supposed to be on.
		 */
		const step = () => {
			if (mine !== glideToken) return;
			const t = Math.min(1, (performance.now() - at) / ms);
			writeCamera(t >= 1 ? to : between(from, to, easeOutCubic(t)));
			if (t >= 1) {
				glideRaf = undefined;
				setGliding(false);
				return;
			}
			glideRaf = requestAnimationFrame(step);
		};
		glideRaf = requestAnimationFrame(step);
	};

	/*
	 * Sync from external camera changes (a fit, an op, the opening view, a glide the app asked for)
	 * and from viewport resizes.
	 *
	 * `localCamera` is what the pixels say, and it is deliberately **not** reactive: the test below
	 * is "has somebody else moved the camera", and a glide's own frames write both it and the signal
	 * the app holds. An effect that cancelled on every incoming change would therefore cancel the
	 * glide with it — so a change that matches the pixels is one of ours, and not news.
	 */
	createEffect(() => {
		const target = props.camera;
		const asked = props.glide;
		view(); // a resize re-frames without moving the camera
		const moved = target.x !== localCamera.x || target.y !== localCamera.y || target.zoom !== localCamera.zoom;
		const fresh = asked !== undefined && asked.token !== lastGlideToken;
		if (fresh) lastGlideToken = asked.token;
		if (fresh && moved && asked.ms > 0) {
			glideTo(target, asked.ms);
			return;
		}
		if (moved) {
			cancelGlide();
			localCamera = target;
		}
		writeTransform(target);
	});

	onCleanup(() => {
		if (rafId !== undefined) cancelAnimationFrame(rafId);
		if (glideRaf !== undefined) cancelAnimationFrame(glideRaf);
	});

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
		 * Escape leaves the preview, and it is first because it is the way *out* of a state
		 * that has taken everything else away: while a preview is up every frame is inert, so
		 * none of the keys below can be reached from inside a board anyway.
		 *
		 * Here rather than on the window, so it works with focus inside a board too —
		 * `frame-gestures.ts` forwards a board's keys to this same function, which is the
		 * whole reason the camera's keys live here rather than in the components that own
		 * them.
		 */
		if (key === "Escape" && props.preview && props.onLeavePreview) {
			props.onLeavePreview();
			return true;
		}
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
		/*
		 * In the focus view the zoom keys are the page's: the camera behind it is not on screen
		 * and moving it would be a change nobody could see. `0` is the same word it is on the
		 * canvas — fit — which for a page means its width.
		 */
		if (props.focus) {
			if (key === "0") {
				fitFocus();
				return true;
			}
			if (key === "+" || key === "=") {
				setFocusZoom((zoom) => Math.min(4, zoom * 1.2));
				return true;
			}
			if (key === "-") {
				setFocusZoom((zoom) => Math.max(0.1, zoom / 1.2));
				return true;
			}
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
				pushCamera(zoomAbout(localCamera, view(), centre(), 1.2));
				return true;
			case "-":
				pushCamera(zoomAbout(localCamera, view(), centre(), 1 / 1.2));
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
	const wheel = (gesture: { x: number; y: number; deltaX: number; deltaY: number; zooming: boolean }) => {
		/*
		 * A wheel over the page is the page's, in both senses.
		 *
		 * The frame is a scaled document inside a scroll box, so the browser will not scroll it
		 * for us — the same reason `frame-gestures.ts` scrolls a box inside a board by hand —
		 * and the camera behind this view is not on screen to be panned. So the delta goes to the
		 * box, and ⌘-wheel to the page's own zoom.
		 */
		if (props.focus) {
			if (gesture.zooming) {
				const factor = Math.min(1.2, Math.max(1 / 1.2, Math.exp(-gesture.deltaY / 120)));
				setFocusZoom((zoom) => Math.min(4, Math.max(0.1, zoom * factor)));
			} else if (focusEl) {
				focusEl.scrollTop += gesture.deltaY;
			}
			return;
		}
		if (gesture.zooming) {
			/*
			 * A pinch arrives as a stream of small deltas and a ⌘-wheel notch as one
			 * delta of 100 or more, so the exponential is clamped: without it, the
			 * pinch is right and one notch of the wheel jumps 2.7x.
			 *
			 * The divisor is how far a finger has to travel for a given zoom, and it is the
			 * pinch's alone: a wheel notch is past the clamp at any of these numbers, so
			 * changing it moves the trackpad and leaves the mouse where it was. It has been
			 * turned twice, both times because a Mac trackpad felt slow — 300 barely doubled
			 * the zoom across a whole pinch, 200 was still short. At 120 that pinch is about
			 * 3.8×, which is the neighbourhood the Mac's own apps zoom in.
			 */
			const factor = Math.min(1.3, Math.max(1 / 1.3, Math.exp(-gesture.deltaY / 120)));
			pushCamera(zoomAbout(localCamera, view(), { x: gesture.x, y: gesture.y }, factor));
			return;
		}
		pushCamera(pan(localCamera, -gesture.deltaX, -gesture.deltaY));
	};

	const onWheel = (event: WheelEvent) => {
		event.preventDefault();
		const at = local(event);
		// `ctrlKey` is a trackpad pinch, not a key anybody pressed; `metaKey` is the
		// deliberate mouse-wheel zoom. Everything else is a two-finger scroll.
		wheel({ x: at.x, y: at.y, deltaX: event.deltaX, deltaY: event.deltaY, zooming: event.ctrlKey || event.metaKey });
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
	const edges = createEdgeSwipe({
		width: () => view().width,
		enabled: () => props.onEdgeSwipe?.enabled() ?? false,
		openLeft: () => props.onEdgeSwipe?.left(),
		openRight: () => props.onEdgeSwipe?.right(),
	});
	/** Fingers this document is carrying, as opposed to ones reported from a frame. */
	const carried = new Set<number>();

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
			touches.down(finger);
			// After `touches.down`, so the count includes this finger: one is a drawer, two
			// are a pinch.
			edges.down(finger, touches.count());
			setPanning(true);
			return { kind: "idle" };
		}
		if (phase === "up") {
			touches.up(finger.id);
			claimed.delete(finger.id);
			edges.up(finger.id);
			if (touches.count() === 0) setPanning(false);
			return { kind: "idle" };
		}

		/*
		 * The drawer gets first refusal, and holds the finger while it is undecided.
		 *
		 * A pan that begins in the outermost 28px does not move the camera until the
		 * gesture has said which of the two it is — 44px of lurch before a panel appears
		 * is worse than 44px of a pan that starts late, and the panel is the rarer of the
		 * two so it is the one that has to be unmistakable.
		 */
		const drawer = edges.move(finger);

		const step = touches.move(finger);
		/*
		 * In the focus view the fingers belong to the page, as the wheel does: the camera
		 * behind it is not on screen, and a pinch that zoomed it left the page exactly as it
		 * was, which is what "touch zoom does nothing on a phone" was. Two fingers scale the
		 * page about their midpoint, one finger scrolls it, both ways: on a phone a zoomed
		 * page is wider than the box and the box scrolls sideways there (`canvas.css`).
		 */
		if (props.focus) {
			if (step.kind === "pinch") {
				claimed.clear();
				edges.cancel();
				const span = (pair: [Finger, Finger]) => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
				const from = span(step.from);
				const factor = from > 0 ? span(step.to) / from : 1;
				const box = focusEl;
				const before = focusZoom();
				const after = Math.min(4, Math.max(0.1, before * factor));
				setFocusZoom(after);
				if (box) {
					const midY = (step.to[0].y + step.to[1].y) / 2;
					const midX = (step.to[0].x + step.to[1].x) / 2;
					box.scrollTop = (box.scrollTop + midY) * (after / before) - midY;
					// Sideways only matters once the page is wider than the box (a phone, zoomed
					// in); a centred page has no horizontal scroll and this is a no-op.
					box.scrollLeft = (box.scrollLeft + midX) * (after / before) - midX;
				}
			} else if (step.kind === "pan" && !drawer && focusEl) {
				focusEl.scrollTop -= step.dy;
				focusEl.scrollLeft -= step.dx;
			}
			return step;
		}
		if (step.kind === "pinch") {
			claimed.clear();
			edges.cancel();
			pushCamera(pinchCamera(localCamera, view(), step.from, step.to));
			return step;
		}
		if (step.kind === "pan" && !drawer && !claimed.has(finger.id)) pushCamera(pan(localCamera, step.dx, step.dy));
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
		edges.cancel();
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
		wheel,
		touch,
		claimTouch: (id) => claimed.add(id),
		pinching: () => touches.count() > 1,
		pan: (dx, dy) => {
			// A drag across the page scrolls it, exactly as dragging a document does — and there
			// is nothing sideways to go to, so only the vertical part means anything.
			if (props.focus) {
				if (focusEl) focusEl.scrollTop -= dy;
				return;
			}
			pushCamera(pan(localCamera, dx, dy));
		},
		space: (held) => setSpaceHeld(held),
		spaceHeld: () => spaceHeld(),
		interactive: () => localCamera.zoom >= INTERACT_ZOOM,
		/*
		 * Where a world point is on the stage right now, from the camera the gestures are
		 * moving — `localCamera`, which is written synchronously in the same handler that
		 * moves the world, so a frame asking mid-gesture gets the camera its event was
		 * dispatched against. This is what lets a board frame convert a finger without
		 * measuring itself: `getBoundingClientRect` on a frame is a forced layout of the
		 * whole stage, and a pinch had two of them per step.
		 */
		screenOf: (world) => {
			const at = toScreen(localCamera, view(), world);
			return { x: at.x, y: at.y, scale: localCamera.zoom };
		},
		key: (name) => shortcut(name),
		/*
		 * Same three keys as the window handler above, and deliberately the same code path —
		 * a board frame forwards the *intent* rather than a key name, because `shortcut` takes
		 * a bare key and `zoom-keys.ts` has already read the modifier.
		 */
		/*
		 * The arrows, arriving from inside a board's own document.
		 *
		 * Which is the normal case rather than the exotic one: clicking a deck to focus it
		 * puts the caret inside its frame, so the keystroke that follows never reaches the
		 * app's window at all.
		 */
		slide: (action) => drive(props.selected, action),
		/*
		 * Whether a double-click on a board belongs to the *file*, or to the frame's own fields.
		 *
		 * Answered here because the stage knows the board's format and the board does not, and
		 * returning false is what lets the frame have the gesture: the fields half of `Editor.ts`
		 * retypes a run in place, which is what a run of words wants wherever it appears.
		 *
		 * Three answers:
		 *
		 * - ⌥ on any board at all: the file as text, because that is what ⌥ means everywhere in this
		 *   app — the bytes, as they are;
		 * - a **field** board — a component one, or a flow document this app did not write: false,
		 *   so the double-click stays in the frame. A run of words is retyped where it sits, and the
		 *   document around it has no editor: ⌥ is how its bytes are reached.
		 * - anything else — markdown, a deck, a page from somewhere else: yes, the bytes, because
		 *   what is on screen there was drawn from words that are not in the file.
		 *
		 * A **flow board this app wrote** used to be the third answer's exception: a second editor
		 * over the document, on a GrapesJS model, whose components mapped to ops that wrote the file
		 * without touching an untouched byte. It has been removed — it drew the board as a stack of
		 * full-width blocks (its own `wrapper` element sat between its canvas's body and the board's
		 * components, so `body.board > *`, where the position lives, matched nothing) and its race
		 * guard refused every card with more than one child, so most of the writes it did attempt
		 * never landed. What it bought was editing a flow document's *blocks* as a document; what
		 * that costs is that such a document is edited by ⌥ and the text.
		 */
		editSource: (path, alt) => {
			const board = props.boards.find((candidate) => candidate.path === path);
			if (!board || !props.onEditSource) return false;
			/*
			 * ⌥ is the file, on every board.
			 *
			 * And a plain double-click on a board this app wrote is nobody's: the run of words under
			 * the pointer belongs to the in-frame field editor, and the document around it has no
			 * editor. This used to open a second editor that wrote ops off a GrapesJS model; that
			 * editor drew the board as a stack of blocks and refused most of the writes it did make,
			 * so the answer is `false` and the honest way to edit one of these as a document is ⌥ and
			 * the text. A board with a `shell` is the exception, because there is no in-frame editor
			 * on a markdown file or a page from somewhere else: the source *is* the board.
			 */
			if (!alt && !board.shell) return false;
			props.onEditSource(path);
			return true;
		},
		zoom: (direction) => {
			if (props.focus) {
				if (direction === "fit") fitFocus();
				else setFocusZoom((zoom) => Math.min(4, Math.max(0.1, zoom * (direction === "in" ? 1.2 : 1 / 1.2))));
				return;
			}

			if (direction === "fit") pushCamera(frame(props.boards.map(boxOf)));
			else pushCamera(zoomAbout(localCamera, view(), centre(), direction === "in" ? 1.2 : 1 / 1.2));
		},
	};

	/**
	 * When the camera was last dragged, so a double-click can tell itself apart from a pan.
	 *
	 * Chromium fires `dblclick` after two presses whatever happened between them, and a quick
	 * pan is two presses with a lot happening between them — so without this, dragging the
	 * canvas about would leave a new board behind at the end of it.
	 */
	let pannedAt = 0;

	/**
	 * A double-click on empty canvas: a board, there.
	 *
	 * "Empty" is anything that is not inside a `.board-node`. The stage's own background is the
	 * common case, but a board's title bar is in *this* document too — a keystroke that lands in
	 * a board never reaches here at all, because that is another document and its events do not
	 * bubble out of a frame. So the test is the node, not the element.
	 */
	const onDblClick = (event: MouseEvent) => {
		if (props.mode === "edit" && props.onPenEdit && onCanvas(event.target)) {
			// The second press of a quick double-click on a tool's first item is not a request for a board.
			if (performance.now() - penMadeAt < 500) return;
			// A double-click reaches inside a group: words open for rewriting, anything else is selected on its own.
			const hit = penLayer.hitTest(toWorld(localCamera, view(), stagePoint(event)), { deep: true });
			if (hit && TEXTY.has(hit.node.type)) {
				openPenText(hit);
				return;
			}
			if (hit && !penSelection().includes(hit.id)) {
				setPenSelection([hit.id]);
				return;
			}
		}
		if (!props.onCreateBoard) return;
		const target = event.target as HTMLElement | null;
		// Not on a board, and not on something drawn over one.
		if (target?.closest?.(".board-node") || onDrawn(target)) return;
		if (performance.now() - pannedAt < 400) return;
		props.onCreateBoard(stagePoint(event));
	};

	const onPointerDown = (event: PointerEvent) => {
		/*
		 * Touch is its own gesture set, and it is asked of the event rather than of the
		 * screen size: a laptop with a touchscreen has both, and each pointer should mean
		 * what it means. `preventDefault` is deliberately not called — the frames'
		 * `touch-action` is what stops the browser scrolling, and swallowing the default
		 * here would take focus away from the composer mid-sentence.
		 */
		if (event.pointerType === "touch") {
			beginTouch(event);
			return;
		}

		/*
		 * The drawing, in edit mode: an armed tool makes its item; otherwise a press on an item picks
		 * it up, a shift-press adds it to the selection or takes it out, and a shift-drag on empty
		 * canvas draws a marquee. A plain press on empty canvas lets go and pans, as it always has.
		 */
		if (props.mode === "edit" && props.onPenEdit && event.button === 0 && onCanvas(event.target) && !spaceHeld()) {
			if (penPress(event)) return;
		}

		const middle = event.button === 1;
		// A press on a drawn item while browsing is a press on the canvas: it pans, and a board lets go.
		const emptySpace = event.button === 0 && onCanvas(event.target);
		if (!middle && !emptySpace && !(spaceHeld() && event.button === 0)) return;

		event.preventDefault();
		if (emptySpace) props.onSelect(undefined);
		element.setPointerCapture(event.pointerId);
		setPanning(true);

		let last = { x: event.clientX, y: event.clientY };
		const move = (moveEvent: PointerEvent) => {
			pushCamera(pan(localCamera, moveEvent.clientX - last.x, moveEvent.clientY - last.y));
			last = { x: moveEvent.clientX, y: moveEvent.clientY };
			pannedAt = performance.now();
		};
		const finish = () => {
			element.removeEventListener("pointermove", move);
			element.removeEventListener("pointerup", finish);
			element.removeEventListener("pointercancel", finish);
			setPanning(false);
		};
		element.addEventListener("pointermove", move);
		element.addEventListener("pointerup", finish);
		element.addEventListener("pointercancel", finish);
	};

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
		const topLeft = toScreen(props.camera, v, { x: board.x, y: board.y });
		const bottomRight = toScreen(props.camera, v, { x: board.x + board.w, y: board.y + board.h });
		const margin = { x: v.width, y: v.height };
		return (
			bottomRight.x > -margin.x &&
			topLeft.x < v.width + margin.x &&
			bottomRight.y > -margin.y &&
			topLeft.y < v.height + margin.y
		);
	};

	/**
	 * Which boards have a document, and the gate that holds them at the open
	 * (`board-admission.ts`).
	 *
	 * It is handed `isVisible` rather than owning it, because the render body asks the same
	 * question — and `lastMoved` as a getter, because the gestures write it synchronously in
	 * their own handler while this reads it from a timer.
	 */
	const admission = createAdmission({
		boards: () => props.boards,
		isVisible,
		view,
		moving: () => moving() || gliding() || glidePending(),
		lastMoved: () => lastMoved,
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



	// --- the canvas renderers ---------------------------------------------------------

	/**
	 * Settle redraws for every board, a few per frame (`redraw-queue.ts`).
	 *
	 * Shared by both canvas renderers: under `canvas-per-board` each frame draws its own
	 * canvas through it, under `one-canvas` the stage captures pictures through it. Either
	 * way sixteen boards settling at once is four frames of work rather than one long one.
	 */
	const redraws = createRedrawQueue({ perFrame: 4 });
	onCleanup(() => redraws.clear());

	/**
	 * One canvas for the stage, and a darkroom behind it (`one-canvas.ts`).
	 *
	 * The queue is created here rather than there because both canvas renderers settle
	 * through the same one: `canvas-per-board` draws each frame's own canvas through it
	 * without any of the darkroom machinery.
	 */
	const oneCanvas = createOneCanvas({
		boards: () => props.boards,
		isVisible: (board) => isVisible(board),
		view,
		// The camera the gestures are moving, not the one committed a frame later.
		camera: () => localCamera,
		settledZoom: () => props.camera.zoom,
		scaling,
		moving,
		renderer: () => props.renderer,
		stage: () => element,
		queue: redraws,
	});


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

	/*
	 * One board, as the canvas draws it: the frame, its title bar, its marks, its editor.
	 *
	 * A function because the focus view renders exactly one of these in a different box
	 * (the `.focus` page below), and two copies of this — forty props, every wire the board
	 * needs — is how the two views would drift apart.
	 */
	const boardNode = (board: Board, alone = false) => (
						<BoardFrame
							board={board}
							/*
							 * The focus view's board is the whole screen, so: it is mounted (the
							 * admission budget is about six boards sharing a main thread), it is
							 * visible (the camera is not looking at it, it is not a camera), it is
							 * placed at the page's origin, and the DOM renderer draws it — the other
							 * two are canvas renderers for a canvas (`lib/renderer.ts`).
							 */
							renderer={alone ? "dom" : props.renderer}
							scaling={scaling()}
							moving={moving()}
							pictures={oneCanvas.pictures}
							camera={props.camera}
							mounted={alone || (admission.mayHaveDocument(board) && admission.isMounted(board))}
							/*
							 * No title bar in the focus view, and that is a decision rather than an
							 * omission: the bar is canvas furniture — it is how you *identify and
							 * choose* a board among others, and it sits above the board's top edge
							 * where the page's margin is. `visible` gates exactly that bar
							 * (`BoardFrame`), so the page is the document and nothing else, and the
							 * panel still says which board it is.
							 */
							visible={alone ? false : isVisible(board)}
							{...(alone ? { origin: { x: 0, y: 0 } } : {})}
							selected={props.selected === board.path}
							{...(props.editing?.path === board.path ? { editing: props.editing.editing } : {})}
							{...(props.onPresent
								? {
										onPresent: () =>
											props.onPresent?.(board.path, board.format === "slides" ? (deckIn(board.path)?.current() ?? 0) : 0),
									}
								: {})}
							nonce={props.nonces?.[board.path]}
							cursor={props.cursor?.path === board.path ? props.cursor : undefined}
							marks={(props.marks ?? []).filter((mark) => mark.path === board.path)}
							acts={actsByPath().get(board.path)}
							news={props.news?.[board.path]}
							onRead={() => props.onRead?.(board.path)}
							editor={props.editor}
							gestures={gestures}
							drops={props.drops(board.path)}
							showRev={props.frameRevs?.[board.path]}
							previewSha={props.preview?.[board.path]}
							{...(props.transcript ? { transcript: props.transcript } : {})}
							{...(props.agentIdentity ? { agentIdentity: props.agentIdentity } : {})}
							{...(props.working ? { working: props.working } : {})}
							{...(props.webStatus ? { webStatus: props.webStatus } : {})}
							{...(props.onWebReply ? { onWebReply: props.onWebReply } : {})}
							{...(props.onOpenBoard ? { onOpenBoard: props.onOpenBoard } : {})}
							{...(props.onBoardEval ? { onBoardEval: props.onBoardEval } : {})}
							onSelect={() => props.onSelect(board.path)}
							{...(props.onExtent ? { onExtent: (extent) => props.onExtent?.(board.path, extent) } : {})}
							onMove={(x, y) => props.onMove(board.path, x, y)}
							{...(props.onResize ? { onResize: (size) => props.onResize?.(board.path, size) } : {})}
							{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
							onOpen={() => pushCamera(frame([boxOf(board)]))}
							{...(props.onFocusBoard ? { focused: props.focus === board.path, onFocus: () => props.onFocusBoard?.(board.path) } : {})}
						/>
);

	/*
	 * The acts on each board, grouped once per change rather than filtered per frame: a
	 * handful of agents at most, and every frame would otherwise walk the same record.
	 */
	const actsByPath = createMemo(() => {
		const map = new Map<string, AgentAct[]>();
		for (const act of Object.values(props.acts ?? {})) {
			if (!act) continue;
			const list = map.get(act.path);
			if (list) list.push(act);
			else map.set(act.path, [act]);
		}
		return map;
	});

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
			data-previewing={Boolean(props.preview)}
			data-focus={props.focus ? "true" : undefined}
			data-panning={panning()}
			data-pen-tool={props.mode === "edit" && props.onPenEdit && penTool() !== "select" ? penTool() : undefined}
			data-scaling={scaling() && props.boards.filter(isVisible).length <= LAYER_BUDGET}
			data-gliding={gliding()}
			ref={element}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			onDblClick={onDblClick}
			style={{ cursor: spaceHeld() ? "grab" : undefined }}
		>
			{/*
			 * The focus view is a *sibling* of the world, and the world stays where it is.
			 *
			 * Not two branches of one `Show`: unmounting the world would tear down every board's
			 * document — six frames reloaded on the way back, every live board re-asked for its
			 * feed, every deck back on its first slide. Hidden and `inert` instead, which are the
			 * two halves of "not there" that matter: `display: none` takes it out of the layout,
			 * and `inert` takes it out of the tab order, the pointer and the accessibility tree.
			 *
			 * The focused board is filtered *out* of the world while it is up — it is the one board
			 * that renders in the other div — so there is still exactly one element carrying each
			 * `data-path`. That is what keeps the app's lookups honest: the inspector's shape, the
			 * editor's patch target and a deck's page handle all find the frame that is on screen,
			 * and there is no second one for them to find instead.
			 */}
			{/* The one-canvas renderer's two canvases: the picture everyone sees, and the
			    darkroom the documents live in (see `drawScene`). Under the world, so the
			    bars, shadows and marks stay HTML on top of the pictures. */}
			<canvas class="pen-layer" aria-hidden="true" hidden ref={(canvas) => penLayer.attach(canvas)} />
			<Show when={props.renderer === "one-canvas"}>
				{/* The darkroom first, so the picture is painted over it (`index.css`). */}
				<canvas
					class="darkroom"
					attr:layoutsubtree=""
					aria-hidden="true"
					width={1}
					height={1}
					ref={(canvas) => {
						oneCanvas.setDarkroom(canvas);
					}}
				/>
				<canvas
					class="stage-picture"
					aria-hidden="true"
					ref={(canvas) => {
						oneCanvas.setPicture(canvas);
					}}
				/>
			</Show>
			<div class="world" data-hidden={props.focus ? "true" : undefined} inert={props.focus ? true : undefined} ref={worldEl}>
				<For each={props.boards.filter((board) => board.path !== props.focus)} fallback={null}>
					{(board) => boardNode(board)}
				</For>
				{/*
				 * The drawing over the boards, and the invisible shapes that catch clicks on it: after
				 * the boards, so over them, and under the selected board, which is lifted over both
				 * (`canvas.css`). See `pen/layer.ts`.
				 */}
				<canvas class="pen-over" aria-hidden="true" hidden ref={(canvas) => penLayer.attach(canvas, "over")} />
				<svg class="pen-hits" aria-hidden="true" width="1" height="1" ref={(svg) => penLayer.attachHits(svg)} />
				<For each={penOutlines()}>
					{(box) => (
						<div
							class="pen-selection"
							style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, "box-shadow": `0 0 0 ${1.5 / props.camera.zoom}px var(--color-accent)` }}
						/>
					)}
				</For>
				<Show when={penHandles()}>
					{(box) => (
						<For each={HANDLES}>
							{(handle) => {
								const size = () => 9 / props.camera.zoom;
								return (
									<div
										class="pen-handle"
										data-handle={handle}
										style={{
											left: `${box().x + (handle.includes("w") ? 0 : handle.includes("e") ? box().w : box().w / 2) - size() / 2}px`,
											top: `${box().y + (handle.includes("n") ? 0 : handle.includes("s") ? box().h : box().h / 2) - size() / 2}px`,
											width: `${size()}px`,
											height: `${size()}px`,
											"border-width": `${1.5 / props.camera.zoom}px`,
										}}
										onPointerDown={(event) => resizeFrom(event, handle)}
									/>
								);
							}}
						</For>
					)}
				</Show>
				<Show when={penDraft()}>
					{(draft) => (
						<Show
							when={draft().tool !== "arrow"}
							fallback={
								<svg class="pen-draft-line" style={{ left: "0px", top: "0px" }} width="1" height="1" overflow="visible">
									<line x1={draft().x1} y1={draft().y1} x2={draft().x2} y2={draft().y2} stroke="var(--color-accent)" stroke-width={2 / props.camera.zoom} stroke-dasharray={`${6 / props.camera.zoom}`} />
								</svg>
							}
						>
							<div
								class="pen-draft"
								data-tool={draft().tool}
								style={{
									left: `${Math.min(draft().x1, draft().x2)}px`,
									top: `${Math.min(draft().y1, draft().y2)}px`,
									width: `${Math.abs(draft().x2 - draft().x1)}px`,
									height: `${Math.abs(draft().y2 - draft().y1)}px`,
									"border-width": `${1.5 / props.camera.zoom}px`,
								}}
							/>
						</Show>
					)}
				</Show>
				<Show when={penText()} keyed>
					{(open) => (
						<textarea
							class="pen-text"
							data-card={open.card ? "true" : undefined}
							style={{
								left: `${open.box.x}px`,
								top: `${open.box.y}px`,
								width: `${Math.max(open.box.w, 160)}px`,
								"min-height": `${Math.max(open.box.h, open.fontSize * 2)}px`,
								"font-size": `${open.fontSize}px`,
								background: open.fill,
							}}
							value={open.value}
							ref={(area) => requestAnimationFrame(() => {
								area.focus();
								area.select();
							})}
							onBlur={(event) => commitPenText(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									const open = penText();
									setPenText(undefined);
									if (open?.fresh) props.onPenEdit?.([{ op: "delete", id: open.id }]);
								} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
									event.preventDefault();
									event.currentTarget.blur();
								}
							}}
						/>
					)}
				</Show>
			</div>
			<Show when={focused()} keyed>
				{(board) => (
					<>
						{/*
						 * The focus view: this board as a page, in the stage's own box.
						 *
						 * The outer box is scrollable and the middle one is the page at the size it is
						 * *drawn*, because a CSS transform does not change layout — a scroll container
						 * holding only the scaled copy would scroll by the untransformed height, which
						 * is the whole document and then some. So the page reserves `w × zoom`, the
						 * document inside it is scaled from its own top-left corner, and the scroll
						 * extent is honest.
						 *
						 * Nothing is re-fitted here: the zoom is the stage's (`focusZoom`), because the
						 * gesture host that reports a wheel over the page belongs to the stage, and one
						 * number with two owners is a number that disagrees with itself.
						 */}
						<div class="focus" ref={(element) => (focusEl = element)}>
							<div class="focus-page" style={{ width: `${board.w * focusZoom()}px`, height: `${board.h * focusZoom()}px` }}>
								<div
									class="focus-scaled"
									style={{ width: `${board.w}px`, height: `${board.h}px`, transform: `scale(${focusZoom()})`, "transform-origin": "top left" }}
								>
									{boardNode(board, true)}
								</div>
							</div>
						</div>
						{/*
						 * The way out, on screen.
						 *
						 * The focus view has no title bar, deliberately — the bar is how you *identify and
						 * choose* a board among others, and there are no others here — but that left `Escape`
						 * and `d` as the only exits, and a keyboard shortcut is not a door: somebody who
						 * arrived with the mouse and never pressed a key has no way to learn either.
						 *
						 * **Centred in the page's top margin**, which is the one band of this view that is
						 * reliably empty: `.focus` pads 32px at the top edge (`FOCUS_AIR`) and a 28px chip at
						 * 2px from the top ends where the page begins, so it is beside the document and never
						 * over it. The corners are not free — the first version sat in the top-right one and
						 * was drawn *under* the zoom pill, which is `z-20` in the app's own bar and above
						 * anything the stage paints, so it was visible and unclickable.
						 *
						 * A close glyph and the key, the way `Present` labels its own way out: the glyph says
						 * what the button does, and the word teaches the shortcut to the next person.
						 */}
						<button
							class="focus-exit"
							type="button"
							title="Leave the focus view (Esc)"
							aria-label="Leave the focus view"
							onClick={() => props.onFocusToggle?.()}
						>
							<Icon of={X} size={13} />
							<span>Leave</span>
							<kbd>Esc</kbd>
						</button>
					</>
				)}
			</Show>
		</div>
	);
}
