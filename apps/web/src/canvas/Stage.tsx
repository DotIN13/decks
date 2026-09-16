import type { Board, Camera, ChatItem, WebStatus } from "@decks/protocol";
import X from "lucide-solid/icons/x";
import { Icon } from "../ui/icons.tsx";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { boxOf, fit, fitInto, INTERACT_ZOOM, pan, pinchCamera, toScreen, zoomAbout, type Viewport } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { checkStageOrigin, stagePoint } from "../camera/coords.ts";
import { BoardFrame, type BoardEditing } from "./BoardFrame.tsx";
import type { EditorHost, Tool } from "./Editor.ts";
import type { FileDropHost } from "./file-drop.ts";
import type { FrameGestureHost } from "./frame-gestures.ts";
import { zoomKey } from "./zoom-keys.ts";
import { deckMode, type DeckHandle, type SlideAction, slideKey } from "./slide-keys.ts";
import { cssEscape } from "./inspect.ts";
import type { LiveWebReply } from "./live-chat.ts";
import { createEdgeSwipe } from "./edge-swipe.ts";
import { PALETTE } from "@decks/board-kit";
import { createTouches, type Finger, type TouchStep } from "./touch.ts";
import type { RendererChoice } from "../lib/renderer.ts";
import { createRedrawQueue } from "./redraw-queue.ts";
import { openThumbnails } from "./thumb-budget.ts";
import { createAdmission } from "./board-admission.ts";
import { createOneCanvas } from "./one-canvas.ts";

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
	/** Every board on screen at the open has been let in, so less urgent documents may start. */
	onBoardsStarted?: () => void;
	boards: Board[];
	camera: Camera;
	setCamera: (camera: Camera) => void;
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
	/** The same, named by a board: the button in its own title bar (`canvas/BoardFrame.tsx`). */
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
	onHide?: (path: string) => void;
	/** Per-board reload counters, from `stage.reload`. */
	nonces?: Record<string, number>;
	cursor?: { path: string; x: number; y: number; label: string; color: string } | null;
	/** Every agent's annotations, across all boards. Each frame takes the ones that are its. */
	marks?: import("./annotations.ts").Mark[];
	/** So the server can answer `stage.camera()` with what the user can see. */
	onViewport?: (viewport: Viewport) => void;
	/** How much room a board's content took, measured in its frame once it had mounted. */
	onExtent?: (path: string, extent: { rev: number; w: number; h: number }) => void;
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
		 * about slides (`canvas/Present.tsx`). A document wants the window; a component board
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

	const writeTransform = (cam: Camera) => {
		const v = view();
		worldEl.style.transform = `translate(${v.width / 2}px, ${v.height / 2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
		oneCanvas.requestPicture();
	};

	/**
	 * Say the scale is moving, and arrange to notice when it stops.
	 *
	 * The tail matters: a pinch delivers its steps as separate events with nothing to mark
	 * the end of the *scaling* in particular, and dropping the layers between two frames of
	 * one gesture would pay for them twice. 300ms is longer than any gap inside a gesture
	 * and shorter than anyone would notice holding.
	 */
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
	 * separate view with its own scroll box and its own zoom (`canvas/FocusView.tsx` explains
	 * why). So the zoom lives here, because the stage is what owns the frame's wiring and the
	 * gesture host the view's frame reports to.
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

	const pushCamera = (cam: Camera) => {
		if (cam.zoom !== localCamera.zoom) nowScaling();
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

	// Sync from external camera changes (fit, server, initial load) and viewport resizes.
	// Gesture handlers use pushCamera directly for the fast path.
	createEffect(() => {
		localCamera = props.camera;
		writeTransform(props.camera);
	});

	onCleanup(() => {
		if (rafId !== undefined) cancelAnimationFrame(rafId);
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
		if (event.target === element) props.onSelect(undefined);
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
			 * And a plain double-click on a *field* board — a placed one, or a flow document this app
			 * did not write — is nobody's: the run of words under the pointer is the in-frame field
			 * editor's, and the document around it has no editor. This used to open a second editor
			 * that wrote ops off a GrapesJS model; that editor drew the board as a stack of blocks
			 * and refused most of the writes it did make, so the answer is `false` and the honest way
			 * to edit one of these as a document is ⌥ and the text.
			 */
			if (!alt && (board.format === "component" || (board.format === "flow" && !board.shell))) return false;
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

		const middle = event.button === 1;
		const emptySpace = event.button === 0 && event.target === element;
		if (!middle && !emptySpace && !(spaceHeld() && event.button === 0)) return;

		event.preventDefault();
		if (emptySpace) props.onSelect(undefined);
		element.setPointerCapture(event.pointerId);
		setPanning(true);

		let last = { x: event.clientX, y: event.clientY };
		const move = (moveEvent: PointerEvent) => {
			pushCamera(pan(localCamera, moveEvent.clientX - last.x, moveEvent.clientY - last.y));
			last = { x: moveEvent.clientX, y: moveEvent.clientY };
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
		renderer: () => props.renderer,
		stage: () => element,
		queue: redraws,
	});


	// Fit everything the first time boards arrive, so the deck opens looking at
	// itself rather than at world origin.
	let fitted = false;
	createEffect(() => {
		if (fitted || props.boards.length === 0 || view().width === 0) return;
		fitted = true;
		props.setCamera(frame(props.boards.map(boxOf)));
	});

	/*
	 * One board, as the canvas draws it: the frame, its title bar, its marks, its editor.
	 *
	 * A function because the focus view renders exactly one of these in a different box
	 * (`canvas/FocusView.tsx`), and two copies of this — forty props, every wire the board
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
							onSelect={() => props.onSelect(board.path)}
							{...(props.onExtent ? { onExtent: (extent) => props.onExtent?.(board.path, extent) } : {})}
							onMove={(x, y) => props.onMove(board.path, x, y)}
							{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
							onOpen={() => pushCamera(frame([boxOf(board)]))}
							{...(props.onFocusBoard ? { focused: props.focus === board.path, onFocus: () => props.onFocusBoard?.(board.path) } : {})}
						/>
);

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
			data-scaling={scaling() && props.boards.filter(isVisible).length <= LAYER_BUDGET}
			ref={element}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
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
							title="Leave the focus view — Esc"
							aria-label="Leave the focus view"
							onClick={() => props.onFocusToggle?.()}
						>
							<Icon of={X} size={13} />
							<span>Esc</span>
						</button>
					</>
				)}
			</Show>
		</div>
	);
}
