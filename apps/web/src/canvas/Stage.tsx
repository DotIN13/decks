import { shotAdaptor } from "./shots/adaptors.ts";
import { touchedCanvas } from "../camera/touched.ts";
import { BoardCallout } from "./BoardCallout.tsx";
import type { Board, Camera, ChatItem, WebStatus } from "@decks/protocol";
import X from "lucide-solid/icons/x";
import { TOOLS } from "./pen/PenBar.tsx";
import { setCommenting } from "../state/comments.ts";
import { Icon } from "../ui/icons.tsx";
import { can } from "../connections/backend.ts";
import FilePlus from "lucide-solid/icons/file-plus";
import Presentation from "lucide-solid/icons/presentation";
import { For, Index, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { cursorFor, type AgentAct } from "./acts.ts";
import { AgentCursor, type CursorAt } from "./AgentCursor.tsx";
import { between, boxOf, easeOutCubic, fitInto, hasTitleBars, INTERACT_ZOOM, KEPT_PAGES, ONE_LIVE, pan, pinchCamera, toScreen, toWorld, zoomAbout, type Viewport } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { deckFileUrl } from "../lib/api.ts";
import { checkStageOrigin, stagePoint } from "../camera/coords.ts";
import { BoardFrame, type BoardEditing } from "../board/BoardFrame.tsx";
import type { EditorHost, Tool } from "../board/Editor.ts";
import type { FileDropHost } from "../board/file-drop.ts";
import type { FrameGestureHost } from "../board/frame-gestures.ts";
import { zoomKey } from "./zoom-keys.ts";
import { deckMode, type DeckHandle, type SlideAction, slideKey } from "../present/slide-keys.ts";
import { cssEscape } from "../board/inspect.ts";
import { deckBoardLink } from "../board/board-links.ts";
import { shortLabel } from "../chat/composer/draft.ts";
import type { LiveWebReply } from "../board/live-chat.ts";
import { createEdgeSwipe } from "./edge-swipe.ts";
import { coastStart, coastStep, createTouches, type Finger, type TouchStep } from "./touch.ts";
import { velocityFrom, type Sample } from "../chrome/float-math.ts";
import type { RendererChoice } from "../lib/renderer.ts";
import { createRedrawQueue } from "./redraw-queue.ts";
import { openThumbnails } from "./thumb-budget.ts";
import { createAdmission } from "./board-admission.ts";
import { debugOff, PenLayer, type PenHit, type PenPreview } from "./pen/layer.ts";
import { BoxIndex } from "./spatial.ts";
import { StageInk } from "./pen/StageInk.tsx";
import { inkVariableEdit, strokeOf } from "./pen/ink.ts";
import { insertPanel, PEN_TOOL_KEYS, penIcon, penLive, penSelection, penShape, penTool, setInsertPanel, setPenBoxes, setPenLive, setPenSelection, setPenSheet, setPenTool, setPenTyping, type PenTool } from "../state/pen-tools.ts";
import { scheme } from "../lib/theme.ts";
import { ARROW, ARROW_SIDES, arrowEndItem, arrowPoints, baseTheme, isShape, mediaOf, makeLabel, makeShape, maxRadius, SHAPES, shapeKind, shapeLabel, shapeRadius, sidePoint, type ArrowSide, color, fillsOf, isArrow, CARD, isCard, isMarkdown, MARKDOWN, moveArrowEnds, NOTE_PAD, ids as penIds, indexOf, newId, textStyleOf, walk, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import { pageFont } from "./pen/fonts.ts";
import { isPhone } from "../camera/camera.ts";
import { CardEditor } from "./pen/CardEditor.tsx";
import { cardChildren, cardEdits, cardMarkdown, CARD_GAP, CARD_PAD, CARD_RADIUS, heldLabels, isFile, newCard } from "./pen/card-frame.ts";
import { Insert } from "./pen/Insert.tsx";
import { CARD_PALETTE } from "./pen/markdown-layout.ts";
import { NOTE_RADIUS } from "./pen/paint.ts";
import { snapEdges, snapMove, type Box, type Guide } from "./pen/snap.ts";

/** How a drawn item's words are set, for the editor that types over them (`textLookOf`). */
interface TextLook {
	font: string;
	size: number;
	weight: number;
	italic: boolean;
	spacing: number;
	/** A multiple of the size; unset is the font's own. */
	line?: number;
	align: string;
	/** Between the item's edge and its words: a note's padding, none for a text. */
	pad: number;
	ink: string;
	/** A note's colour, drawn under the editor when its words outgrow the note. */
	paper?: string;
	/** A text that grows as wide as its words, or a box of fixed width that grows down. */
	grows: "wide" | "tall";
	/** A card: its words are markdown, typed as markdown and drawn as it reads. */
	markdown?: boolean;
}

/**
 * `v`, select: the one palette key left. The tools that add things are the stage's own now, armed
 * by `PEN_TOOL_KEYS` (`state/pen-tools.ts`); the ones that inserted components into a board are gone.
 */
const TOOL_KEYS: Record<string, Tool> = { v: "select" };

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
	/** A board where the canvas menu was opened, in stage pixels: an ordinary board or a slide deck. */
	onCreateBoard?: (at: { x: number; y: number }, format?: "board" | "slides") => void;
	onHide?: (path: string) => void;
	/** Per-board reload counters, from `stage.reload`. */
	nonces?: Record<string, number>;
	cursor?: { path: string; x: number; y: number; label: string; color: string } | null;
	/** What each agent is doing to which board; each frame takes the acts on its board (`canvas/acts.ts`). */
	acts?: Record<string, AgentAct | undefined>;
	/** The stage being shown, by folder name: a drawing act is drawn only on its own stage. */
	stageName?: string | undefined;
	/** The words on an agent's cursor tag, from its id and the name its act carries. */
	agentLabel?: (agentId: string, name: string) => string;
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
	/**
	 * Presses in hand that want to hear the camera move. A wheel or a glide during a drag moves the
	 * world under a pointer that has not moved, so `follow` replays its last step against the new
	 * camera, and what is carried stays under the cursor.
	 */
	const cameraWatchers = new Set<() => void>();
	const cameraChanged = () => {
		for (const watch of [...cameraWatchers]) watch();
	};
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
		// A hand on the canvas holds the view against an agent's show (`camera/touched.ts`).
		for (const kind of ["pointerdown", "wheel", "keydown"] as const) element.addEventListener(kind, touchedCanvas, { capture: true, passive: true });
		onCleanup(() => {
			for (const kind of ["pointerdown", "wheel", "keydown"] as const) element.removeEventListener(kind, touchedCanvas, { capture: true });
		});
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
			 * The drawing's own keys, in either mode but not while drawing. None of them fire while a text box has the caret
			 * (above). Delete, the arrows and ⌘D act on what is selected; ⌘Z and ⇧⌘Z step through the
			 * person's own edits; Escape lets go, then puts the tool down; a letter arms a tool
			 * (`PEN_TOOL_KEYS`), from this document only.
			 */
			if (props.onPenEdit && !props.drawing && penKey(event)) {
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
		// By the frame's own path rather than its box, which is the one lookup every renderer shares.
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
	/** WebKit's engine, on a Mac or on any iPhone browser: its user agent names AppleWebKit and never Chrome/. */
	const SLEEP_ON_ZOOM = typeof navigator !== "undefined" && /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Android/.test(navigator.userAgent);

	/**
	 * The air a focused page keeps around it, in stage pixels.
	 *
	 * Stage pixels and not board ones, because it is the *window* being measured: a margin that
	 * scaled with the page would vanish as you zoomed out and eat the width as you zoomed in.
	 */
	const FOCUS_AIR = 32;

	const centre = () => ({ x: view().width / 2, y: view().height / 2 });

	/*
	 * The stage's one sheet: the drawing and the boards' pictures, painted in a worker
	 * (`canvas/pen/layer.ts`, `pen/scene.ts`). The camera reaches it through `writeTransform`; the
	 * document, the window's size and the colour scheme through these.
	 */
	const penLayer = new PenLayer();
	onCleanup(() => penLayer.dispose());
	createEffect(() => penLayer.setView(view()));
	createEffect(() => penLayer.setScheme(scheme()));
	createEffect(() => {
		penLayer.setDoc(props.pen?.doc, props.pen?.base ?? "");
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
	const calloutBoard = createMemo(() => (props.selected ? props.boards.find((board) => board.path === props.selected) : undefined));

	/**
	 * Boards whose documents are showing, by how many of their frames say so: the sheet is a hole
	 * over each of them, and the board's picture everywhere else. A count and not a set, so a frame
	 * that goes as another comes for the same board never leaves it wrongly unmarked.
	 */
	const [liveBoards, setLiveBoards] = createSignal<ReadonlyMap<string, number>>(new Map());
	/** When each board's page last came up, for keeping the most recent ones (`keptPages`). */
	const [shownAt, setShownAt] = createSignal<ReadonlyMap<string, number>>(new Map());
	/**
	 * The pages kept after they stop being shown: the `KEPT_PAGES` most recently shown boards on
	 * this canvas. The rest are let go as before. Only the DOM renderer keeps them: its page hides
	 * under the sheet's picture, where a canvas renderer's own picture is the page.
	 */
	const keptPages = createMemo<ReadonlySet<string>>((was) => {
		const onCanvas = new Set(props.boards.map((board) => board.path));
		const next = [...shownAt()]
			.filter(([path]) => onCanvas.has(path) && path !== props.focus)
			.sort((a, b) => b[1] - a[1])
			.slice(0, KEPT_PAGES)
			.map(([path]) => path);
		return was && was.size === next.length && next.every((path) => was.has(path)) ? was : new Set(next);
	});
	const markLive = (path: string, on: boolean) => {
		if (on) setShownAt((was) => new Map(was).set(path, performance.now()));
		markLiveCount(path, on);
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
	 * Editing the drawing by hand, in edit mode (`state/pen-tools.ts` holds the tool and the
	 * selection, `pen/PenBar.tsx` shows them). Every change is sent as the same pen operation an
	 * agent would send, and the drawing redraws from the server's answer; until it arrives, a drag
	 * or a resize is drawn as a preview.
	 */
	const [penDrag, setPenDrag] = createSignal({ dx: 0, dy: 0 });
	const [penResize, setPenResize] = createSignal<{ id: string; x: number; y: number; w: number; h: number; given?: { x: number; y: number } } | undefined>();
	const [penMarquee, setPenMarquee] = createSignal<{ x1: number; y1: number; x2: number; y2: number } | undefined>();
	const [penDraft, setPenDraft] = createSignal<{ tool: PenTool; x1: number; y1: number; x2: number; y2: number } | undefined>();
	/*
	 * What is being typed into. A card (`card`) is a frame of items typed into as one piece of markdown
	 * (`pen/card-frame.ts`); a note card from before (`legacy`) becomes such a frame when it is saved.
	 */
	const [penText, setPenText] = createSignal<{ id: string; box: { x: number; y: number; w: number; h: number }; value: string; style: TextLook; fresh?: boolean; card?: true; legacy?: true; held?: Record<string, string>; insertAt?: number; caretAt?: { x: number; y: number } } | undefined>();
	/**
	 * The one film or sound playing, if any.
	 *
	 * **One at a time, on purpose.** A film at rest is paint and costs a picture; a film playing is
	 * a decoder, and eight of those are already the edge of a frame's budget on a machine with no
	 * graphics card — forty-eight cost a thousand times what forty-eight stills cost. So starting
	 * one stops the last, and the canvas never holds more than a single player.
	 */
	const [playing, setPlaying] = createSignal<{ id: string; kind: "video" | "audio"; file: string } | undefined>();
	const [penDrawn, setPenDrawn] = createSignal(0);
	/**
	 * Boards picked up with the drawing: by a marquee, or Shift and a press on a title bar. They move
	 * with the selected items as one selection. The app's own selected board is a different thing —
	 * the one board whose page takes the keys — and a single press on a board is still only that.
	 */
	const [boardPicks, setBoardPicks] = createSignal<readonly string[]>([]);
	/** Boards being dragged, and by how much, until the move is sent. */
	/** A board moving itself, by a finger on its edge (`BoardFrame`'s own drag): the pill hides for it too. */
	const [ownDrag, setOwnDrag] = createSignal<{ path: string; x: number; y: number } | undefined>();
	const [boardDrag, setBoardDrag] = createSignal<{ paths: readonly string[]; dx: number; dy: number } | undefined>();
	/** A board being resized by its handles, held from the first move until the board is at it. */
	const [boardResize, setBoardResize] = createSignal<{ path: string; x: number; y: number; w: number; h: number } | undefined>();
	/**
	 * Each board as the sheet draws it: where it is, and whether it is a hole or a picture.
	 *
	 * A dragged board is where it was picked up, here: the sheet draws its picture once on the carried
	 * layer and the page slides that with the pointer (`carry` below), so a move redraws nothing.
	 */
	createEffect(() => {
		const live = liveBoards();
		const look = scheme();
		// A board drawn into a canvas of its own keeps its own picture: the sheet leaves it alone.
		const own = props.renderer === "canvas-per-board";
		const resize = boardResize();
		penLayer.setBoards(
			props.boards
				.filter((board) => board.path !== props.focus)
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
						live: (own && shotAdaptor().id !== "canvas") || live.has(board.path),
						// A live board's picture is kept ready, for a zoom on WebKit or a drag to show at once.
						...(live.has(board.path) ? { ready: true } : {}),
						...(debugOff.has("pictures") ? {} : { picture: shotAdaptor().picture(board, look) }),
						...(props.news?.[board.path] ? { news: resolveColour(props.news[board.path]!), glow: !paged(board) } : {}),
					};
				}),
		);
	});
	createEffect(() => penLayer.setMoving(panning() || scaling() || moving() || gliding()));
	/** The boards a drag carries and how far, for the carried layer; only boards that are pages, drawn as pictures there. */
	createEffect(() => {
		const drag = boardDrag();
		const held = ownDrag();
		const board = held ? props.boards.find((one) => one.path === held.path) : undefined;
		const carried = props.renderer !== "dom" ? undefined : drag ? { paths: drag.paths, dx: drag.dx, dy: drag.dy } : held && board ? { paths: [held.path], dx: held.x - board.x, dy: held.y - board.y } : undefined;
		penLayer.carry(carried?.paths ?? [], carried ?? { dx: 0, dy: 0 });
	});
	/** The boards whose carried picture is on screen: their pages hide where they were picked up (`BoardFrame`). */
	const [carriedPages, setCarriedPages] = createSignal<ReadonlySet<string>>(new Set());
	penLayer.carrying = setCarriedPages;
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
	/** Where the drag or resize in hand snapped, in stage pixels (`pen/snap.ts`). */
	const [guides, setGuides] = createSignal<readonly Guide[]>([]);
	/** The item under the pointer, outlined the way a design tool does before anything is pressed. */
	const [hoverId, setHoverId] = createSignal<string | undefined>();
	/** The board under the pointer, outlined the same way in edit mode. */
	const [hoverBoard, setHoverBoard] = createSignal<string | undefined>();
	/** What an arrow's end would join if it were let go now: an item or a board, lit up. */
	const [joinHint, setJoinHint] = createSignal<readonly Box[]>([]);
	/** The four sides an arrow end can keep to, on what it would join, and the one it is near (`sideNear`). */
	const [sideHint, setSideHint] = createSignal<ReadonlyArray<{ box: Box; side?: ArrowSide }>>([]);
	/** An arrow end being dragged: the line from the end that stays to the pointer. */
	const [endDraft, setEndDraft] = createSignal<{ x1: number; y1: number; x2: number; y2: number } | undefined>();
	/** When a tool last made an item, so the second press of a double-click does not make a board. */
	let penMadeAt = 0;
	/** The boards the sheet has on screen as pictures (`layer.ts`, `pictured`). */
	const [onSheet, setOnSheet] = createSignal<ReadonlySet<string>>(new Set());
	penLayer.pictured = (paths) => {
		const was = untrack(onSheet);
		if (was.size === paths.size && [...paths].every((path) => was.has(path))) return;
		setOnSheet(paths);
	};
	penLayer.drawn = () => {
		if (unmute && wordsOf(penLayer.placed.get(unmute.id)?.node) === unmute.value) unmuteNow();
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
	createEffect(() => {
		const present = new Set(props.boards.map((board) => board.path));
		const picks = untrack(boardPicks);
		if (picks.some((path) => !present.has(path))) setBoardPicks(picks.filter((path) => present.has(path)));
	});
	/** Select what was just asked for, which the drawing does not have until the server answers. */
	const selectMade = (made: string[]) => {
		for (const id of made) penAwaited.add(id);
		setPenSelection(made);
	};
	/*
	 * The drawing is edited in both modes — browse keeps the boards' pages as they are, edit opens
	 * them for editing too — but not while the pen is out: ink has its own selection (the lasso).
	 */
	createEffect(() => {
		if (props.drawing) {
			setPenSelection([]);
			setBoardPicks([]);
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
		const typing = penText()?.id;
		for (const id of penSelection()) {
			// The item being typed into is outlined by its editor.
			if (id === typing) continue;
			if (resize?.id === id) {
				out.push(resize);
				continue;
			}
			// An arrow is a line, and a box round it says nothing: its own two round end handles show it.
			const item = penLayer.placed.get(id)?.node;
			if (item && isArrow(item)) continue;
			const box = penLayer.bounds.get(id);
			if (box) out.push({ id, x: box.x + drag.dx, y: box.y + drag.dy, w: box.w, h: box.h });
		}
		const moving = boardDrag();
		const carried = ownDrag();
		for (const path of boardPicks()) {
			const board = props.boards.find((candidate) => candidate.path === path);
			if (!board) continue;
			const shift = moving?.paths.includes(path) ? moving : { dx: 0, dy: 0 };
			out.push({ id: `board:${path}`, x: board.x + shift.dx, y: board.y + shift.dy, w: board.w, h: board.h });
		}
		// The board the app has selected, outlined as a drawn item is, so the two look alike at every zoom.
		const chosen = props.selected;
		const board = chosen && chosen !== props.focus && !boardPicks().includes(chosen) ? props.boards.find((candidate) => candidate.path === chosen) : undefined;
		if (board) {
			const sized = boardResize();
			const shift = moving?.paths.includes(board.path) ? moving : { dx: 0, dy: 0 };
			// Carried by a finger on its edge (`BoardFrame`'s own drag): outlined where the finger has it.
			const at = carried?.path === board.path ? carried : { x: board.x + shift.dx, y: board.y + shift.dy };
			out.push(sized?.path === board.path ? { id: `board:${board.path}`, x: sized.x, y: sized.y, w: sized.w, h: sized.h } : { id: `board:${board.path}`, x: at.x, y: at.y, w: board.w, h: board.h });
		}
		const marquee = penMarquee();
		if (marquee) out.push({ id: "", x: Math.min(marquee.x1, marquee.x2), y: Math.min(marquee.y1, marquee.y2), w: Math.abs(marquee.x2 - marquee.x1), h: Math.abs(marquee.y2 - marquee.y1) });
		return out;
	});
	/** One item selected, and not a joined arrow (which the server redraws) or a group: it gets handles. */
	const penHandles = createMemo(() => {
		const outlines = penOutlines();
		if (outlines.length !== 1 || !outlines[0]!.id || outlines[0]!.id.startsWith("board:")) return undefined;
		const node = penLayer.placed.get(outlines[0]!.id)?.node;
		// A group is as big as what is in it, and pen does not scale children, so it moves but is not sized.
		if (!node || node.metadata?.type === ARROW || node.type === "group") return undefined;
		return outlines[0]!;
	});
	/**
	 * A card is as tall as the markdown in it (`@decks/pen`, `textSize`), the way it is when one is
	 * made. So it is sized by its width alone: the two side handles, and no height written to the
	 * file. Dragging a corner used to pin a height on it, and from then on its words were cut off or
	 * swam in space.
	 */
	const penAnchors = createMemo(() => {
		const box = penHandles();
		if (!box || penDraft() || penResize() || !props.onPenEdit) return undefined;
		const node = penLayer.placed.get(box.id)?.node;
		if (!node || node.type === "path" || node.type === "text") return undefined;
		return box;
	});
	/*
	 * Where each selected item is, for the properties panel's position and size: the box the stage
	 * draws, kept current as the drawing changes (`state/pen-tools.ts`).
	 */
	createEffect(() => {
		penDrawn();
		const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
		for (const id of penSelection()) {
			const box = penLayer.placed.get(id)?.box;
			if (box) boxes.set(id, { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
		}
		setPenBoxes(boxes);
	});
	/** The selected board's box, when it alone is selected and can be resized: the same eight handles as an item. */
	const boardHandles = createMemo(() => {
		const outlines = penOutlines();
		if (!props.onResize || boardDrag() || ownDrag() || outlines.length !== 1 || !outlines[0]!.id.startsWith("board:")) return undefined;
		const path = outlines[0]!.id.slice("board:".length);
		const board = props.boards.find((candidate) => candidate.path === path);
		if (!board) return undefined;
		return { ...outlines[0]!, path, slides: board.format === "slides" };
	});
	/** Handles are a screen size: a finger's on a touch screen, a pointer's otherwise. */
	const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
	const HANDLE_PX = coarse ? 16 : 9;
	const TEXTY = new Set(["text", "note", "prompt", "context"]);
	/**
	 * How the canvas sets an item's words (`pen/paint.ts`, `paintText`), for the editor that types
	 * over them: the same font, size, weight, spacing, line height, padding and colour, so the words do
	 * not move when the editor opens or closes. The canvas keeps drawing the item — its paper, its
	 * shadow, its card — and leaves out only the words while they are the editor's (`muteText`).
	 */
	const textLookOf = (node: PenNode, placed: Placed | undefined): TextLook => {
		const doc = props.pen?.doc ?? { version: "", children: [] };
		const theme = placed?.theme ?? baseTheme(doc, scheme());
		const style = textStyleOf(doc, node, theme);
		const css = (rgba: ReturnType<typeof color>) => (rgba ? `rgba(${Math.round(rgba[0] * 255)}, ${Math.round(rgba[1] * 255)}, ${Math.round(rgba[2] * 255)}, ${rgba[3]})` : undefined);
		const firstColour = fillsOf(node.fill).map((f) => (typeof f === "string" ? f : f && f.type === "color" ? (f as { color: string }).color : undefined)).find(Boolean);
		const card = node.type !== "text";
		const NOTE_PAPER: Record<string, string> = { note: "#fde68a", prompt: "#ddd6fe", context: "#bfdbfe" };
		const palette = CARD_PALETTE[scheme()];
		const paper = card ? (css(firstColour ? color(doc, firstColour, theme) : undefined) ?? (isMarkdown(node) ? palette.paper : (NOTE_PAPER[node.type] ?? NOTE_PAPER.note!))) : undefined;
		// A card's words are the app's own colour, light or dark; a sticky note's are dark on its colour.
		const ink = isMarkdown(node) ? palette.fg : card ? "#1f2328" : (css(firstColour ? color(doc, firstColour, theme) : undefined) ?? (scheme() === "dark" ? "#e6e6e6" : "#1f2328"));
		return {
			font: pageFont(style.fontFamily, style.fontWeight, style.fontStyle === "italic"),
			size: style.fontSize,
			weight: style.fontWeight,
			italic: style.fontStyle === "italic",
			spacing: style.letterSpacing,
			// Skia's line height, left unset, is the font's own: CSS's "normal".
			line: style.lineHeight,
			align: node.textAlign ?? "left",
			pad: card ? NOTE_PAD : 0,
			ink,
			...(paper ? { paper } : {}),
			grows: node.type === "text" ? ((node.textGrowth ?? "auto") === "auto" ? "wide" : "tall") : "tall",
			...(isMarkdown(node) ? { markdown: true } : {}),
		};
	};
	/** The shape an item is, or is part of (its outline or its words): the frame, by id. */
	const shapeOf = (id: string): string | undefined => {
		const doc = props.pen?.doc;
		if (!doc) return undefined;
		const found = indexOf(doc).get(id);
		if (!found) return undefined;
		if (isShape(found.node)) return found.node.id;
		return isShape(found.parent) ? found.parent!.id : undefined;
	};
	/**
	 * Type a shape's words: its own, or a new text made inside it, centred and as wide as the shape,
	 * which goes again if nothing is typed (`commitPenText`, `fresh`).
	 */
	const openShapeWords = (id: string) => {
		const doc = props.pen?.doc;
		const frame = doc ? indexOf(doc).get(id)?.node : undefined;
		const box = penLayer.placed.get(id)?.box;
		if (!frame || !box) return;
		setPenSelection([id]);
		const label = shapeLabel(frame);
		if (label) {
			const placed = penLayer.placed.get(label.id);
			openPenText({ id: label.id, node: label, box: placed?.box ?? box });
			return;
		}
		const labelId = freshId();
		const node = makeLabel(labelId);
		penEdit([{ op: "insert", parent: id, node }]);
		openPenText({ id: labelId, node, box: { x: box.x + 10, y: box.y + box.h / 2 - 10, w: Math.max(20, box.w - 20), h: 20 } }, true);
	};
	const openPenText = (given: PenHit, fresh?: boolean) => {
		// The item as the server has it now: what the canvas last drew can be a save behind.
		const now = props.pen ? indexOf(props.pen.doc).get(given.id)?.node : undefined;
		const hit = now ? { ...given, node: now } : given;
		// A card, or one of its blocks: the whole card is typed into, as one piece of markdown.
		const card = isCard(hit.node) ? hit.node : cardOf(hit.id);
		if (card) return openCard(card, hit.box, fresh);
		const node = hit.node;
		const placed = penLayer.placed.get(hit.id);
		const box = placed?.box ?? hit.box;
		penLayer.muteText(new Set([hit.id]));
		setPenText({ id: hit.id, box: { ...box }, value: typeof node.content === "string" ? node.content : "", style: textLookOf(placed?.node ?? node, placed), ...(fresh ? { fresh } : {}), ...(isMarkdown(node) ? { legacy: true as const } : {}) });
	};
	/** A file's chip, or its icon or name: the file opens in a tab of its own. Answers whether it was one. */
	const openFileOf = (id: string): boolean => {
		const located = props.pen ? indexOf(props.pen.doc).get(id) : undefined;
		const file = located ? (isFile(located.node) ? located.node : isFile(located.parent) ? located.parent : undefined) : undefined;
		if (!file || typeof file.metadata?.path !== "string") return false;
		setPenSelection([file.id]);
		window.open(new URL(file.metadata.path, new URL(props.pen?.base || "/", location.origin)).href, "_blank", "noopener");
		return true;
	};
	// While a card is typed into its toolbar is the panel, so the properties stand aside; on a phone, for any words.
	createEffect(() => setPenTyping(!!penText() && (!!penText()!.card || isPhone())));
	// A new selection starts with a phone's sheet put away; a second tap on it brings the sheet (`touchOnDrawing`).
	createEffect(on(penSelection, () => setPenSheet(false)));
	onCleanup(() => setPenTyping(false));
	/** The card an item is a block of, if it is one. */
	const cardOf = (id: string): PenNode | undefined => {
		const parent = props.pen ? indexOf(props.pen.doc).get(id)?.parent : undefined;
		return parent && isCard(parent) ? parent : undefined;
	};
	/** A card's words, its padding and its paper, for the editor laid over it. */
	const cardLook = (card: PenNode): TextLook => {
		const block = (card.children ?? []).find((child) => child.type === "text");
		const look = textLookOf(block ?? ({ type: "text", id: "", content: "" } as PenNode), undefined);
		const palette = CARD_PALETTE[scheme()];
		const doc = props.pen?.doc ?? { version: "", children: [] };
		const firstColour = fillsOf(card.fill).map((f) => (typeof f === "string" ? f : f && f.type === "color" ? (f as { color: string }).color : undefined)).find(Boolean);
		const rgba = firstColour ? color(doc, firstColour, baseTheme(doc, scheme())) : undefined;
		const paper = rgba ? `rgba(${Math.round(rgba[0] * 255)}, ${Math.round(rgba[1] * 255)}, ${Math.round(rgba[2] * 255)}, ${rgba[3]})` : palette.paper;
		return { ...look, pad: typeof card.padding === "number" ? card.padding : CARD_PAD, ink: palette.fg, paper, align: "left", grows: "tall", markdown: true };
	};
	const openCard = (card: PenNode, at: { x: number; y: number; w: number; h: number }, fresh?: boolean, where?: { insertAt?: number; caretAt?: { x: number; y: number } }) => {
		const placed = penLayer.placed.get(card.id);
		const kids = card.children ?? [];
		setPenSelection([card.id]);
		penLayer.muteText(new Set(kids.filter((child) => child.type === "text").map((child) => child.id)));
		setPenText({ id: card.id, box: { ...(placed?.box ?? at) }, value: cardMarkdown(kids), style: cardLook(card), card: true, held: heldLabels(kids), ...(fresh ? { fresh } : {}), ...where });
	};
	/**
	 * A double-click or a double tap on a card: on its words, the card opens with the caret there; in a
	 * gap, between blocks or in its padding, a new empty line is made there to type into. Answers
	 * whether it was a card. The canvas menu is for empty canvas only.
	 */
	const openCardAt = (hit: PenHit, at: { x: number; y: number }, client: { x: number; y: number }): boolean => {
		const card = isCard(hit.node) ? hit.node : cardOf(hit.id);
		if (!card) return false;
		const current = (props.pen ? indexOf(props.pen.doc).get(card.id)?.node : undefined) ?? card;
		const box = penLayer.placed.get(card.id)?.box ?? hit.box;
		if (hit.node.id === card.id) openCard(current, box, false, { insertAt: dropSlot(card.id, at, [])?.index ?? (current.children ?? []).length });
		else openCard(current, box, false, { caretAt: client });
		return true;
	};
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
	// The editor's font, fetched before it is first needed so the words never open in a stand-in.
	createEffect(() => {
		if (!props.pen) return;
		pageFont("Inter", 400, false);
		pageFont("Inter", 600, false);
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
	const [penRadius, setPenRadius] = createSignal<{ id: string; radius: number; done?: true } | undefined>();
	/*
	 * It is let go of when the drawing comes back with the change in it, not when the hand lifts.
	 * The sheet's own preview works that way already; the outline and the handles are drawn from
	 * these, and dropping them first shows the item upright for the frame or two the save takes.
	 * The timeout is for an edit that is refused, which would otherwise leave the handles turned for
	 * an item that is not.
	 */
	createEffect(() => {
		penDrawn();
		const rounding = penRadius();
		if (!rounding?.done) return;
		untrack(() => {
			{
				const node = penNode(rounding.id);
				const now = node ? (shapeRadius(node) ?? (typeof node.cornerRadius === "number" ? node.cornerRadius : 0)) : undefined;
				if (now !== undefined && Math.round(now) === Math.round(rounding.radius)) setPenRadius(undefined);
			}
		});
	});
	let letGo: ReturnType<typeof setTimeout> | undefined;
	/** Hold the live radius until the drawing has it, and never longer than this. */
	const holdUntilSaved = () => {
		clearTimeout(letGo);
		letGo = setTimeout(() => {
			if (penRadius()?.done) setPenRadius(undefined);
		}, 3000);
	};
	onCleanup(() => clearTimeout(letGo));

		/**
	 * The drawing laid out with the words being typed, so what holds them grows as they are typed:
	 * a card round its title, a note round its words. A copy of the document with the one item's
	 * words changed, drawn in place of the real one until the server answers with the real edit.
	 * Once a frame at most.
	 */
	let typedFrame: number | undefined;
	let typedValue: { id: string; value: string } | undefined;
	const previewTyped = (id: string, value: string) => {
		typedValue = { id, value };
		typedFrame ??= requestAnimationFrame(() => {
			typedFrame = undefined;
			const doc = props.pen?.doc;
			if (!doc || !typedValue) return;
			const copy = structuredClone(doc);
			const found = indexOf(copy).get(typedValue.id);
			if (!found) return;
			if (isCard(found.node)) {
				// The card grows as its blocks are typed: stand-in ids, swapped for real ones when it is saved.
				let n = 0;
				found.node.children = cardChildren(typedValue.value, found.node.children ?? [], { fresh: () => `typing-${n++}`, inner: cardInner(found.node), size: pictureSize });
			} else found.node.content = typedValue.value;
			penLayer.setDoc(copy, props.pen?.base ?? "");
		});
	};
	/** Back to the document as the server has it, for an edit taken back with Escape. */
	const dropTyped = () => {
		if (typedFrame !== undefined) cancelAnimationFrame(typedFrame);
		typedFrame = undefined;
		typedValue = undefined;
		penLayer.setDoc(props.pen?.doc, props.pen?.base ?? "");
	};
	onCleanup(() => {
		if (typedFrame !== undefined) cancelAnimationFrame(typedFrame);
	});
	/** Where the item being typed into is now: a made item is placed once the server answers. */
	const penTextBox = createMemo(() => {
		penDrawn();
		const open = penText();
		return open ? (penLayer.placed.get(open.id)?.box ?? open.box) : undefined;
	});
	/*
	 * The canvas leaves the words out until it draws the new ones: taking the editor away before the
	 * server's answer has been drawn shows the old words for a moment, and then the new.
	 */
	let unmute: { id: string; value: string; timer: ReturnType<typeof setTimeout> } | undefined;
	const unmuteNow = () => {
		if (unmute) clearTimeout(unmute.timer);
		unmute = undefined;
		penLayer.muteText(undefined);
	};
	const commitPenText = (value: string) => {
		const open = penText();
		setPenText(undefined);
		if (!open || !props.onPenEdit) return unmuteNow();
		// A text or note made by a tool and left empty was never wanted.
		if (open.fresh && !value.trim()) {
			unmuteNow();
			dropTyped();
			return props.onPenEdit([{ op: "delete", id: open.id }]);
		}
		// Against the document the server has: the one drawn already has the typed words in it.
		const node = props.pen ? indexOf(props.pen.doc).get(open.id)?.node : undefined;
		const was = node ? (open.card ? cardMarkdown(node.children ?? []) : node.content) : undefined;
		if (value === was) {
			unmuteNow();
			return dropTyped();
		}
		if (unmute) clearTimeout(unmute.timer);
		if (!open.card && !open.legacy) {
			unmute = { id: open.id, value, timer: setTimeout(unmuteNow, 3000) };
			props.onPenEdit([{ op: "update", id: open.id, set: { content: value } }]);
			return;
		}
		// A card is saved as edits to its blocks, each untouched block left alone. A note card from before
		// becomes a card frame here, in its place. Pictures are measured first, for their shape.
		const save = props.onPenEdit;
		void measurePictures(value).then(() => {
			const current = props.pen ? indexOf(props.pen.doc).get(open.id)?.node : undefined;
			const base = current ?? node;
			if (!base) return unmuteNow();
			const card = isCard(base) ? base : ({ type: "frame", id: base.id, name: base.name ?? "Card", ...(base.x !== undefined ? { x: base.x } : {}), ...(base.y !== undefined ? { y: base.y } : {}), width: typeof base.width === "number" ? base.width : 320, layout: "vertical", gap: CARD_GAP, padding: CARD_PAD, cornerRadius: CARD_RADIUS, ...(base.fill ? { fill: base.fill } : {}), metadata: { type: CARD }, children: [] } as PenNode);
			const children = cardChildren(value, card.children ?? [], { fresh: freshIds(), inner: cardInner(card), size: pictureSize });
			unmute = { id: open.id, value: cardMarkdown(children), timer: setTimeout(unmuteNow, 3000) };
			// A card's blocks are edited one by one, and only the ones that changed; a note card becomes a frame.
			const ops = isCard(base) ? cardEdits(base.id, base.children ?? [], children) : [{ op: "replace" as const, id: open.id, node: { ...card, children } }];
			if (!ops.length) return unmuteNow();
			save(ops);
		});
	};
	/** How wide a card's words are: its width less its padding. */
	const cardInner = (card: PenNode) => {
		const width = penLayer.placed.get(card.id)?.box.w ?? (typeof card.width === "number" ? card.width : 320);
		const pad = typeof card.padding === "number" ? card.padding : CARD_PAD;
		return Math.max(40, width - pad * 2);
	};
	/** Pictures' own sizes, as they arrive, so a picture put in a card keeps its shape. */
	const pictureSizes = new Map<string, { w: number; h: number } | null>();
	const pictureSize = (url: string) => pictureSizes.get(url) ?? undefined;
	const measurePictures = async (markdown: string) => {
		const urls = [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp))(?:\|[^\]]*)?\]\]/gi)].map((m) => (m[1] ?? m[2])!).filter((url) => !pictureSizes.has(url));
		await Promise.all(
			urls.map(
				(url) =>
					new Promise<void>((done) => {
						const image = new Image();
						const finish = (size: { w: number; h: number } | null) => {
							pictureSizes.set(url, size);
							done();
						};
						image.onload = () => finish(image.naturalWidth ? { w: image.naturalWidth, h: image.naturalHeight } : null);
						image.onerror = () => finish(null);
						setTimeout(() => finish(null), 1500);
						try {
							image.src = new URL(url, new URL(props.pen?.base || "/", location.origin)).href;
						} catch {
							finish(null);
						}
					}),
			),
		);
	};
	/** The words an item holds, for telling when the canvas has drawn a save: a card's are its blocks'. */
	const wordsOf = (node: PenNode | undefined) => (!node ? undefined : isCard(node) ? cardMarkdown(node.children ?? []) : node.content);
	/**
	 * A press on a drawn item's click shape (`pen/layer.ts`). Only items over a board have one, to take
	 * the press from the board's page; on bare canvas the press is the stage's and `hitTest` finds the item.
	 */
	const onDrawn = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".pen-hits");
	/** A press on something drawn, whether or not it lies over a board. */
	const pressOnDrawn = (event: PointerEvent) => onDrawn(event.target) || (event.target === element && !!penLayer.hitTest(worldAt(event)));
	/** For the browser checks: where a drawn item is on screen, since most have no click shape to measure. */
	(globalThis as { __decksPenBox?: (id: string) => DOMRect | undefined }).__decksPenBox = (id) => {
		const placed = penLayer.placed.get(id);
		if (!placed || !element) return undefined;
		const box = penLayer.bounds.get(id) ?? placed.box;
		const a = toScreen(localCamera, view(), { x: box.x, y: box.y });
		const b = toScreen(localCamera, view(), { x: box.x + box.w, y: box.y + box.h });
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
			.filter((board) => board.path !== props.focus)
			.map((board) => {
				const a = toScreen(localCamera, view(), { x: board.x, y: board.y });
				const b = toScreen(localCamera, view(), { x: board.x + board.w, y: board.y + board.h });
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
	const worldAt = (event: { clientX: number; clientY: number }) => toWorld(localCamera, view(), stagePoint(event as PointerEvent));
	const freshId = () => newId(props.pen ? penIds(props.pen.doc) : new Set());
	/** Ids for several new items at once, none the same as another or as any on the stage. */
	const freshIds = () => {
		const taken = props.pen ? penIds(props.pen.doc) : new Set<string>();
		return () => {
			const id = newId(taken);
			taken.add(id);
			return id;
		};
	};

	/**
	 * The board whose picture is under a point and that has no node of its own to take the press
	 * (below the live zoom, `rendered`): the last in file order, as the sheet draws it on top.
	 */
	const pictureUnder = (event: { clientX: number; clientY: number }): string | undefined => {
		const at = worldAt(event);
		const nodes = renderedPaths();
		let top = -1;
		for (const i of boardIndex().search({ x: at.x, y: at.y, w: 0, h: 0 })) {
			const board = props.boards[i]!;
			if (i <= top || nodes.has(board.path) || board.path === props.focus) continue;
			if (at.x >= board.x && at.x <= board.x + board.w && at.y >= board.y && at.y <= board.y + board.h) top = i;
		}
		return top < 0 ? undefined : props.boards[top]!.path;
	};
	/** For the file drop (`app/files.ts`): whether a board's picture, with no node to find, is under a point on screen. */
	(globalThis as { __decksPictureAt?: (x: number, y: number) => string | undefined }).__decksPictureAt = (x, y) => (element ? pictureUnder({ clientX: x, clientY: y }) : undefined);
	/*
	 * The card under a screen point and the slot between its blocks there, for files dropped from the
	 * desktop (`app/files.ts`): they go into the card where they land, as a picture or a file dragged
	 * from the canvas does.
	 */
	(globalThis as { __decksCardAt?: (x: number, y: number) => { card: string; index: number; inner: number } | undefined }).__decksCardAt = (x, y) => {
		if (!element) return undefined;
		const at = toWorld(localCamera, view(), stagePoint({ clientX: x, clientY: y } as MouseEvent));
		const id = frameUnder(at, []);
		const card = id ? penNode(id) : undefined;
		if (!id || !card || !isCard(card)) return undefined;
		return { card: id, index: dropSlot(id, at, [])?.index ?? (card.children ?? []).length, inner: cardInner(card) };
	};
	/** A board selected by a press on it, as `BoardFrame`'s own `onSelect` does: alone, unless it is part of the selection already. */
	const selectBoard = (path: string) => {
		if (!untrack(boardPicks).includes(path) && (untrack(boardPicks).length || untrack(penSelection).length)) {
			setBoardPicks([]);
			setPenSelection([]);
		}
		props.onSelect(path);
	};

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
		if (key === "Escape" && (selected.length || boardPicks().length || penTool() !== "select")) {
			if (penTool() !== "select") setPenTool("select");
			else {
				setPenSelection([]);
				setBoardPicks([]);
			}
			return true;
		}
		if (selected.length && command && !event.altKey && key.toLowerCase() === "d") {
			penDuplicate();
			return true;
		}
		const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
		if ((selected.length || boardPicks().length) && nudge && !command && !event.altKey) {
			const step = event.shiftKey ? 10 : 1;
			penMoveBy(selected, nudge[0]! * step, nudge[1]! * step);
			moveBoards(boardPicks(), nudge[0]! * step, nudge[1]! * step);
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
	const penMoveBy = (idsToMove: readonly string[], dx: number, dy: number, into?: string | null, slot?: number) => {
		/*
		 * Where the next item goes in a frame that stacks its children. The op takes the item out of
		 * the tree before putting it back, so an item that was already above its new place lands one
		 * too far down; `was < put` is that correction. A second item of a selection goes after the
		 * first, which is why this counts up.
		 */
		let put = slot;
		penEdit(
			idsToMove.flatMap((id): unknown[] => {
				const node = penNode(id);
				if (!node) return [];
				/*
				 * Into a frame, or out of one onto the stage: a `move` with the parent and the box the
				 * item ends up at **in stage coordinates**, which the server turns into the frame's own
				 * x and y. Writing x and y here instead is what made a frame a trap, since a child's are
				 * measured from its frame's corner.
				 *
				 * `into === undefined` is "the parent is not in question" — the drag was held with ⌘, or
				 * nothing is carried — and then this is the plain move it always was.
				 */
				const parent = penLayer.placed.get(id)?.parent ?? null;
				// A slot means the frame arranges its children, so a drag inside one reorders it: an op even where the parent is unchanged.
				if (into !== undefined && (into !== parent || put !== undefined)) {
					const box = penLayer.placed.get(id)?.box;
					let index: number | undefined;
					if (put !== undefined) {
						const was = into && into === parent ? (penNode(into)?.children ?? []).findIndex((child) => child.id === id) : -1;
						index = Math.max(0, put - (was >= 0 && was < put ? 1 : 0));
						put += 1;
					}
					if (box) {
						return [{ op: "move", id, parent: into, ...(index === undefined ? {} : { index }), box: { x1: Math.round(box.x + dx), y1: Math.round(box.y + dy), x2: Math.round(box.x + dx + box.w), y2: Math.round(box.y + dy + box.h) } }];
					}
					if (index !== undefined) return [{ op: "move", id, parent: into, index }];
				}
				return [{ op: "update", id, set: movedBy(node, dx, dy) }];
			}),
		);
	};
	/**
	 * What moving an item by `dx dy` sets. An arrow's point ends are on the stage rather than in its
	 * box, so they move with it; its joined ends stay joined (`moveArrowEnds`).
	 */
	const movedBy = (node: PenNode, dx: number, dy: number) => ({
		x: Math.round(own(node.x) + dx),
		y: Math.round(own(node.y) + dy),
		...(isArrow(node) && node.metadata ? { metadata: moveArrowEnds(node.metadata, dx, dy) } : {}),
	});
	/** Move boards by `dx dy`, each to its own new corner. */
	const moveBoards = (paths: readonly string[], dx: number, dy: number) => {
		for (const path of paths) {
			const board = props.boards.find((candidate) => candidate.path === path);
			if (board) props.onMove(path, Math.round(board.x + dx), Math.round(board.y + dy));
		}
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
			return [{ op: "copy", id, as }, { op: "update", id: as, set: movedBy(node, 24, 24) }];
		});
		penEdit(ops);
		if (made.length) selectMade(made);
	};
	/** Copies of items, `dx dy` from where they are: an Alt-drag lets go of copies and leaves the originals. */
	const penCopyBy = (idsToCopy: readonly string[], dx: number, dy: number) => {
		const taken = props.pen ? penIds(props.pen.doc) : new Set<string>();
		const made: string[] = [];
		const ops = idsToCopy.flatMap((id) => {
			const node = penNode(id);
			if (!node) return [];
			const as = newId(taken);
			taken.add(as);
			made.push(as);
			return [{ op: "copy", id, as }, { op: "update", id: as, set: movedBy(node, dx, dy) }];
		});
		penEdit(ops);
		if (made.length) selectMade(made);
	};

	/**
	 * Follow one press to its release: `move` on each step past a 3px slop, `done` at the end.
	 *
	 * The pointer is captured by `on`, the stage unless said otherwise, and the click that ends the
	 * press goes to whatever captured it — so a press on a board's title bar keeps it on the bar, or
	 * its double-click would reach the canvas and make a board.
	 *
	 * The camera can move while the press is held (a wheel, a glide), and then the last step runs
	 * again: a `move` that reads the pointer in world space (`worldAt`) follows the cursor.
	 */
	const follow = (event: PointerEvent, move: (e: PointerEvent) => void, done: (moved: boolean, e: PointerEvent) => void, on: HTMLElement = element) => {
		try {
			on.setPointerCapture(event.pointerId);
		} catch {
			// Refused for a pointer the browser no longer has; the listeners still end the press.
		}
		const start = { x: event.clientX, y: event.clientY };
		let moved = false;
		let last: PointerEvent | undefined;
		let over = false;
		const onMove = (e: PointerEvent) => {
			if (e.pointerId !== event.pointerId || released(e)) return;
			if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
			moved = true;
			last = e;
			move(e);
		};
		const replay = () => {
			if (moved && last) move(last);
		};
		/** A mouse move with no button held: the release went somewhere this never heard, so it is over. */
		const released = (e: PointerEvent) => {
			if (e.pointerType !== "mouse" || (e.buttons & 1) !== 0) return false;
			finish(e);
			return true;
		};
		const watch = (e: PointerEvent) => {
			if (e.pointerId === event.pointerId) released(e);
		};
		cameraWatchers.add(replay);
		/*
		 * Ended once, by whichever of these comes first: the release or a cancel at the element that
		 * captured the pointer, the same anywhere in the window, the capture being lost (the element
		 * left the page, or the browser took it back), or a move with no button held. Listening on
		 * the captured element alone, a release it never heard left the drag following the cursor and
		 * the camera after the button was up: zoomed out to 20%, moving a board or a group.
		 */
		const finish = (e: PointerEvent) => {
			if (over || e.pointerId !== event.pointerId) return;
			over = true;
			cameraWatchers.delete(replay);
			on.removeEventListener("pointermove", onMove);
			on.removeEventListener("pointerup", finish);
			on.removeEventListener("pointercancel", finish);
			on.removeEventListener("lostpointercapture", finish);
			window.removeEventListener("pointermove", watch, true);
			window.removeEventListener("pointerup", finish, true);
			window.removeEventListener("pointercancel", finish, true);
			done(moved, e);
		};
		on.addEventListener("pointermove", onMove);
		on.addEventListener("pointerup", finish);
		on.addEventListener("pointercancel", finish);
		on.addEventListener("lostpointercapture", finish);
		window.addEventListener("pointermove", watch, true);
		window.addEventListener("pointerup", finish, true);
		window.addEventListener("pointercancel", finish, true);
	};

	/**
	 * What a moving selection lines up with (`pen/snap.ts`): the items around it and the boards,
	 * as far as the window shows. Top-level items, and the siblings of an item inside a frame; never
	 * what is moving, the inside of an instance, or an arrow, whose box is only where its line runs.
	 */
	const snapTargets = (ids: readonly string[], boards: readonly string[]): Box[] => {
		const v = view();
		const a = toWorld(localCamera, v, { x: 0, y: 0 });
		const b = toWorld(localCamera, v, { x: v.width, y: v.height });
		const seen = (box: Box) => box.x < b.x && box.x + box.w > a.x && box.y < b.y && box.y + box.h > a.y;
		const moving = new Set(ids);
		const parents = new Set(ids.map((id) => penLayer.placed.get(id)?.parent).filter((id): id is string => !!id));
		const out: Box[] = [];
		for (const placed of penLayer.placed.values()) {
			const { node } = placed;
			if (moving.has(node.id) || node.id.includes("/") || isArrow(node)) continue;
			if (node.type === "browser" && node.metadata?.type === "decks.board") continue;
			if (placed.parent && !parents.has(placed.parent)) continue;
			const box = penLayer.bounds.get(node.id) ?? placed.box;
			if (seen(box)) out.push(box);
		}
		for (const board of props.boards) if (!boards.includes(board.path) && seen(board)) out.push({ x: board.x, y: board.y, w: board.w, h: board.h });
		return out;
	};
	/** Snapping reaches this many screen pixels, whatever the zoom. */
	const SNAP_PX = 6;
	/** The box round everything in a selection: items as drawn, boards as placed. */
	const selectionBox = (ids: readonly string[], boards: readonly string[]): Box | undefined => {
		const boxes: Box[] = [
			...ids.flatMap((id) => {
				const box = penLayer.bounds.get(id) ?? penLayer.placed.get(id)?.box;
				return box ? [box] : [];
			}),
			...props.boards.filter((board) => boards.includes(board.path)).map((board) => ({ x: board.x, y: board.y, w: board.w, h: board.h })),
		];
		if (boxes.length === 0) return undefined;
		const x1 = Math.min(...boxes.map((box) => box.x));
		const y1 = Math.min(...boxes.map((box) => box.y));
		const x2 = Math.max(...boxes.map((box) => box.x + box.w));
		const y2 = Math.max(...boxes.map((box) => box.y + box.h));
		return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
	};

	/**
	 * Drag a selection — items and boards together — the way a design tool does: it snaps to what is
	 * around it and draws guides (⌘ or Ctrl held turns that off), Shift keeps it to one axis, and Alt
	 * lets go of copies of the items, leaving the originals where they were.
	 */
	/**
	 * The composer under a point, when a drag of drawn items could be a mention instead of a move.
	 *
	 * `elementFromPoint` rather than a rectangle we keep: the composer is a float the person can
	 * drag anywhere and can be folded away to a tab, so where it is is a question only the
	 * document can answer. Pointer capture does not change hit testing, so this works mid-drag.
	 *
	 * Boards as well as drawn items, and a drag of both mentions both. The composer is a small
	 * target a hand has to aim at, so a board parked at the bottom of the canvas is parked *beside*
	 * it rather than on it; and a board is the thing most worth saying "this one" about.
	 */
	const composerUnder = (at: { clientX: number; clientY: number }, ids: readonly string[], boards: readonly string[]): HTMLElement | undefined => {
		if (!props.onRefer || ids.length + boards.length === 0) return undefined;
		const element = document.elementFromPoint(at.clientX, at.clientY) as HTMLElement | null;
		return element?.closest<HTMLElement>(".composer-box") ?? undefined;
	};
	/**
	 * What to call each thing that was dropped on the composer.
	 *
	 * A board is its title, which is the sentence on its own bar; an item is its name, or the
	 * words it draws when it has none — a note reads as what it says — and its id when it is a
	 * shape with neither. The id is what the mention *is*; this is only what it shows.
	 */
	const referPills = (ids: readonly string[], boards: readonly string[]): Array<{ kind: "board" | "item"; id: string; label: string }> => {
		const named = new Map<string, PenNode>();
		if (props.pen) for (const node of walk(props.pen.doc.children)) named.set(node.id, node);
		return [
			...boards.map((path) => ({
				kind: "board" as const,
				id: path,
				label: shortLabel(props.boards.find((board) => board.path === path)?.title || (path.split("/").pop() ?? path)),
			})),
			...ids.map((id) => {
				const node = named.get(id);
				const content = (node as { content?: unknown } | undefined)?.content;
				const words = node?.name || (typeof content === "string" ? content : "");
				return { kind: "item" as const, id, label: shortLabel(words) || id };
			}),
		];
	};

	/**
	 * The frame a live drag would drop what it carries into, or `null` for the stage itself.
	 *
	 * `undefined` when nothing is being dragged. A frame used to be a one-way door: a drag wrote an
	 * item's x and y and never its parent, and since a child's x and y are measured from its frame's
	 * corner — and the frame tool clips — dragging a child "out" only slid it out of sight inside.
	 * The op to do it properly has always been there (`move`, with a `parent` and a stage-coordinate
	 * `box`); this is the half that was missing, which is knowing where the pointer is.
	 */
	const [dropInto, setDropInto] = createSignal<string | null | undefined>();
	/** The frame under a point that a drag could drop into: never one of the items being carried, and never inside one. */
	const frameUnder = (point: { x: number; y: number }, carrying: readonly string[]): string | null => {
		const found = frameAt(point, true);
		if (!found) return null;
		if (carrying.includes(found)) return null;
		// Its own descendant would be a loop, which the op refuses anyway; this keeps it off the screen too.
		for (let up = penLayer.placed.get(found)?.parent; up; up = penLayer.placed.get(up)?.parent) if (carrying.includes(up)) return null;
		return found;
	};
	/**
	 * Where in a frame that arranges its children a drop would land: the place among them nearest
	 * the pointer, and the line drawn on that boundary. `undefined` for a frame with no layout,
	 * where an item lands on the pixel it was let go on and there is no order to join.
	 *
	 * The index counts the frame's own children, carried ones included, so it is an index the `move`
	 * op can take; a carried child is only skipped when asking which side of it the pointer is.
	 */
	const [dropAt, setDropAt] = createSignal<{ index: number; line: { x: number; y: number; w: number; h: number } } | undefined>();
	const dropSlot = (frameId: string, point: { x: number; y: number }, carrying: readonly string[]) => {
		const placed = penLayer.placed.get(frameId);
		const flow = placed?.node.layout;
		if (!placed || (flow !== "vertical" && flow !== "horizontal")) return undefined;
		const down = flow === "vertical";
		const box = penLayer.bounds.get(frameId) ?? placed.box;
		const kids = (penNode(frameId)?.children ?? []).map((child) => ({ id: child.id, box: penLayer.bounds.get(child.id) ?? penLayer.placed.get(child.id)?.box }));
		const along = down ? point.y : point.x;
		let index = kids.length;
		for (const [at, kid] of kids.entries()) {
			if (!kid.box || carrying.includes(kid.id)) continue;
			if (along < (down ? kid.box.y + kid.box.h / 2 : kid.box.x + kid.box.w / 2)) {
				index = at;
				break;
			}
		}
		const real = (from: number, step: number) => {
			for (let at = from; at >= 0 && at < kids.length; at += step) {
				const kid = kids[at]!;
				if (kid.box && !carrying.includes(kid.id)) return kid.box;
			}
			return undefined;
		};
		const before = real(index - 1, -1);
		const after = real(index, 1);
		const edge = (one: { x: number; y: number; w: number; h: number }, end: boolean) => (down ? one.y + (end ? one.h : 0) : one.x + (end ? one.w : 0));
		const on = before && after ? (edge(before, true) + edge(after, false)) / 2 : after ? edge(after, false) - 5 : before ? edge(before, true) + 5 : down ? box.y + box.h / 2 : box.x + box.w / 2;
		const line = down ? { x: box.x + 8, y: on, w: Math.max(8, box.w - 16), h: 0 } : { x: on, y: box.y + 8, w: 0, h: Math.max(8, box.h - 16) };
		return { index, line };
	};
	/** Where the frame a drag would drop into is, for the outline that says so. */
	const dropBox = createMemo(() => {
		const id = dropInto();
		if (!id) return undefined;
		const box = penLayer.bounds.get(id) ?? penLayer.placed.get(id)?.box;
		return box ? { ...box, id } : undefined;
	});

	/** The composer being told it is a drop target, so the mark can be taken off wherever the drag ends. */
	let referTarget: HTMLElement | undefined;
	const markComposer = (element: HTMLElement | undefined) => {
		if (referTarget === element) return;
		if (referTarget) delete referTarget.dataset.refer;
		referTarget = element;
		if (element) element.dataset.refer = "true";
	};

	/*
	 * The ghost of what a drag carries over a card: a picture of the items cut from the sheet as the
	 * drag starts, laid beside the pointer with a shadow and a slight tilt, as the card's own pieces are
	 * (`pen/CardEditor.tsx`), while the carried picture and the selection's handles stand aside.
	 */
	let ghost: { el?: HTMLCanvasElement; rect: { left: number; top: number; width: number; height: number } } | undefined;
	/** Where the carried items lie on screen as the drag starts: the ghost is cut from there. */
	const ghostTake = (ids: readonly string[]) => {
		ghostDrop();
		if (!element || !ids.length) return;
		const r = element.getBoundingClientRect();
		const boxes = ids.map((id) => penLayer.bounds.get(id) ?? penLayer.placed.get(id)?.box).filter((b): b is NonNullable<typeof b> => !!b);
		if (!boxes.length) return;
		const a = toScreen(localCamera, view(), { x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)) });
		const b = toScreen(localCamera, view(), { x: Math.max(...boxes.map((b) => b.x + b.w)), y: Math.max(...boxes.map((b) => b.y + b.h)) });
		ghost = { rect: { left: r.left + a.x, top: r.top + a.y, width: b.x - a.x, height: b.y - a.y } };
	};
	/** Over a card, the ghost beside the pointer `gap` px off; elsewhere, the carried picture as before. */
	const ghostShow = (over: boolean, client?: { x: number; y: number }, gap = 12) => {
		if (over && ghost && !ghost.el) {
			const el = penLayer.cutFromCarried(ghost.rect);
			if (el) {
				el.className = "pen-drag-ghost";
				// A large item rides at most about a card's width, so the slot it is aimed at stays in view.
				const scale = Math.min(1, 220 / Math.max(ghost.rect.width, 1));
				el.style.width = `${ghost.rect.width * scale}px`;
				el.style.height = `${ghost.rect.height * scale}px`;
				document.body.append(el);
				ghost.el = el;
			}
		}
		const showing = over && !!ghost?.el;
		element?.toggleAttribute("data-ghosting", showing);
		penLayer.showCarriedLayer(!showing);
		if (!ghost?.el) return;
		ghost.el.hidden = !over;
		if (over && client) {
			ghost.el.style.left = `${client.x + gap}px`;
			ghost.el.style.top = `${client.y + gap}px`;
		}
	};
	const ghostDrop = () => {
		ghost?.el?.remove();
		ghost = undefined;
		element?.removeAttribute("data-ghosting");
		penLayer.showCarriedLayer(true);
	};

	const dragSelection = (event: PointerEvent, ids: readonly string[], boards: readonly string[], on?: HTMLElement, onTap?: () => void) => {
		const start = selectionBox(ids, boards);
		const targets = snapTargets(ids, boards);
		let offset = { dx: 0, dy: 0 };
		const from = worldAt(event);
		ghostTake(ids);
		follow(
			event,
			(e) => {
				const now = worldAt(e);
				let dx = now.x - from.x;
				let dy = now.y - from.y;
				if (e.shiftKey) {
					if (Math.abs(dx) > Math.abs(dy)) dy = 0;
					else dx = 0;
				}
				let lines: Guide[] = [];
				if (start && !(e.metaKey || e.ctrlKey)) {
					const snapped = snapMove({ ...start, x: start.x + dx, y: start.y + dy }, targets, SNAP_PX / localCamera.zoom);
					if (!e.shiftKey || dx !== 0) dx += snapped.dx;
					if (!e.shiftKey || dy !== 0) dy += snapped.dy;
					lines = snapped.guides;
				}
				offset = { dx, dy };
				/*
				 * What it would join, from the pointer rather than from the items: a selection has no
				 * one place, and the pointer is the thing the hand is aiming. ⌘ or Ctrl already means
				 * "ignore what is around me" during a drag, and keeping the parent is the same wish.
				 */
				const onto = ids.length === 0 || e.metaKey || e.ctrlKey ? undefined : frameUnder(now, ids);
				setDropInto(onto);
				setDropAt(onto ? dropSlot(onto, now, ids) : undefined);
				/*
				 * Over a card, what is carried rides below and right of the pointer, a ghost of itself, so
				 * the line where it will land between the card's blocks stays in view under the hand.
				 */
				const overCard = !!onto && !!start && isCard(penNode(onto));
				if (overCard) {
					const gap = 12 / localCamera.zoom;
					offset = { dx: now.x + gap - start!.x, dy: now.y + gap - start!.y };
					lines = [];
				}
				ghostShow(overCard, { x: e.clientX, y: e.clientY });
				markComposer(composerUnder(e, ids, boards));
				pannedAt = performance.now();
				batch(() => {
					setGuides(lines);
					if (ids.length) setPenDrag(offset);
					if (boards.length) setBoardDrag({ paths: boards, ...offset });
				});
				if (ids.length) penLayer.preview(new Map(ids.map((id) => [id, offset])));
			},
			(moved, e) => {
				ghostDrop();
				const referring = moved && composerUnder(e, ids, boards) !== undefined;
				markComposer(undefined);
				batch(() => {
					setGuides([]);
					if (!moved) {
						setDropInto(undefined);
						setDropAt(undefined);
						setBoardDrag(undefined);
						onTap?.();
						return;
					}
					/*
					 * Dropped on the composer: the move is undone and the items are mentioned instead.
					 * Undone rather than never started, because the preview is what makes the gesture
					 * legible — you drag the note to the box and it goes back where it was, with its
					 * name now in what you are typing.
					 */
					if (referring) {
						setDropInto(undefined);
						setDropAt(undefined);
						penLayer.preview(undefined);
						setPenDrag({ dx: 0, dy: 0 });
						setBoardDrag(undefined);
						props.onRefer?.(referPills(ids, boards));
						return;
					}
					const into = dropInto();
					const slot = dropAt()?.index;
					batch(() => {
						setDropInto(undefined);
						setDropAt(undefined);
					});
					if (e.altKey && ids.length) {
						penLayer.preview(undefined);
						setPenDrag({ dx: 0, dy: 0 });
						penCopyBy(ids, offset.dx, offset.dy);
					} else penMoveBy(ids, offset.dx, offset.dy, into, slot);
					moveBoards(boards, offset.dx, offset.dy);
					setBoardDrag(undefined);
				});
			},
			on,
		);
	};

	/**
	 * A card's link. A link to a board of this deck opens that board on the canvas, exactly as
	 * the same link on a board does (`board/board-links.ts`); anything else is a new tab. A
	 * relative link is read against the stage's own folder.
	 */
	const openLink = (href: string) => {
		const board = deckBoardLink(href, props.pen?.base ?? "");
		if (board && props.onOpenBoard?.(board, "")) return;
		let url: URL;
		try {
			url = new URL(href, new URL(props.pen?.base || "/", location.href));
		} catch {
			return;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return;
		window.open(url.href, "_blank", "noopener,noreferrer");
	};
	/** A link is under the pointer: the cursor says so. */
	const [overLink, setOverLink] = createSignal(false);

	/** A press on the drawing; true when it was the drawing's to handle. */
	const penPress = (event: PointerEvent): boolean => {
		const at = worldAt(event);
		const tool = penTool();
		if (tool !== "select") {
			event.preventDefault();
			props.onSelect(undefined);
			setBoardPicks([]);
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
			const group = selected.includes(hit.id);
			const moving = group ? selected : [hit.id];
			const boards = group ? boardPicks() : [];
			if (!group) {
				setPenSelection(moving);
				setBoardPicks([]);
			}
			setHoverId(undefined);
			/*
			 * A link in a card: a click that does not move follows it, in a new tab. While browsing,
			 * any click; while editing, where a click is for selecting, one with ⌘ or Ctrl.
			 */
			const href = penLayer.linkAt(at);
			const follows = href && (props.mode === "browse" || event.metaKey || event.ctrlKey);
			dragSelection(event, moving, boards, undefined, follows ? () => openLink(href) : undefined);
			return true;
		}
		/*
		 * Bare canvas: a marquee, as in a design tool, picking the items and the boards wholly inside
		 * it as it goes. Shift adds to what is already selected. The camera pans with a scroll, a
		 * pinch, Space and a drag, or the middle button — never with a plain drag here.
		 */
		event.preventDefault();
		props.onSelect(undefined);
		const adding = event.shiftKey;
		const keptItems = adding ? penSelection() : [];
		const keptBoards = adding ? boardPicks() : [];
		if (!adding) {
			setPenSelection([]);
			setBoardPicks([]);
		}
		setPenMarquee({ x1: at.x, y1: at.y, x2: at.x, y2: at.y });
		const pick = (m: { x1: number; y1: number; x2: number; y2: number }) => {
			const r = { x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2), w: Math.abs(m.x2 - m.x1), h: Math.abs(m.y2 - m.y1) };
			const inside = (b: Box) => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
			batch(() => {
				setPenSelection([...new Set([...keptItems, ...penLayer.within(r)])]);
				setBoardPicks([...new Set([...keptBoards, ...props.boards.filter(inside).map((board) => board.path)])]);
			});
		};
		follow(
			event,
			(e) => {
				const now = worldAt(e);
				const m = { x1: at.x, y1: at.y, x2: now.x, y2: now.y };
				pannedAt = performance.now();
				setPenMarquee(m);
				pick(m);
			},
			() => setPenMarquee(undefined),
		);
		return true;
	};

	/**
	 * A press on a board's title bar (`BoardFrame`), with a mouse or a pen: the stage moves it, so it
	 * moves with whatever else is selected and snaps like everything else. Shift adds the board to the
	 * selection or takes it out. A finger's drag stays the board's own, where a pinch can take it back.
	 */
	const dragBoard = (path: string, event: PointerEvent, on = event.currentTarget as HTMLElement): boolean => {
		if (event.button !== 0) return false;
		event.stopPropagation();
		event.preventDefault();
		const picks = boardPicks();
		if (event.shiftKey) {
			setBoardPicks(picks.includes(path) ? picks.filter((p) => p !== path) : [...picks, path]);
			return true;
		}
		const group = picks.includes(path);
		if (!group) {
			setBoardPicks([]);
			setPenSelection([]);
		}
		props.onSelect(path);
		dragSelection(event, group ? penSelection() : [], group ? picks : [path], on);
		return true;
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
		 * A card that is as tall as its words keeps being that while only its sides are dragged: the
		 * width goes in the file and the layout measures the words again. The top and bottom handles
		 * are what pin a height on it, and a corner pins one too, since it drags an edge of each.
		 */
		const words = hugsWords(id) && !handle.includes("n") && !handle.includes("s");
		const node = penLayer.placed.get(id)?.node;
		// Nothing smaller than a card's own padding, which would be a card with no room for a word in it.
		const floor = node && (isMarkdown(node) || isCard(node)) ? NOTE_PAD * 2 : 4;
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
		const targets = snapTargets([id], []);
		const edges = [
			...(handle.includes("w") ? (["x1"] as const) : []),
			...(handle.includes("e") ? (["x2"] as const) : []),
			...(handle.includes("n") ? (["y1"] as const) : []),
			...(handle.includes("s") ? (["y2"] as const) : []),
		];
		const from = worldAt(event);
		follow(
			event,
			(e) => {
				const now = worldAt(e);
				const dx = now.x - from.x;
				const dy = now.y - from.y;
				let x1 = start.x + (handle.includes("w") ? dx : 0);
				let x2 = start.x + start.w + (handle.includes("e") ? dx : 0);
				let y1 = start.y + (handle.includes("n") ? dy : 0);
				let y2 = start.y + start.h + (handle.includes("s") ? dy : 0);
				// The edges being dragged snap to what is around, unless ⌘ or Ctrl is held.
				let lines: Guide[] = [];
				if (!(e.metaKey || e.ctrlKey)) {
					const snapped = snapEdges({ x1, y1, x2, y2 }, edges, targets, SNAP_PX / localCamera.zoom);
					({ x1, y1, x2, y2 } = snapped.box);
					lines = snapped.guides;
				}
				setGuides(lines);
				// Shift keeps the shape: the wider of the two changes sets both.
				if (e.shiftKey && handle.length === 2 && start.w > 0 && start.h > 0) {
					const scale = Math.max((x2 - x1) / start.w, (y2 - y1) / start.h);
					if (handle.includes("w")) x1 = x2 - start.w * scale;
					else x2 = x1 + start.w * scale;
					if (handle.includes("n")) y1 = y2 - start.h * scale;
					else y2 = y1 + start.h * scale;
				}
				next = { x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)), w: Math.max(4, Math.round(Math.abs(x2 - x1))), h: Math.max(floor, Math.round(Math.abs(y2 - y1))) };
				const box = givenFor(next);
				setPenResize({ id, ...next, given: { x: box.x, y: box.y } });
				// A card's height is left out, so the drawing re-measures its words at the new width.
				penLayer.preview(new Map<string, PenPreview>([[id, { dx: box.x - given.x, dy: box.y - given.y, w: box.w, ...(words ? {} : { h: box.h }) }]]));
			},
			(moved) => {
				setGuides([]);
				if (!moved) return;
				const box = givenFor(next);
				const r = (n: number) => Math.round(n * 10) / 10;
				// A card still following its words: its width alone, and no height written.
				if (words) return penEdit([{ op: "update", id, box: { x1: r(box.x), y1: r(box.y), x2: r(box.x + box.w) } }]);
				penEdit([{ op: "update", id, box: { x1: r(box.x), y1: r(box.y), x2: r(box.x + box.w), y2: r(box.y + box.h) } }]);
			},
		);
	};

	/**
	 * How round the corners are, dragged. The handle starts inside the top-left corner; pulling it
	 * along the diagonal rounds every corner by as much, up to half the shorter side, where the
	 * straight sides are gone. A shape from the library keeps it in its own `metadata.radius`, which
	 * is what redraws its outline (`@decks/pen`, `fitShapes`); pen's rectangle and frame have a
	 * `cornerRadius` of their own. It is written on the lift, not while dragging, so one drag is one
	 * edit in the file's history.
	 */
	const radiusFrom = (event: PointerEvent) => {
		const start = radiusHandle();
		if (event.button !== 0 || !start) return;
		event.preventDefault();
		event.stopPropagation();
		let radius = start.radius;
		follow(
			event,
			(e) => {
				const now = worldAt(e);
				// Along the diagonal from the corner: the nearer of the two reaches, so a pull across rounds as much as a pull down.
				const reach = Math.min(now.x - start.x, now.y - start.y);
				radius = Math.max(0, Math.min(Math.round(reach), Math.floor(start.most)));
				setPenRadius({ id: start.id, radius });
				penLayer.preview(new Map<string, PenPreview>([[start.id, { dx: 0, dy: 0, radius }]]));
			},
			(moved) => {
				if (!moved || radius === start.radius) {
					setPenRadius(undefined);
					penLayer.preview(undefined);
					return;
				}
				setPenRadius((was) => (was ? { ...was, done: true } : was));
				holdUntilSaved();
				if (!start.shape) return penEdit([{ op: "update", id: start.id, set: { cornerRadius: radius <= 0 ? null : radius } }]);
				const node = penLayer.placed.get(start.id)?.node;
				penEdit([{ op: "update", id: start.id, set: { metadata: { type: "", ...node?.metadata, radius } } }]);
			},
		);
	};


	/**
	 * A markdown card as tall as its words, which is how one starts: no `height` of its own, so the
	 * layout measures what it says at whatever width it has. Dragging its top or bottom handle pins a
	 * height on it, and from then on it is an ordinary box — the properties panel is how it gets its
	 * words' height back.
	 */
	const hugsWords = (id: string | undefined) => {
		const node = id ? penLayer.placed.get(id)?.node : undefined;
		return !!node && (isMarkdown(node) || isCard(node)) && typeof node.height !== "number";
	};
	/**
	 * Where the player sits, while something is playing: the item's own drawn box.
	 *
	 * It stops on its own in three cases, which are the board's rules rather than new ones: the item
	 * is gone from the file, it is no longer the selection, or the camera has pulled back past the
	 * zoom at which a board stops being live. Below that zoom a film is a picture again, and a
	 * picture is what the sheet already has.
	 */
	const playingBox = createMemo(() => {
		penDrawn();
		const now = playing();
		if (!now) return undefined;
		const node = penLayer.placed.get(now.id)?.node;
		const box = penLayer.bounds.get(now.id);
		if (!node || !box || !mediaOf(node)) return undefined;
		if (!penSelection().includes(now.id)) return undefined;
		if (localCamera.zoom < INTERACT_ZOOM) return undefined;
		const drag = penDrag();
		return { ...now, x: box.x + drag.dx, y: box.y + drag.dy, w: box.w, h: box.h };
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
	const radiusHandle = createMemo(() => {
		const box = penHandles();
		if (!box || penResize() || penDrag().dx !== 0 || penDrag().dy !== 0 || !props.onPenEdit) return undefined;
		const node = penLayer.placed.get(box.id)?.node;
		if (!node) return undefined;
		const most = maxRadius(box.w, box.h);
		if (most < 2) return undefined;
		const shape = shapeRadius(node);
		if (shape !== undefined) return { ...box, radius: shape, most, shape: true };
		if (node.type !== "rectangle" && node.type !== "frame") return undefined;
		const set = Array.isArray(node.cornerRadius) ? node.cornerRadius[0] : node.cornerRadius;
		const now = typeof set === "number" && Number.isFinite(set) ? set : 0;
		return { ...box, radius: Math.max(0, Math.min(now, most)), most, shape: false };
	});
	/** One drawn item selected, not a line or a group, and nothing being drawn: it shows where an arrow can leave it. */

	/**
	 * A board's handles, as an item's: every edge and corner, snapping to what is around, ⌘ or Ctrl
	 * to not snap, Shift to keep the shape. The board is drawn at the new box at once; letting go
	 * moves it if a left or top edge was dragged, and writes the size to its file. A slide deck's
	 * height follows from its aspect, so it is sized by its width alone.
	 */
	const BOARD_MIN = { w: 320, h: 200 };
	const resizeBoard = (event: PointerEvent, handle: (typeof HANDLES)[number]) => {
		const box = boardHandles();
		if (event.button !== 0 || !box) return;
		event.preventDefault();
		event.stopPropagation();
		const { path, slides } = box;
		const start = { x: box.x, y: box.y, w: box.w, h: box.h };
		const targets = snapTargets([], [path]);
		const edges = [
			...(handle.includes("w") ? (["x1"] as const) : []),
			...(handle.includes("e") ? (["x2"] as const) : []),
			...(!slides && handle.includes("n") ? (["y1"] as const) : []),
			...(!slides && handle.includes("s") ? (["y2"] as const) : []),
		];
		let next = start;
		const from = worldAt(event);
		follow(
			event,
			(e) => {
				const now = worldAt(e);
				const dx = now.x - from.x;
				const dy = now.y - from.y;
				let x1 = start.x + (handle.includes("w") ? dx : 0);
				let x2 = start.x + start.w + (handle.includes("e") ? dx : 0);
				let y1 = start.y + (!slides && handle.includes("n") ? dy : 0);
				let y2 = start.y + start.h + (!slides && handle.includes("s") ? dy : 0);
				let lines: Guide[] = [];
				if (!(e.metaKey || e.ctrlKey)) {
					const snapped = snapEdges({ x1, y1, x2, y2 }, edges, targets, SNAP_PX / localCamera.zoom);
					({ x1, y1, x2, y2 } = snapped.box);
					lines = snapped.guides;
				}
				setGuides(lines);
				if (!slides && e.shiftKey && handle.length === 2) {
					const scale = Math.max((x2 - x1) / start.w, (y2 - y1) / start.h);
					if (handle.includes("w")) x1 = x2 - start.w * scale;
					else x2 = x1 + start.w * scale;
					if (handle.includes("n")) y1 = y2 - start.h * scale;
					else y2 = y1 + start.h * scale;
				}
				// Never smaller than a board can be: the edge being dragged stops, the other stays put.
				if (x2 - x1 < BOARD_MIN.w) {
					if (handle.includes("w")) x1 = x2 - BOARD_MIN.w;
					else x2 = x1 + BOARD_MIN.w;
				}
				if (!slides && y2 - y1 < BOARD_MIN.h) {
					if (handle.includes("n")) y1 = y2 - BOARD_MIN.h;
					else y2 = y1 + BOARD_MIN.h;
				}
				const w = Math.round(x2 - x1);
				next = { x: Math.round(x1), y: Math.round(y1), w, h: slides ? Math.round((start.h * w) / start.w) : Math.round(y2 - y1) };
				setBoardResize({ path, ...next });
			},
			(moved) => {
				setGuides([]);
				if (!moved) {
					setBoardResize(undefined);
					return;
				}
				if (next.x !== start.x || next.y !== start.y) props.onMove(path, next.x, next.y);
				if (next.w !== start.w || next.h !== start.h) props.onResize?.(path, { w: next.w, h: next.h });
				// The box is let go of when the board is at it, or after a moment if the file settles elsewhere.
				const held = { path, ...next };
				setTimeout(() => {
					if (untrack(boardResize) === held) setBoardResize(undefined);
				}, 4000);
			},
		);
	};
	createEffect(() => {
		const held = boardResize();
		if (!held || held.path === undefined) return;
		const board = props.boards.find((candidate) => candidate.path === held.path);
		if (!board) return setBoardResize(undefined);
		const slides = board.format === "slides";
		if (board.x === held.x && board.y === held.y && board.w === held.w && (slides || board.h >= held.h)) setBoardResize(undefined);
	});

	/*
	 * What a frame starts with. The padding is what makes a frame readable as a container rather
	 * than an outline round its contents, and the radius is that padding plus a card's own corner:
	 * nested corners look right when the gap between the two curves is the same all the way round,
	 * so a card dropped into a frame sits concentric with it instead of inside a tighter arc.
	 */
	const FRAME_PAD = 18;
	const FRAME_RADIUS = NOTE_RADIUS + FRAME_PAD;

	/** What each tool makes, before its box: pen's own items, with nothing of ours in them. */
	const MADE: Record<Exclude<PenTool, "select" | "arrow" | "shape" | "icon">, { node: Partial<PenNode> & { type: string }; w: number; h: number }> = {
		rectangle: { node: { type: "rectangle", fill: "#dbe4f0", cornerRadius: 8 }, w: 160, h: 100 },
		ellipse: { node: { type: "ellipse", fill: "#c7ddf7" }, w: 120, h: 120 },
		/*
		 * A frame made by hand is a column, because that is what a frame is for: things in an order,
		 * arranged for you. Its height is a number rather than fit-content, so an empty one is a
		 * 300 px target you can drop into, and a half-full one keeps room under its last child.
		 */
		frame: { node: { type: "frame", name: "Frame", layout: "vertical", gap: 12, padding: FRAME_PAD, fill: "#ffffff", stroke: "#d0d7de", strokeWidth: 1, cornerRadius: FRAME_RADIUS, clip: true }, w: 400, h: 300 },
		text: { node: { type: "text", content: "", fontSize: 24 }, w: 240, h: 32 },
		/*
		 * A card is pen's own frame, a column, whose blocks are markdown texts and pictures (`madeNode`,
		 * `pen/card-frame.ts`), so pen.dev opens it as a column and the frame's drop places things in it.
		 */
		card: { node: { type: "frame", name: "Card" }, w: 320, h: 0 },
		note: { node: { type: "note", content: "" }, w: 240, h: 80 },
	};

	/** Shapes that are as tall as they are wide when made with a click: a circle, a star, a ring. */
	const SQUARE_SHAPES = new Set(["Ellipse", "Ring", "Star", "Octagon", "Pentagon", "Hexagon", "Plus", "Heart", "Triangle"]);
	/** The size a click makes, for every tool: a shape's by its kind, an icon's 48 square. */
	const madeSize = (tool: Exclude<PenTool, "select" | "arrow">): { w: number; h: number } => {
		if (tool === "shape") return SQUARE_SHAPES.has(penShape()) ? { w: 120, h: 120 } : penShape() === "Decision" ? { w: 160, h: 120 } : { w: 160, h: 100 };
		if (tool === "icon") return { w: 48, h: 48 };
		return MADE[tool];
	};
	/** The item a tool makes, with its id: a shape from the library (`@decks/pen`, `makeShape`), the icon picked, or the tool's own. */
	const madeNode = (tool: Exclude<PenTool, "select" | "arrow">, id: string, size: { w: number; h: number }): PenNode => {
		if (tool === "shape") {
			const taken = props.pen ? penIds(props.pen.doc) : new Set<string>();
			taken.add(id);
			return makeShape(shapeKind(penShape()) ?? SHAPES[0]!, { frame: id, outline: newId(taken) }, size);
		}
		if (tool === "icon") {
			const icon = penIcon();
			return { type: "icon", id, name: icon.name, library: icon.library, icon: icon.name, fill: "#1f2328", weight: 400 } as PenNode;
		}
		// A card is a column frame of blocks (`pen/card-frame.ts`), starting with one empty one.
		if (tool === "card") return newCard(id, freshIds()());
		return { ...MADE[tool].node, id } as PenNode;
	};

	/** The board under a stage point, when there is one: an arrow may start or end on it. */
	const boardAt = (point: { x: number; y: number }) =>
		props.boards.findLast((b) => point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h)?.path;

	/**
	 * What an arrow's end joins at a point: the item on top there, or else the board, with its box
	 * to light up. Never an arrow — joining one line to another is not something the drawing does —
	 * and never the arrow whose end it is.
	 */
	const joinAt = (point: { x: number; y: number }, not?: string): { name: string; box: Box; side?: ArrowSide } | undefined => {
		const hit = penLayer.hitTest(point, { skip: (node) => isArrow(node) || node.id === not });
		const found = hit
			? { name: hit.id, box: hit.box }
			: (() => {
					const path = boardAt(point);
					const board = path ? props.boards.find((candidate) => candidate.path === path) : undefined;
					return board ? { name: board.path, box: { x: board.x, y: board.y, w: board.w, h: board.h } } : undefined;
				})();
		if (!found) return undefined;
		const side = sideNear(found.box, point);
		return side ? { ...found, side } : found;
	};
	/**
	 * The side of a box whose middle a point is close to, if any: an arrow end let go there keeps to
	 * that side (`@decks/pen`, `sidedRoute`). Close is a few screen pixels, or a fifth of a small box.
	 */
	const SIDE_PX = 14;
	const sideNear = (box: Box, point: { x: number; y: number }): ArrowSide | undefined => {
		const reach = Math.min(SIDE_PX / localCamera.zoom, Math.max(6 / localCamera.zoom, Math.min(box.w, box.h) / 4));
		let best: { side: ArrowSide; d: number } | undefined;
		for (const side of ARROW_SIDES) {
			const [x, y] = sidePoint(box, side);
			const d = Math.hypot(point.x - x, point.y - y);
			if (d <= reach && (!best || d < best.d)) best = { side, d };
		}
		return best?.side;
	};
	/** How a join is written as an arrow's end: an item, or an item and the side it keeps to. */
	const endOf = (join: { name: string; side?: ArrowSide }) => (join.side ? { item: join.name, side: join.side } : join.name);
	const pointEnd = (point: { x: number; y: number }): [number, number] => [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10];

	/** The two ends of a selected arrow as drawn, for the handles that pick them up. */
	const arrowEnds = createMemo(() => {
		penDrawn();
		const ids = penSelection();
		if (ids.length !== 1 || boardPicks().length) return undefined;
		const node = penLayer.placed.get(ids[0]!)?.node;
		if (!node || !isArrow(node)) return undefined;
		const boards = (name: string) => props.boards.find((board) => board.path === name);
		const points = arrowPoints(node.metadata, penLayer.placed, boards);
		if (!points) return undefined;
		const drag = penDrag();
		const [fx, fy] = points[0]!;
		const [tx, ty] = points[points.length - 1]!;
		return { id: node.id, from: { x: fx + drag.dx, y: fy + drag.dy }, to: { x: tx + drag.dx, y: ty + drag.dy } };
	});

	/**
	 * An arrow's end, picked up and put down somewhere else: on an item or a board it joins it, and
	 * follows it from then on; on bare canvas it stays at that point. What it would join lights up
	 * while it is carried, as it does while the arrow is drawn.
	 */
	const dragArrowEnd = (event: PointerEvent, which: "from" | "to") => {
		const ends = arrowEnds();
		if (event.button !== 0 || !ends) return;
		event.preventDefault();
		event.stopPropagation();
		const node = penNode(ends.id);
		if (!node?.metadata) return;
		const stays = which === "from" ? ends.to : ends.from;
		follow(
			event,
			(e) => {
				const now = worldAt(e);
				const join = joinAt(now, ends.id);
				batch(() => {
					setEndDraft(which === "from" ? { x1: now.x, y1: now.y, x2: stays.x, y2: stays.y } : { x1: stays.x, y1: stays.y, x2: now.x, y2: now.y });
					setJoinHint(join ? [join.box] : []);
					setSideHint(join ? [{ box: join.box, ...(join.side ? { side: join.side } : {}) }] : []);
				});
			},
			(moved, e) => {
				batch(() => {
					setEndDraft(undefined);
					setJoinHint([]);
					setSideHint([]);
				});
				if (!moved) return;
				const now = worldAt(e);
				const other = arrowEndItem(node.metadata![which === "from" ? "to" : "from"]);
				const join = joinAt(now, ends.id);
				// An arrow from a thing to itself is a point on it instead.
				const end = join && join.name !== other ? endOf(join) : pointEnd(now);
				penEdit([{ op: "update", id: ends.id, set: { metadata: { ...node.metadata, [which]: end } } }]);
			},
		);
	};

	/**
	 * The innermost frame under a point. An item drawn inside a free-standing frame belongs to it,
	 * which is the plain call; `stacking` also takes the frames that arrange their children, which
	 * is what a drop asks for. A library shape is a frame with a layout too, and never either.
	 */
	const frameAt = (point: { x: number; y: number }, stacking = false) => {
		let best: { id: string; order: number } | undefined;
		for (const placed of penLayer.placed.values()) {
			const { node, box } = placed;
			if (node.type !== "frame" || node.id.includes("/") || isShape(node)) continue;
			if (node.layout !== "none" && !stacking) continue;
			if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			if (!best || placed.order > best.order) best = { id: node.id, order: placed.order };
		}
		return best?.id;
	};

	const penCreate = (event: PointerEvent, tool: Exclude<PenTool, "select">, at: { x: number; y: number }, from?: { name: string; box: Box; side?: ArrowSide }) => {
		setPenDraft({ tool, x1: at.x, y1: at.y, x2: at.x, y2: at.y });
		// An arrow lights up what each of its ends would join, from the first press to the release.
		const startJoin = tool === "arrow" ? (from ?? joinAt(at)) : undefined;
		if (startJoin) setJoinHint([startJoin.box]);
		follow(
			event,
			(e) => {
				const now = worldAt(e);
				setPenDraft({ tool, x1: at.x, y1: at.y, x2: now.x, y2: now.y });
				if (tool === "arrow") {
					const endJoin = joinAt(now);
					const other = endJoin && endJoin.name !== startJoin?.name ? endJoin : undefined;
					setJoinHint([...(startJoin ? [startJoin.box] : []), ...(other ? [other.box] : [])]);
					setSideHint(other ? [{ box: other.box, ...(other.side ? { side: other.side } : {}) }] : []);
				}
			},
			(moved, e) => {
				setPenDraft(undefined);
				setJoinHint([]);
				setSideHint([]);
				setPenTool("select");
				penMadeAt = performance.now();
				const end = worldAt(e);
				const id = freshId();
				if (tool === "arrow") {
					/*
					 * Each end joins what it was let go on, and follows it from then on; an end on bare
					 * canvas is a point there. A click with no drag makes an arrow only between two things.
					 */
					const fromJoin = startJoin;
					const toJoin = joinAt(end);
					const from = fromJoin ? endOf(fromJoin) : pointEnd(at);
					const to = toJoin && toJoin.name !== fromJoin?.name ? endOf(toJoin) : pointEnd(end);
					if (!moved && (!fromJoin || !toJoin || fromJoin.name === toJoin.name)) return;
					penEdit([{ op: "insert", node: { type: "path", id, stroke: "#8a8f98", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", metadata: { type: ARROW, from, to } } }]);
					selectMade([id]);
					return;
				}
				if (!moved) return penMakeAt(tool, at);
				const made = madeSize(tool);
				const x1 = Math.round(moved ? Math.min(at.x, end.x) : at.x);
				const y1 = Math.round(moved ? Math.min(at.y, end.y) : at.y);
				const w = moved ? Math.max(8, Math.round(Math.abs(end.x - at.x))) : made.w;
				const h = moved ? Math.max(8, Math.round(Math.abs(end.y - at.y))) : made.h;
				const parent = frameAt(at);
				// A text grows with its words unless a width was drawn for it; its height is always its words'.
				// A card is as tall as its words, so only its width is taken, drawn or not.
				const box =
					tool === "text" ? (moved ? { x1, y1, x2: x1 + w } : { x1, y1 }) : tool === "note" && !moved ? { x1, y1 } : tool === "card" ? { x1, y1, x2: x1 + (moved ? w : made.w) } : { x1, y1, x2: x1 + w, y2: y1 + h };
				const node = madeNode(tool, id, { w, h });
				penEdit([{ op: "insert", ...(parent ? { parent } : {}), node, box }]);
				selectMade([id]);
				if (tool === "text" || tool === "note" || tool === "card") openPenText({ id, node, box: { x: x1, y: y1, w, h: tool === "card" ? 80 : h } }, true);
			},
		);
	};

	/**
	 * One item of a tool, at its own size, at a stage point: a click with a tool armed, and a pick
	 * from the canvas menu. Words open for typing at once.
	 */
	const penMakeAt = (tool: Exclude<PenTool, "select" | "arrow">, at: { x: number; y: number }, centred = false) => {
		penMadeAt = performance.now();
		const id = freshId();
		const made = madeSize(tool);
		// From the insert panel, the item is put with its middle where it is put; from a click, its corner.
		const x1 = Math.round(centred ? at.x - made.w / 2 : at.x);
		const y1 = Math.round(centred ? at.y - made.h / 2 : at.y);
		const parent = frameAt(at);
		const box = tool === "text" || tool === "note" ? { x1, y1 } : tool === "card" ? { x1, y1, x2: x1 + made.w } : { x1, y1, x2: x1 + made.w, y2: y1 + made.h };
		const node = madeNode(tool, id, made);
		penEdit([{ op: "insert", ...(parent ? { parent } : {}), node, box }]);
		selectMade([id]);
		if (tool === "text" || tool === "note" || tool === "card") openPenText({ id, node, box: { x: x1, y: y1, w: made.w, h: tool === "card" ? 80 : made.h } }, true);
	};

	/**
	 * The canvas menu: everything that can be added, at the place a double-click or a double-tap on
	 * bare canvas landed, on every device. A board or a slide deck first, then the drawing's tools.
	 * One gesture means one thing everywhere: it used to make a board straight away with a mouse and
	 * open the tools with a finger. A pick makes the thing there; the arrow, which needs a drag, is
	 * put in hand.
	 */
	const [canvasMenu, setCanvasMenu] = createSignal<{ client: { x: number; y: number }; world: { x: number; y: number }; stage: { x: number; y: number } } | undefined>();
	const openCanvasMenu = (event: { clientX: number; clientY: number }) => {
		// A canvas that can only be read (one opened from a file) has nothing to add.
		if (!can("write")) return;
		setCanvasMenu({ client: { x: event.clientX, y: event.clientY }, world: worldAt(event), stage: stagePoint(event as PointerEvent) });
	};
	const boardFromMenu = (format: "board" | "slides") => {
		const menu = canvasMenu();
		setCanvasMenu(undefined);
		if (menu) props.onCreateBoard?.(menu.stage, format);
	};
	let lastBareTap: { x: number; y: number; at: number } | undefined;
	const pickFromMenu = (tool: Exclude<PenTool, "select">) => {
		const menu = canvasMenu();
		setCanvasMenu(undefined);
		if (!menu) return;
		if (tool === "arrow") setPenTool("arrow");
		// A shape or an icon is chosen first, in the insert panel, and put where the menu was opened.
		else if (tool === "shape" || tool === "icon") setInsertPanel({ tab: tool === "shape" ? "shapes" : "icons", at: menu.world, client: menu.client });
		else penMakeAt(tool, menu.world);
	};
	/** A pick in the insert panel: put where the canvas menu was opened, or else armed for the next press. */
	const insertPicked = (tool: "shape" | "icon") => {
		const open = insertPanel();
		setInsertPanel(undefined);
		// Another icon for one already drawn: the same place, size and colour, a new name.
		if (open?.replace && tool === "icon") {
			const icon = penIcon();
			penEdit([{ op: "update", id: open.replace, set: { library: icon.library, icon: icon.name, name: icon.name } }]);
			return;
		}
		if (open?.at) penMakeAt(tool, open.at, true);
		else setPenTool(tool);
	};
	createEffect(() => {
		if (!canvasMenu()) return;
		const away = (event: PointerEvent) => {
			if (!(event.target as Element | null)?.closest?.(".canvas-menu")) setCanvasMenu(undefined);
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") setCanvasMenu(undefined);
		};
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", key);
		onCleanup(() => {
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", key);
		});
	});
	// The camera moving takes it away: it belongs to a place on the canvas, which has just moved.
	createEffect(() => {
		void props.camera;
		untrack(() => canvasMenu() && setCanvasMenu(undefined));
	});

	/*
	 * The boards' title bars, on a desktop, in a layer over the canvas that does not zoom
	 * (`.bar-layer`): laid out once at their size on screen and moved, a translate on every camera
	 * frame and a new width when the zoom changes. Each board says where it is and how wide
	 * (`BoardFrame`), and every camera frame places every bar from that, in the same call that
	 * moves the boards. A touch screen has no bars: the selected board gets the pill instead.
	 */
	const BARS = hasTitleBars();
	/**
	 * Where the bars are mounted: a track inside the layer that moves with the camera, so a pan moves
	 * every bar with one transform. Each bar is placed on the track at its board's corner times the
	 * zoom, which only changes with the zoom; on a stage of 83 boards a pan used to write 69 bar
	 * transforms a step.
	 */
	const [barLayer, setBarLayer] = createSignal<HTMLElement>();
	let barOuter: HTMLElement | undefined;
	let barZoom = 0;
	const barAt = new WeakMap<HTMLElement, { x: number; y: number; w: number }>();
	const barWidth = new WeakMap<HTMLElement, number>();
	/** Above the board's top edge by the bar's 24 pixels and a 2-pixel gap. */
	const BAR_ABOVE = 26;
	/** A board narrower than this on screen gets no bar: its words would not fit, and a bar costs a layout per zoom. */
	const BAR_MIN_PX = 64;
	/**
	 * The zoom the bars show from. Below it they fade away, all but the selected board's, which keeps
	 * only ⋯ and ×, with the other actions in the ⋯ menu (`BoardFrame`).
	 */
	const BAR_ZOOM = 0.5;
	/** A bar button and its gap, the hairline before Hide, and the least title worth showing beside them, in screen pixels. */
	const BAR_BUTTON_PX = 22;
	const BAR_HIDE_GAP_PX = 8;
	const BAR_TITLE_PX = 70;
	const positionBar = (bar: HTMLElement, cam: Camera) => {
		const at = barAt.get(bar);
		if (!at) return;
		const dpr = window.devicePixelRatio || 1;
		// Whole device pixels on the track, which itself sits on whole device pixels, so the words are never drawn between two.
		const x = Math.round(at.x * cam.zoom * dpr) / dpr;
		const y = Math.round(at.y * cam.zoom * dpr) / dpr;
		bar.style.transform = `translate(${x}px, ${y}px)`;
		const width = Math.round(at.w * cam.zoom);
		if (barWidth.get(bar) !== width) {
			barWidth.set(bar, width);
			bar.style.width = `${width}px`;
			/*
			 * Too narrow for the buttons: none, never a ⋯ (`canvas.css`). Zoomed out the bar has no
			 * title, so the buttons need only their own width; above it, room for some title as well.
			 */
			const buttons = Number(bar.dataset.acts ?? 0);
			const needs = buttons * BAR_BUTTON_PX + BAR_HIDE_GAP_PX + (cam.zoom < BAR_ZOOM ? 0 : BAR_TITLE_PX);
			if (width < needs) bar.dataset.tight = "";
			else delete bar.dataset.tight;
		}
	};
	const placeBar = (bar: HTMLElement, at: { x: number; y: number; w: number }) => {
		barAt.set(bar, at);
		positionBar(bar, localCamera);
	};
	/** Whether a board has a bar: at least `BAR_MIN_PX` wide on screen, and on it or a quarter of a window from it, as of the camera's last rest. */
	const barWorth = (board: Board) => {
		if (board.w * restZoom() < BAR_MIN_PX) return false;
		const v = view();
		const cam = restCamera();
		const a = toScreen(cam, v, { x: board.x, y: board.y });
		const b = toScreen(cam, v, { x: board.x + board.w, y: board.y + board.h });
		return b.x > -v.width / 4 && a.x < (v.width * 5) / 4 && b.y > -v.height / 4 && a.y < (v.height * 5) / 4;
	};

	const writeTransform = (cam: Camera) => {
		const v = view();
		worldEl.style.transform = `translate(${v.width / 2}px, ${v.height / 2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
		// The drawing moves in the same call as the boards, so the two can never be a frame apart.
		penLayer.setCamera(cam);
		// And the title bars, which are in a layer of their own that does not zoom: the track moves, and the bars only when the zoom changes.
		const track = barLayer();
		if (track) {
			const dpr = window.devicePixelRatio || 1;
			const tx = Math.round((v.width / 2 - cam.x * cam.zoom) * dpr) / dpr;
			const ty = Math.round((v.height / 2 - cam.y * cam.zoom - BAR_ABOVE) * dpr) / dpr;
			track.style.transform = `translate(${tx}px, ${ty}px)`;
			if (cam.zoom !== barZoom) {
				barZoom = cam.zoom;
				for (const bar of track.querySelectorAll<HTMLElement>(".chrome")) positionBar(bar, cam);
			}
			// Below `BAR_ZOOM` the bars fade out, and fade back in as the zoom crosses it, mid-gesture (`canvas.css`).
			const low = cam.zoom < BAR_ZOOM;
			if (barOuter && low !== (barOuter.dataset.low === "true")) barOuter.dataset.low = low ? "true" : "false";
		}
	};
	// A track mounted after the camera last moved starts where the camera is, its bars placed afresh.
	createEffect(() => {
		if (!barLayer()) return;
		barZoom = 0;
		writeTransform(localCamera);
	});



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
		cameraChanged();
		pendingCamera = cam;
		if (rafId === undefined) {
			rafId = requestAnimationFrame(() => {
				rafId = undefined;
				props.setCamera(pendingCamera!);
				pendingCamera = undefined;
			});
		}
	};

	/*
	 * The coast after a thrown one-finger pan (`coastStep`, `touch.ts`). Its own frame, not a
	 * glide's: a glide is the app moving the camera somewhere, and a finger landing must stop
	 * a coast without also stopping that. Anything else that moves the camera stops it too,
	 * because every one of those goes through `cancelGlide`.
	 */
	let coastRaf: number | undefined;
	const cancelCoast = () => {
		if (coastRaf === undefined) return;
		cancelAnimationFrame(coastRaf);
		coastRaf = undefined;
	};
	const coast = (start: { vx: number; vy: number }) => {
		cancelCoast();
		let v = start;
		let last = performance.now();
		const frame = () => {
			const now = performance.now();
			const step = coastStep(v, now - last);
			last = now;
			v = step.v;
			writeCamera(pan(localCamera, step.dx, step.dy));
			if (Math.hypot(v.vx, v.vy) < 0.01) {
				coastRaf = undefined;
				return;
			}
			coastRaf = requestAnimationFrame(frame);
		};
		coastRaf = requestAnimationFrame(frame);
	};

	const cancelGlide = () => {
		cancelCoast();
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
		if (moved) cameraChanged();
	});

	onCleanup(() => {
		if (rafId !== undefined) cancelAnimationFrame(rafId);
		if (glideRaf !== undefined) cancelAnimationFrame(glideRaf);
		cancelCoast();
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
		/*
		 * A sideways scroll over a card's wide table scrolls the table, as it would in a page; Shift and
		 * a wheel is sideways too. Everything else, over a table or not, moves the camera.
		 */
		if (!event.ctrlKey && !event.metaKey && props.pen && !props.drawing) {
			const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
			if (sideways !== 0 && penLayer.scrollBy(worldAt(event), sideways / localCamera.zoom)) return;
		}
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
	/*
	 * The pan so far, as a path the camera has been dragged along, for the speed at release.
	 * A gesture that was ever more than a one-finger pan of the camera (a pinch, the edge
	 * drawer, a finger a board claimed, the focus view's page) does not coast.
	 */
	let trail: Sample[] = [];
	let trailAt = { x: 0, y: 0 };
	let noCoast = false;
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
			}
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
			if (touches.count() === 0) {
				setPanning(false);
				const thrown = noCoast || props.focus ? undefined : coastStart(velocityFrom(trail, performance.now()));
				trail = [];
				if (thrown) coast(thrown);
			}
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
			noCoast = true;
			claimed.clear();
			edges.cancel();
			pushCamera(pinchCamera(localCamera, view(), step.from, step.to));
			return step;
		}
		if (step.kind === "pan") {
			if (drawer || claimed.has(finger.id)) noCoast = true;
			else {
				pushCamera(pan(localCamera, step.dx, step.dy));
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
	 * The outline a design tool draws round what the pointer is over, before anything is pressed:
	 * what a press there would select. Edit mode only: browsing selects and edits the drawing all the
	 * same, but without a line following the pointer about. A mouse or a pen with no button down, over
	 * the drawing; a board says when it is under the pointer (`BoardFrame`), and anything else clears
	 * the item's. Once per frame at most.
	 */
	let hoverFrame: number | undefined;
	let hoverAt: { x: number; y: number } | undefined;
	let hoverPoint: { clientX: number; clientY: number } | undefined;
	/** The board under the pointer that has no node to say so (`pictureUnder`). */
	const [pictureHover, setPictureHover] = createSignal<string | undefined>();
	const onHover = (event: PointerEvent) => {
		if (event.pointerType === "touch" || !props.onPenEdit || props.drawing) return;
		if (event.buttons !== 0 || penTool() !== "select" || !onCanvas(event.target)) {
			hoverAt = undefined;
			if (hoverId()) setHoverId(undefined);
			if (pictureHover()) setPictureHover(undefined);
			if (overLink()) setOverLink(false);
			return;
		}
		hoverAt = worldAt(event);
		hoverPoint = { clientX: event.clientX, clientY: event.clientY };
		hoverFrame ??= requestAnimationFrame(() => {
			hoverFrame = undefined;
			const href = hoverAt ? penLayer.linkAt(hoverAt) : undefined;
			setOverLink(!!href && props.mode === "browse");
			// The outline is edit mode's; browsing shows only the hand over a link.
			if (props.mode !== "edit") return;
			const hit = hoverAt ? penLayer.hitTest(hoverAt) : undefined;
			setHoverId(hit && !penSelection().includes(hit.id) ? hit.id : undefined);
			// A board with no node says nothing when the pointer is over it, so the stage asks.
			setPictureHover(!hit && hoverAt && hoverPoint ? pictureUnder(hoverPoint) : undefined);
		});
	};
	onCleanup(() => {
		if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
	});
	/** The hovered item's box as it is drawn now. */
	const hoverBox = createMemo(() => {
		penDrawn();
		const id = hoverId();
		if (props.mode !== "edit") return undefined;
		// As with the selection, no box round an arrow: hovering a line should not light up a rectangle.
		const hovered = id ? penLayer.placed.get(id)?.node : undefined;
		const bounds = id && id !== penText()?.id && !(hovered && isArrow(hovered)) ? penLayer.bounds.get(id) : undefined;
		if (bounds) return { ...bounds, id };
		// A board under the pointer, unless it is the one selected, which has its own outline, or a drag is on.
		const path = hoverBoard() ?? pictureHover();
		const board = path && path !== props.selected && !boardDrag() && !panning() ? props.boards.find((candidate) => candidate.path === path) : undefined;
		return board ? { x: board.x, y: board.y, w: board.w, h: board.h, board: true } : undefined;
	});

	/** Notes and cards have a board's corners, and so does the outline round one. */
	const rounded = (id: string) => {
		const type = penLayer.placed.get(id)?.node.type;
		return type === "note" || type === "prompt" || type === "context";
	};

	/**
	 * A tap on bare canvas lets go of the drawn items and boards selected, as a click there does
	 * (`penPress`, the marquee). On the lift, not the landing: a finger that pans or becomes a pinch
	 * keeps the selection, so you can look around something you have picked.
	 */
	const tapToDeselect = (event: PointerEvent) => {
		const pointer = event.pointerId;
		const from = { x: event.clientX, y: event.clientY };
		const since = performance.now();
		let pinched = false;
		let travelled = false;
		const done = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", done);
		};
		const move = (e: PointerEvent) => {
			if (e.pointerId !== pointer && e.pointerType === "touch") pinched = true;
			// Judged on the furthest the finger went: a pan that comes back to where it began is still a pan.
			else if (e.pointerId === pointer && Math.hypot(e.clientX - from.x, e.clientY - from.y) >= 10) travelled = true;
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			done();
			if (pinched || travelled || performance.now() - since > 600) return;
			batch(() => {
				setPenSelection([]);
				setBoardPicks([]);
			});
			// A second tap close by, soon after: the canvas menu, as a double-click is with a mouse.
			const now = performance.now();
			const twice = lastBareTap && now - lastBareTap.at < 350 && Math.hypot(e.clientX - lastBareTap.x, e.clientY - lastBareTap.y) < 30;
			lastBareTap = twice ? undefined : { x: e.clientX, y: e.clientY, at: now };
			if (twice) openCanvasMenu(e);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", done);
	};

	/** The last tap on a drawn item, so a second one soon after on the same item opens its words. */
	let lastTap: { id: string; at: number } | undefined;
	/**
	 * A finger on the drawing. On an item already selected it moves the selection (the finger is
	 * claimed, so the camera stays put); anywhere else it is a pan unless it lifts where it landed,
	 * which is a tap: the item is selected, and a second tap on words opens them for typing.
	 */
	const touchOnDrawing = (event: PointerEvent) => {
		const at = worldAt(event);
		const hit = penLayer.hitTest(at);
		if (!hit) return;
		const pointer = event.pointerId;
		const from = { x: event.clientX, y: event.clientY };
		const since = performance.now();
		const selected = penSelection();
		const carrying = selected.includes(hit.id);
		if (carrying) claimed.add(pointer);
		let offset = { dx: 0, dy: 0 };
		let moved = false;
		const done = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
		};
		const abandon = () => {
			done();
			ghostDrop();
			setDropInto(undefined);
			setDropAt(undefined);
			if (moved && carrying) {
				penLayer.preview(undefined);
				setPenDrag({ dx: 0, dy: 0 });
				setBoardDrag(undefined);
			}
		};
		const move = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			// A second finger: this was the start of a pinch, and whatever it carried goes back.
			if (touches.count() > 1) return abandon();
			if (!moved && Math.hypot(e.clientX - from.x, e.clientY - from.y) < 10) return;
			// The ghost's picture is cut as the finger picks the items up, before they leave the sheet.
			if (!moved && carrying) ghostTake(selected);
			moved = true;
			if (!carrying) return;
			offset = { dx: (e.clientX - from.x) / localCamera.zoom, dy: (e.clientY - from.y) / localCamera.zoom };
			// What it would drop into, as a mouse's drag asks (`dragSelection`): over a card, a ghost beside the finger.
			const now = worldAt(e);
			const onto = frameUnder(now, selected);
			setDropInto(onto);
			setDropAt(onto ? dropSlot(onto, now, selected) : undefined);
			const start = onto && isCard(penNode(onto)) ? selectionBox(selected, []) : undefined;
			if (start) {
				// A finger hides what is under it, so the ghost goes further from it than a pointer's does.
				const gap = 28 / localCamera.zoom;
				offset = { dx: now.x + gap - start.x, dy: now.y + gap - start.y };
			}
			ghostShow(!!start, { x: e.clientX, y: e.clientY }, 28);
			batch(() => {
				setPenDrag(offset);
				if (boardPicks().length) setBoardDrag({ paths: boardPicks(), ...offset });
			});
			penLayer.preview(new Map(selected.map((id) => [id, offset])));
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			done();
			if (moved) {
				ghostDrop();
				const into = dropInto();
				const slot = dropAt()?.index;
				batch(() => {
					setDropInto(undefined);
					setDropAt(undefined);
				});
				if (carrying)
					batch(() => {
						penMoveBy(selected, offset.dx, offset.dy, into, slot);
						moveBoards(boardPicks(), offset.dx, offset.dy);
						setBoardDrag(undefined);
					});
				return;
			}
			if (performance.now() - since > 600) return;
			const deep = penLayer.hitTest(at, { deep: true });
			if (lastTap && lastTap.id === hit.id && performance.now() - lastTap.at < 400 && deep && openFileOf(deep.id)) {
				lastTap = undefined;
				return;
			}
			if (lastTap && lastTap.id === hit.id && performance.now() - lastTap.at < 400 && deep && (deep.node.type !== "rectangle" || !cardOf(deep.id)) && openCardAt(deep, at, { x: e.clientX, y: e.clientY })) {
				lastTap = undefined;
				return;
			}
			if (lastTap && lastTap.id === hit.id && performance.now() - lastTap.at < 400 && deep && (TEXTY.has(deep.node.type) || shapeOf(deep.id))) {
				lastTap = undefined;
				const shape = shapeOf(deep.id);
				if (shape && !TEXTY.has(deep.node.type)) openShapeWords(shape);
				else openPenText(deep);
				return;
			}
			const href = props.mode === "browse" ? penLayer.linkAt(at) : undefined;
			if (href) return openLink(href);
			lastTap = { id: hit.id, at: performance.now() };
			// A second tap on the one thing selected asks for its properties: on a phone, the sheet.
			if (selected.length === 1 && selected[0] === hit.id) {
				setPenSheet(true);
				return;
			}
			props.onSelect(undefined);
			setBoardPicks([]);
			setPenSelection([hit.id]);
		};
		const cancel = (e: PointerEvent) => {
			if (e.pointerId === pointer) abandon();
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
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
	 * A double-click on empty canvas: the canvas menu, there (`canvasMenu`).
	 *
	 * "Empty" is anything that is not inside a `.board-node`. The stage's own background is the
	 * common case, but a board's title bar is in *this* document too — a keystroke that lands in
	 * a board never reaches here at all, because that is another document and its events do not
	 * bubble out of a frame. So the test is the node, not the element.
	 */
	const onDblClick = (event: MouseEvent) => {
		if (props.onPenEdit && !props.drawing && onCanvas(event.target)) {
			// The second press of a quick double-click on a tool's first item is not a request for a board.
			if (performance.now() - penMadeAt < 500) return;
			// A double-click reaches inside a group: words open for rewriting, anything else is selected on its own.
			const hit = penLayer.hitTest(toWorld(localCamera, view(), stagePoint(event)), { deep: true });
			// A film or a sound starts: a double-click is how a board is opened too, so it is the same gesture.
			const media = hit ? mediaOf(hit.node) : undefined;
			if (hit && media) {
				setPenSelection([hit.id]);
				setPlaying({ id: hit.id, kind: media.kind, file: media.file });
				return;
			}
			// A file's chip opens the file, in a tab of its own.
			if (hit && openFileOf(hit.id)) return;
			// A card opens for typing: at the words, or with a new line in the gap that was double-clicked.
			if (hit && (hit.node.type !== "rectangle" || !cardOf(hit.id)) && openCardAt(hit, toWorld(localCamera, view(), stagePoint(event)), { x: event.clientX, y: event.clientY })) return;
			// A shape's words open for typing, and a shape with none gets them (`openShapeWords`).
			const shape = hit ? shapeOf(hit.id) : undefined;
			if (shape && !(hit && TEXTY.has(hit.node.type))) {
				openShapeWords(shape);
				return;
			}
			if (hit && TEXTY.has(hit.node.type)) {
				openPenText(hit);
				return;
			}
			if (hit && !penSelection().includes(hit.id)) {
				setPenSelection([hit.id]);
				return;
			}
		}
		// Nothing can be added where nothing can be written: a canvas opened from a file.
		if (!props.onCreateBoard && !props.onPenEdit) return;
		/*
		 * Only on the bare stage itself. Not on a board, its title bar, something drawn, or anything
		 * laid over the drawing — the editor a note's words are typed in is one, and a double-click
		 * to pick a word in it opened the menu.
		 */
		if (event.target !== element || pictureUnder(event)) return;
		if (performance.now() - pannedAt < 400) return;
		// A finger's two taps already opened it (`onPointerDown`); a touch screen's own dblclick is the same gesture.
		if (canvasMenu()) return;
		openCanvasMenu(event);
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
			/*
			 * A finger with a tool armed makes the item, as a pencil or a mouse does. A finger on a
			 * drawn item selects it with a tap and moves it once it is selected — the same rule a
			 * board's components follow (`Editor.ts`), so a pan across the drawing never picks
			 * anything up by accident. Both only for the first finger: a second is a pinch.
			 */
			const pen = props.onPenEdit && !props.drawing && touches.count() === 0 && onCanvas(event.target);
			if (pen && penTool() !== "select") {
				penPress(event);
				return;
			}
			// A finger on a board's picture picks the board, and may still pan or pinch, as on its node.
			const picture = event.target === element && touches.count() === 0 && !(pen && pressOnDrawn(event)) ? pictureUnder(event) : undefined;
			if (picture) selectBoard(picture);
			beginTouch(event);
			if (picture) return;
			if (pen && pressOnDrawn(event)) touchOnDrawing(event);
			else if (pen) tapToDeselect(event);
			return;
		}

		/*
		 * The drawing, in either mode: an armed tool makes its item; otherwise a press on an item picks
		 * it up, a shift-press adds it to the selection or takes it out, and a drag on empty canvas
		 * draws a marquee. The camera pans with Space and a drag, the middle button, a scroll or a pinch.
		 */
		/*
		 * A press on a board's picture, where the board has no node (below the live zoom): picked up and
		 * moved as a press on its node does, unless a tool is armed or something drawn is over it.
		 */
		if (event.button === 0 && event.target === element && !spaceHeld() && !props.drawing && (!props.onPenEdit || penTool() === "select") && !penLayer.hitTest(worldAt(event))) {
			const picture = pictureUnder(event);
			if (picture) {
				if (!props.onPenEdit || !dragBoard(picture, event, element)) selectBoard(picture);
				return;
			}
		}
		if (props.onPenEdit && !props.drawing && event.button === 0 && onCanvas(event.target) && !spaceHeld()) {
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
	const restZoom = createMemo<number>((was) => (was !== undefined && (moving() || scaling() || panning() || gliding()) ? was : props.camera.zoom));
	/**
	 * Boards are live: the camera rested at this device's live zoom or above (`INTERACT_ZOOM`, 20%
	 * on a desktop), the same zoom at which a page takes the pointer. Below it a board is its picture
	 * on the sheet (`pen/scene.ts`), which also draws its news glow; above it, it has a document and
	 * the page's own glow, which breathes.
	 */
	const liveZoom = createMemo(() => restZoom() >= INTERACT_ZOOM);
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
	/**
	 * The camera is at the live zoom *now*, not only as of its last rest. `liveZoom` holds the zoom of
	 * the last rest through a gesture, so pages are not dropped and remade mid-gesture; but a page
	 * must never be *started* below the live zoom on its strength. A wheel zoom out from 103% to 3%
	 * whose steps outlasted a movement's end made 377 pages in one task as it finished, still
	 * counting as at 103%, and the page froze for six seconds. One answer for the stage, so a board
	 * re-runs only when it flips.
	 */
	const liveNow = createMemo(() => props.camera.zoom >= INTERACT_ZOOM);
	const boardIndex = createMemo(() => new BoxIndex(props.boards));
	const boardSlot = createMemo(() => new Map(props.boards.map((board, i) => [board.path, i])));
	/** The stage rectangle `isVisible` answers for: the window, and one window more on each side. */
	const reach = () => {
		const v = view();
		const corner = toWorld(props.camera, v, { x: -v.width, y: -v.height });
		return { x: corner.x, y: corner.y, w: (3 * v.width) / props.camera.zoom, h: (3 * v.height) / props.camera.zoom };
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
		 * The stage finds the board under a press itself (`pictureUnder`). Not under the Canvas renderer,
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
		// A kept page stays a node wherever the camera goes, or leaving would unload it.
		for (const path of keptPages()) keep(path);
		if (props.renderer === "dom" && liveZoom()) for (const path of heldPages()) keep(path);
		keep(props.selected);
		keep(props.editing?.path);
		for (const path of boardDrag()?.paths ?? []) keep(path);
		keep(boardResize()?.path);
		// What is drawn on a board rather than in it: an agent's act, a mark, a cursor.
		for (const path of actsByPath().keys()) keep(path);
		for (const mark of props.marks ?? []) keep(mark.path);
		keep(props.cursor?.path);
		const next = [...found]
			.sort((a, b) => a - b)
			.map((at) => boards[at]!)
			.filter((board) => board.path !== props.focus);
		// The same boards as last frame, which is nearly every frame of a pan: the same array, so nothing downstream runs.
		return was && was.length === next.length && next.every((board, i) => board === was[i]) ? was : next;
	});

	/** `rendered`, as a set to look a board up in. */
	const renderedPaths = createMemo(() => new Set(rendered().map((board) => board.path)));

	/**
	 * On screen as of the camera's last rest, with a tenth of the window to spare. A page loaded for
	 * a board just off screen, ready for a pan, sleeps until then (`BoardFrame`, `asleep`): 48
	 * example pages cost 80% of a core at idle shown, and nothing asleep. From the resting camera,
	 * so a pan does not wake and sleep pages under the pointer.
	 */
	const restOnScreen = (board: Board) => {
		const v = view();
		const cam = restCamera();
		const a = toScreen(cam, v, { x: board.x, y: board.y });
		const b = toScreen(cam, v, { x: board.x + board.w, y: board.y + board.h });
		const mx = v.width * 0.1;
		const my = v.height * 0.1;
		return b.x > -mx && a.x < v.width + mx && b.y > -my && a.y < v.height + my;
	};
	/**
	 * WebKit (Safari, and every browser on an iPhone) puts live pages to sleep for the length of a
	 * zoom. It ignores the layer promise that lets Chrome stretch a page's picture while the scale
	 * moves (`[data-scaling]`, `canvas.css`), and draws every page again at every step instead: a
	 * recorded iPhone pinch over one animated board spent 65 to 100ms a frame compositing it. Asleep,
	 * the sheet shows the page's picture and the page stops rendering, still loaded; at rest it wakes
	 * under the picture and takes its place, as a page panned back into view does.
	 */
	const sleepOnZoom = createMemo(() => SLEEP_ON_ZOOM && scaling());
	/** The camera as of its last rest, as `restZoom` is the zoom. */
	const restCamera = createMemo<Camera>((was) => (was !== undefined && (moving() || scaling() || panning() || gliding()) ? was : props.camera));
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
	 * question — and `lastMoved` as a getter, because the gestures write it synchronously in
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
			const a = toScreen(props.camera, v, { x: board.x, y: board.y });
			const b = toScreen(props.camera, v, { x: board.x + board.w, y: board.y + board.h });
			return b.x > 0 && a.x < v.width && b.y > 0 && a.y < v.height;
		},
		ready: (board) => untrack(liveBoards).has(board.path),
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
							pictures={pictures}
							camera={props.camera}
							mounted={
								alone ||
								/* The selected board and the edited one are live at any zoom, on any device. */
								props.selected === board.path ||
								props.editing?.path === board.path ||
								(ONE_LIVE
									? centreBoard() === board.path
									: /*
										 * A page still kept, asleep, wakes as soon as the camera is at the live zoom and it is in
										 * reach, mid-gesture or not: it costs nothing to start again (`keptPages`), and waiting for the
										 * zoom to rest kept a page already loaded behind its picture for another 300 to 400 ms.
										 * Only the DOM renderer keeps pages; under the Canvas renderer a page started mid-pan
										 * blanked the picture it draws into.
										 */
										props.renderer === "dom" && keptPages().has(board.path)
										? liveNow() && isVisible(board)
										: liveZoom() && admission.mayHaveDocument(board) && admission.isMounted(board, liveNow()))
							}
							/*
							 * No title bar in the focus view, and that is a decision rather than an
							 * omission: the bar is canvas furniture — it is how you *identify and
							 * choose* a board among others, and it sits above the board's top edge
							 * where the page's margin is. `visible` gates exactly that bar
							 * (`BoardFrame`), so the page is the document and nothing else, and the
							 * panel still says which board it is.
							 */
							visible={alone ? false : isVisible(board)}
							{...(alone ? {} : { onLive: (on: boolean) => markLive(board.path, on) })}
							kept={!alone && props.renderer === "dom" && keptPages().has(board.path)}
							onDragging={(at) => setOwnDrag(at ? { path: board.path, ...at } : undefined)}
							pictured={onSheet().has(board.path)}
							covering={sleepOnZoom()}
							carried={carriedPages().has(board.path)}
							asleep={!alone && props.renderer === "dom" && props.editing?.path !== board.path && (sleepOnZoom() || (props.selected !== board.path && !restOnScreen(board)))}
							{...(!alone && shotAdaptor().capture ? { capture: (frame: HTMLIFrameElement) => shotAdaptor().capture!(frame, board) } : {})}
							{...(alone ? { origin: { x: 0, y: 0 } } : {})}
							selected={props.selected === board.path}
							{...(!alone && BARS && (barWorth(board) || props.selected === board.path) ? { barLayer: barLayer(), placeBar } : {})}
							{...(!alone && BARS
								? {
										onComment: () =>
											setCommenting({
												path: board.path,
												quote: "",
												title: board.title,
												open: true,
												// Under the bar, which follows the board as the camera moves.
												anchor: () => document.querySelector(`.bar-layer .chrome[data-path="${CSS.escape(board.path)}"]`)?.getBoundingClientRect(),
											}),
									}
								: {})}
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
							onActPoint={actPointOn(board.path)}
							sizing={sizingPaths().has(board.path)}
							news={alone || paged(board) ? props.news?.[board.path] : undefined}
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
							onSelect={() => selectBoard(board.path)}
							drag={(event) => (props.onPenEdit ? dragBoard(board.path, event) : false)}
							shift={boardDrag()?.paths.includes(board.path) ? boardDrag() : undefined}
							resized={boardResize()?.path === board.path ? boardResize() : undefined}
							onHover={(on) => {
								if (on) setHoverBoard(board.path);
								else if (untrack(hoverBoard) === board.path) setHoverBoard(undefined);
							}}
							{...(props.onExtent ? { onExtent: (extent) => props.onExtent?.(board.path, extent) } : {})}
							onMove={(x, y) => props.onMove(board.path, x, y)}
							{...(props.onResize ? { onResize: (size) => props.onResize?.(board.path, size) } : {})}
							{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
							onOpen={() => pushCamera(frame([boxOf(board)]))}
							{...(props.onFocusBoard ? { focused: props.focus === board.path, onFocus: () => props.onFocusBoard?.(board.path) } : {})}
						/>
);


	/*
	 * Boards whose size just changed from outside a drag (`fit`, an agent's `resize`, a write that
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
		const held = boardResize()?.path;
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

	/*
	 * The agents' cursors, one per agent, on the stage rather than on a board. A board says where
	 * on it the cursor stands for its act (`onActPoint`); a drawing act says it with the boxes it
	 * touched. Kept per agent for as long as the page is open, so an agent's cursor is one element
	 * that glides from a board to a drawn item to the next board, and fades when it has nothing.
	 */
	const [actPoints, setActPoints] = createSignal<Record<string, { path: string; x: number; y: number }>>({});
	const actPointOn = (path: string) => (agentId: string, at: { x: number; y: number } | undefined) =>
		setActPoints((points) => {
			const known = points[agentId];
			if (!at) {
				if (known?.path !== path) return points;
				const { [agentId]: _gone, ...rest } = points;
				return rest;
			}
			if (known && known.path === path && known.x === at.x && known.y === at.y) return points;
			return { ...points, [agentId]: { path, x: at.x, y: at.y } };
		});
	const stagePenPath = () => (props.stageName ? `stages/${props.stageName}/stage.pen` : undefined);
	const cursorAgents = createMemo<string[]>((seen) => {
		const ids = Object.keys(props.acts ?? {}).filter((id) => props.acts?.[id] && !seen.includes(id));
		return ids.length > 0 ? [...seen, ...ids] : seen;
	}, []);
	const cursorOf = (agentId: string): CursorAt | undefined => {
		const act = props.acts?.[agentId];
		if (!act) return undefined;
		const label = props.agentLabel?.(agentId, act.label) ?? act.label;
		if (act.what === "draw") {
			const box = act.boxes?.[0];
			if (!box || act.path !== stagePenPath()) return undefined;
			const w = box.x2 - box.x1;
			const h = box.y2 - box.y1;
			return { x: box.x1 + Math.min(14, Math.max(4, w / 2)), y: box.y1 + Math.min(12, Math.max(4, h / 2)), label, color: act.color, key: act.at };
		}
		const board = props.boards.find((one) => one.path === act.path);
		if (!board) return undefined;
		const point = actPoints()[agentId];
		const at = point?.path === act.path ? point : cursorFor(act, [], board);
		return { x: board.x + at.x, y: board.y + at.y, label, color: act.color, key: act.at };
	};
	/** What agents just drew on this stage, outlined in their colours. */
	const drawActs = createMemo(() => Object.values(props.acts ?? {}).filter((act): act is AgentAct => !!act && act.what === "draw" && act.path === stagePenPath()));

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
			data-pen-tool={props.onPenEdit && !props.drawing && penTool() !== "select" ? penTool() : undefined}
			data-scaling={scaling() && rendered().filter(isVisible).length <= LAYER_BUDGET}
			data-gliding={gliding()}
			/* The camera rests at or above this device's live zoom: boards have pages and take the pointer. */
			data-live={liveZoom() ? "true" : undefined}
			data-moving={moving() || panning() || gliding() ? "true" : undefined}
			/* A board being moved or sized: its title bars and news glows step aside until it lands (`canvas.css`). */
			data-carrying={boardDrag() || boardResize() || ownDrag() ? "true" : undefined}
			ref={element}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			onPointerMove={onHover}
			onPointerLeave={() => {
				setHoverId(undefined);
				setOverLink(false);
			}}
			onDblClick={onDblClick}
			style={{ cursor: spaceHeld() ? "grab" : overLink() ? "pointer" : undefined }}
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
			<div class="world" data-sizing={sizingPaths().size > 0 ? "true" : undefined} data-hidden={props.focus ? "true" : undefined} inert={props.focus ? true : undefined} ref={worldEl}>
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
				<canvas class="stage-sheet" aria-hidden="true" hidden ref={(canvas) => penLayer.attach(canvas)} />
				<svg class="pen-hits" aria-hidden="true" width="1" height="1" ref={(svg) => penLayer.attachHits(svg)} />
				{/* By index, not by box: a drag makes a new box every move, and a new element for it every
				    move made the page restyle what it holds (`Index` keeps the element and moves it). */}
				{/* Keyed on the act's clock, so a second drawing act on the same item flashes again. */}
				<For each={drawActs()}>
					{(act) => (
						<For each={act.boxes ?? []}>
							{(box) => (
								<div
									class="act-draw"
									style={{ left: `${box.x1}px`, top: `${box.y1}px`, width: `${box.x2 - box.x1}px`, height: `${box.y2 - box.y1}px`, "--act": act.color, "--zoom": props.camera.zoom }}
								/>
							)}
						</For>
					)}
				</For>
				<For each={cursorAgents()}>{(agentId) => <AgentCursor cursor={cursorOf(agentId)} zoom={props.camera.zoom} />}</For>
				<Index each={penOutlines()}>
					{(box) => (
						<div
							class="pen-selection"
							data-board={box().id.startsWith("board:") ? "true" : undefined}
							data-sizing={box().id.startsWith("board:") && sizingPaths().has(box().id.slice(6)) ? "true" : undefined}
							data-round={rounded(box().id) ? "true" : undefined}
							style={{
								left: `${box().x}px`,
								top: `${box().y}px`,
								width: `${box().w}px`,
								height: `${box().h}px`,
								"box-shadow": `0 0 0 ${1.5 / props.camera.zoom}px var(--color-accent)`,
							}}
						/>
					)}
				</Index>
				<Show when={hoverBox()}>
					{(box) => (
						<div
							class="pen-hover"
							data-board={"board" in box() ? "true" : undefined}
							data-round={"id" in box() && rounded((box() as { id: string }).id) ? "true" : undefined}
							style={{
								left: `${box().x}px`,
								top: `${box().y}px`,
								width: `${box().w}px`,
								height: `${box().h}px`,
								"box-shadow": `0 0 0 ${1.5 / props.camera.zoom}px var(--color-accent)`,
							}}
						/>
					)}
				</Show>
				<For each={joinHint()}>
					{(box) => (
						<div
							class="pen-join"
							style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, "box-shadow": `0 0 0 ${2 / props.camera.zoom}px var(--color-accent)` }}
						/>
					)}
				</For>
				{/*
				 * What a live drag would drop into: the frame under the pointer, in the same outline an
				 * arrow's end uses to say what it would join. The one thing that makes the gesture
				 * legible — without it, whether an item joined a frame is only knowable after letting go.
				 */}
				<Show when={dropBox()}>
					{(box) => (
						<div
							class="pen-join"
							data-drop="frame"
							style={{ left: `${box().x}px`, top: `${box().y}px`, width: `${box().w}px`, height: `${box().h}px`, "box-shadow": `0 0 0 ${2 / props.camera.zoom}px var(--color-accent)` }}
						/>
					)}
				</Show>
				{/* And where in it: the boundary between two of its children that the drop would take. */}
				<Show when={dropAt()}>
					{(slot) => (
						<div
							class="pen-insert"
							style={{
								left: `${slot().line.x - (slot().line.w === 0 ? 1.5 / props.camera.zoom : 0)}px`,
								top: `${slot().line.y - (slot().line.h === 0 ? 1.5 / props.camera.zoom : 0)}px`,
								width: `${Math.max(slot().line.w, 3 / props.camera.zoom)}px`,
								height: `${Math.max(slot().line.h, 3 / props.camera.zoom)}px`,
							}}
						/>
					)}
				</Show>
				<For each={sideHint()}>
					{(hint) => (
						<For each={ARROW_SIDES}>
							{(side) => {
								const [x, y] = sidePoint(hint.box, side);
								const size = () => ((hint.side === side ? 12 : 8) / props.camera.zoom);
								return <div class="pen-side" data-on={hint.side === side ? "true" : undefined} style={{ left: `${x - size() / 2}px`, top: `${y - size() / 2}px`, width: `${size()}px`, height: `${size()}px`, "border-width": `${1.5 / props.camera.zoom}px` }} />;
							}}
						</For>
					)}
				</For>
				{/*
					The four places an arrow can leave a selected item from, just outside the middle of each
					side: a drag from one draws an arrow that keeps to that side (`penCreate`).
				*/}
				<Show when={penAnchors()}>
					{(box) => (
						<For each={ARROW_SIDES}>
							{(side) => {
								const gap = () => 14 / props.camera.zoom;
								const size = () => (coarse ? 16 : 10) / props.camera.zoom;
								const at = () => {
									const [x, y] = sidePoint(box(), side);
									const [nx, ny] = side === "top" ? [0, -1] : side === "bottom" ? [0, 1] : side === "left" ? [-1, 0] : [1, 0];
									return { x: x + nx * gap(), y: y + ny * gap() };
								};
								return (
									<div
										class="pen-anchor"
										data-side={side}
										title="Drag to draw an arrow from this side"
										style={{ left: `${at().x - size() / 2}px`, top: `${at().y - size() / 2}px`, width: `${size()}px`, height: `${size()}px`, "border-width": `${1.5 / props.camera.zoom}px` }}
										onPointerDown={(event) => {
											if (event.button !== 0) return;
											event.preventDefault();
											event.stopPropagation();
											const start = sidePoint(box(), side);
											penCreate(event, "arrow", { x: start[0], y: start[1] }, { name: box().id, box: { x: box().x, y: box().y, w: box().w, h: box().h }, side });
										}}
									/>
								);
							}}
						</For>
					)}
				</Show>
				<Show when={guides().length > 0}>
					<svg class="pen-guides" width="1" height="1" overflow="visible" aria-hidden="true">
						<For each={guides()}>
							{(guide) => (
								<>
									<line x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2} data-kind={guide.kind} stroke-width={1 / props.camera.zoom} />
									<Show when={guide.kind === "gap"}>
										{(() => {
											const tick = 4 / props.camera.zoom;
											const across = guide.y1 === guide.y2;
											return (
												<>
													<line x1={across ? guide.x1 : guide.x1 - tick} y1={across ? guide.y1 - tick : guide.y1} x2={across ? guide.x1 : guide.x1 + tick} y2={across ? guide.y1 + tick : guide.y1} data-kind="gap" stroke-width={1 / props.camera.zoom} />
													<line x1={across ? guide.x2 : guide.x2 - tick} y1={across ? guide.y2 - tick : guide.y2} x2={across ? guide.x2 : guide.x2 + tick} y2={across ? guide.y2 + tick : guide.y2} data-kind="gap" stroke-width={1 / props.camera.zoom} />
												</>
											);
										})()}
									</Show>
								</>
							)}
						</For>
					</svg>
				</Show>
				<Show when={arrowEnds()}>
					{(ends) => (
						<For each={["from", "to"] as const}>
							{(which) => {
								// A finger needs a bigger end than a mouse does, as the box handles get (`HANDLE_PX`).
								const size = () => (coarse ? 18 : 11) / props.camera.zoom;
								return (
									<div
										class="pen-handle"
										data-end={which}
										style={{
											left: `${ends()[which].x - size() / 2}px`,
											top: `${ends()[which].y - size() / 2}px`,
											width: `${size()}px`,
											height: `${size()}px`,
											"border-radius": "50%",
											"border-width": `${1.5 / props.camera.zoom}px`,
										}}
										onPointerDown={(event) => dragArrowEnd(event, which)}
									/>
								);
							}}
						</For>
					)}
				</Show>
				<Show when={endDraft()}>
					{(line) => (
						<svg class="pen-draft-line" style={{ left: "0px", top: "0px" }} width="1" height="1" overflow="visible">
							<line x1={line().x1} y1={line().y1} x2={line().x2} y2={line().y2} stroke="var(--color-accent)" stroke-width={2 / props.camera.zoom} stroke-dasharray={`${6 / props.camera.zoom}`} />
						</svg>
					)}
				</Show>
				<Show when={penHandles()}>
					{(box) => (
						<For each={HANDLES}>
								{(handle) => {
									const size = () => HANDLE_PX / props.camera.zoom;
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
				{/*
				 * The one player, laid over the item it belongs to.
				 *
				 * A real element because nothing else can play: the canvas draws in a worker and there
				 * is no browser in there. It is the same bargain a board makes — a picture until you
				 * are close and have asked — and it is one element, never a wall of them.
				 */}
				<Show when={playingBox()}>
					{(now) => (
						<div
							class="pen-player"
							data-kind={now().kind}
							style={{
								left: `${now().x}px`,
								top: `${now().y}px`,
								width: `${now().w}px`,
								height: `${now().h}px`,
							}}
						>
							{now().kind === "video" ? (
								<video
									src={deckFileUrl(now().file)}
									controls
									autoplay
									playsinline
									ref={(el) => el.addEventListener("ended", () => setPlaying(undefined))}
								/>
							) : (
								<audio
									src={deckFileUrl(now().file)}
									controls
									autoplay
									ref={(el) => el.addEventListener("ended", () => setPlaying(undefined))}
								/>
							)}
						</div>
					)}
				</Show>
				<Show when={radiusHandle()}>
					{(box) => {
						const live = () => {
							const dragged = penRadius();
							return dragged?.id === box().id ? dragged.radius : box().radius;
						};
						const size = () => HANDLE_PX / props.camera.zoom;
						// Clear of the corner handle itself, and never past the middle of the shape.
						const inset = () => Math.min(Math.max(live(), size()), box().most);
						return (
							<div
								class="pen-handle"
								data-handle="radius"
								title="Drag to round the corners"
								style={{
									left: `${box().x + inset() - size() / 2}px`,
									top: `${box().y + inset() - size() / 2}px`,
									width: `${size()}px`,
									height: `${size()}px`,
									"border-width": `${1.5 / props.camera.zoom}px`,
								}}
								onPointerDown={radiusFrom}
							/>
						);
					}}
				</Show>
				<Show when={boardHandles()}>
					{(box) => (
						<For each={box().slides ? HANDLES.filter((handle) => handle !== "n" && handle !== "s") : HANDLES}>
							{(handle) => {
								const size = () => HANDLE_PX / props.camera.zoom;
								return (
									<div
										class="pen-handle"
										data-handle={handle}
										data-board={box().path}
										style={{
											left: `${box().x + (handle.includes("w") ? 0 : handle.includes("e") ? box().w : box().w / 2) - size() / 2}px`,
											top: `${box().y + (handle.includes("n") ? 0 : handle.includes("s") ? box().h : box().h / 2) - size() / 2}px`,
											width: `${size()}px`,
											height: `${size()}px`,
											"border-width": `${1.5 / props.camera.zoom}px`,
										}}
										onPointerDown={(event) => resizeBoard(event, handle)}
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
					{(open) => {
						const look = open.style;
						const box = () => penTextBox() ?? open.box;
						const cancel = () => {
							const open = penText();
							setPenText(undefined);
							unmuteNow();
							dropTyped();
							if (open?.fresh) props.onPenEdit?.([{ op: "delete", id: open.id }]);
						};
						// A card is typed into as it reads (`pen/CardEditor.tsx`); a text or a note as its words.
						if (look.markdown)
							return (
								<CardEditor
									class="pen-text"
									value={open.value}
									{...(open.insertAt !== undefined ? { insertAt: open.insertAt } : {})}
									{...(open.caretAt ? { caretAt: open.caretAt } : {})}
									{...(open.held ? { held: open.held } : {})}
									base={props.pen?.base ?? ""}
									zoom={props.camera.zoom}
									style={{
										left: `${box().x}px`,
										top: `${box().y}px`,
										width: `${box().w}px`,
										"min-height": `${box().h}px`,
										padding: `${look.pad}px`,
										"font-family": look.font,
										"font-size": `${look.size}px`,
										"--card-size": `${look.size}px`,
										"font-weight": String(look.weight),
										"letter-spacing": `${look.spacing}px`,
										"line-height": look.line === undefined ? "1.5" : String(look.line),
										color: look.ink,
										background: look.paper ?? "transparent",
										"border-radius": `${NOTE_RADIUS}px`,
										"box-shadow": `0 0 0 ${1.5 / props.camera.zoom}px var(--color-accent)`,
									}}
									onInput={(value) => previewTyped(open.id, value)}
									onCommit={commitPenText}
									onCancel={cancel}
								/>
							);
						return (
							<textarea
								class="pen-text"
								data-grows={look.grows}
								spellcheck={false}
								style={{
									left: `${box().x}px`,
									top: `${box().y}px`,
									...(look.grows === "wide" ? { "min-width": `${box().w + 1}px` } : { width: `${box().w}px` }),
									"min-height": `${box().h}px`,
									padding: `${look.pad}px`,
									"font-family": look.font,
									"font-size": `${look.size}px`,
									"font-weight": String(look.weight),
									"font-style": look.italic ? "italic" : "normal",
									"letter-spacing": `${look.spacing}px`,
									"line-height": look.line === undefined ? "normal" : String(look.line),
									"text-align": look.align as "left",
									color: look.ink,
									background: look.paper ?? "transparent",
									"border-radius": look.paper ? `${NOTE_RADIUS}px` : "2px",
									"box-shadow": `0 0 0 ${1.5 / props.camera.zoom}px var(--color-accent)`,
								}}
								value={open.value}
								ref={(area) => requestAnimationFrame(() => {
									area.focus();
									area.select();
								})}
								onInput={(event) => previewTyped(open.id, event.currentTarget.value)}
								onBlur={(event) => commitPenText(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										cancel();
									} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
										event.preventDefault();
										event.currentTarget.blur();
									}
								}}
							/>
						);
					}}
				</Show>
			</div>
			<Show when={canvasMenu()} keyed>
				{(menu) => (
					<div
						class="popover canvas-menu"
						role="menu"
						aria-label="Add to the canvas"
						style={{
							// Its left edge at the point, as a dropdown's is at its button's, and kept on the screen.
							left: `${Math.max(8, Math.min(menu.client.x, window.innerWidth - 228))}px`,
							top: `${menu.client.y}px`,
							width: "220px",
							// Above the point in the lower half of the screen, under it in the upper half.
							transform: menu.client.y > window.innerHeight / 2 ? "translateY(calc(-100% - 12px))" : "translateY(12px)",
						}}
					>
						<Show when={props.onCreateBoard}>
							<button type="button" role="menuitem" data-row data-flat="true" data-new-board="board" onClick={() => boardFromMenu("board")}>
								<span class="row-icon">
									<Icon of={FilePlus} size={15} />
								</span>
								<span class="row-label">Board</span>
								<span class="row-note">.html</span>
							</button>
							<button type="button" role="menuitem" data-row data-flat="true" data-new-board="slides" onClick={() => boardFromMenu("slides")}>
								<span class="row-icon">
									<Icon of={Presentation} size={15} />
								</span>
								<span class="row-label">Slides</span>
								<span class="row-note">.slides.html</span>
							</button>
							<Show when={props.onPenEdit}>
								<div class="rule" aria-hidden="true" />
							</Show>
						</Show>
						<Show when={props.onPenEdit}>
						<For each={TOOLS}>
							{(entry) => (
								<button type="button" role="menuitem" data-row data-flat="true" data-tool={entry.tool} onClick={() => pickFromMenu(entry.tool as Exclude<PenTool, "select">)}>
									<span class="row-icon">
										<Icon of={entry.icon} size={15} />
									</span>
									<span class="row-label">{entry.label.split(":")[0]}</span>
								</button>
							)}
						</For>
						</Show>
					</div>
				)}
			</Show>
			<Show when={insertPanel()}>
				{(open) => <Insert open={open()} onPick={insertPicked} onClose={() => setInsertPanel(undefined)} />}
			</Show>
			{/*
				Boards have no title bars: the selected board's name and actions are a pill over it
				(`BoardCallout`), on every device. Kept mounted through a movement and only hidden, so a
				drag that began on its grip keeps the element it captured the pointer on.
			*/}
			{/* The boards' title bars: over the canvas, and not zoomed with it (`placeBar` above). */}
			<div
				class="bar-layer"
				data-hidden={props.focus ? "true" : undefined}
				data-low={untrack(() => props.camera.zoom) < BAR_ZOOM ? "true" : "false"}
				data-moving={boardDrag() || boardResize() || ownDrag() ? "true" : undefined}
				ref={(el) => (barOuter = el)}
			>
				<div class="bar-track" ref={setBarLayer} />
			</div>
			<Show when={!BARS && !props.focus && !props.drawing ? calloutBoard() : undefined} keyed>
				{(board) => (
					<BoardCallout
						board={board}
						hidden={moving() || panning() || scaling() || gliding() || !!boardDrag() || !!boardResize() || !!ownDrag()}
						camera={props.camera}
						view={view()}
						onOpen={() => pushCamera(frame([boxOf(board)]))}
						{...(props.onFocusBoard ? { onFocus: () => props.onFocusBoard?.(board.path) } : {})}
						{...(props.onPresent ? { onPresent: () => props.onPresent?.(board.path, board.format === "slides" ? (deckIn(board.path)?.current() ?? 0) : 0) } : {})}
						{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
						onComment={() =>
							setCommenting({
								path: board.path,
								quote: "",
								title: board.title,
								open: true,
								// Under the pill, which follows the board as the camera moves.
								anchor: () => document.querySelector(".stage > .board-callout")?.getBoundingClientRect(),
							})
						}
					/>
				)}
			</Show>
			<Show when={props.drawing && props.onPenEdit && !props.focus}>
				<StageInk
					camera={props.camera}
					view={view()}
					toStage={(event) => toWorld(localCamera, view(), stagePoint(event))}
					strokes={inkStrokes}
					layer={penLayer}
					onEdit={(ops) => penEdit(ops)}
					colourEdit={() => inkVariableEdit(props.pen?.doc)}
					newId={freshId}
					onShift={(ids, dx, dy) => penMoveBy(ids, dx, dy)}
					{...(props.onPenStep ? { onStep: props.onPenStep } : {})}
				/>
			</Show>
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
