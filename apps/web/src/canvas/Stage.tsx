import type { Board, Camera, ChatItem, WebStatus } from "@decks/protocol";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { boxOf, fit, fitInto, INTERACT_ZOOM, pan, pinchCamera, toScreen, zoomAbout, type Viewport } from "../lib/camera.ts";
import { canvasBox } from "../lib/insets.ts";
import { BoardFrame } from "./BoardFrame.tsx";
import type { EditorHost, Tool } from "./Editor.ts";
import type { FileDropHost } from "./file-drop.ts";
import type { FrameGestureHost } from "./frame-gestures.ts";
import { zoomKey } from "./zoom-keys.ts";
import { deckMode, type DeckHandle, type SlideAction, slideKey } from "./slide-keys.ts";
import { cssEscape } from "./inspect.ts";
import type { LiveWebReply } from "./live-chat.ts";
import { createEdgeSwipe } from "./edge-swipe.ts";
import { createTouches, type Finger, type TouchStep } from "./touch.ts";
import type { RendererChoice } from "../lib/renderer.ts";
import { createRedrawQueue } from "./redraw-queue.ts";
import { canvasPixelRatio, drawScale, elementContext, needsRedraw, type PaintEvent, type PictureHost, pictureSize } from "./picture.ts";

/** The palette's keys, in the order the palette draws them. */
const TOOL_KEYS: Record<string, Tool> = { v: "select", s: "sticky", c: "card", t: "text", e: "embed" };

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
	boards: Board[];
	camera: Camera;
	setCamera: (camera: Camera) => void;
	selected?: string;
	/** Take a deck fullscreen: the app owns the overlay, the stage only asks for it. */
	onPresent?: (path: string, at: number) => void;
	/** Open a flow or slides board as its own source. */
	onEditSource?: (path: string) => void;
	/** The board currently being edited as text, and how to finish. */
	editing?: { path: string; editing: { source: string; onCommit: (text: string) => void; onCancel: () => void } };
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
	let rafId: number | undefined;
	let pendingCamera: Camera | undefined;
	const [view, setView] = createSignal<Viewport>({ width: 0, height: 0 });
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
	 * `lib/insets.ts` is the only thing that knows how much that is.
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
				else pushCamera(zoomAbout(localCamera, view(), centre(), zoom === "in" ? 1.2 : 1 / 1.2));
				event.preventDefault();
				return;
			}
			const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
			if (typing) return;
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
		if (board?.format !== "slides") return false;
		if (action === "present") {
			props.onPresent?.(path, deckIn(path)?.current() ?? 0);
			return true;
		}
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

	const centre = () => ({ x: view().width / 2, y: view().height / 2 });

	const writeTransform = (cam: Camera) => {
		const v = view();
		worldEl.style.transform = `translate(${v.width / 2}px, ${v.height / 2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
		requestPicture();
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
	 * Where the stage sits in the window, read at most every quarter second.
	 *
	 * Every gesture converts client coordinates to stage ones, and `getBoundingClientRect`
	 * on every event is a forced layout on every event — free while nothing is dirty, and
	 * a full layout of every board's title bar during a pinch, when they are. The stage is
	 * the window minus nothing (`inset: 0` inside `.work`), so it moves only when the
	 * window does, and a reading a few hundred milliseconds old is the same reading.
	 */
	let origin = { left: 0, top: 0, at: Number.NEGATIVE_INFINITY };
	const stageOrigin = () => {
		const now = performance.now();
		if (now - origin.at > 250) {
			const rect = element.getBoundingClientRect();
			origin = { left: rect.left, top: rect.top, at: now };
		}
		return origin;
	};

	/** Where the pointer is, in stage coordinates rather than page ones. */
	const local = (event: { clientX: number; clientY: number }) => {
		const at = stageOrigin();
		return { x: event.clientX - at.left, y: event.clientY - at.top };
	};

	/**
	 * One wheel gesture, wherever it came from.
	 *
	 * The stage calls this with its own events; a board frame calls it through
	 * `frame-gestures.ts`, because a wheel event inside an iframe never reaches this
	 * document at all. Positions arrive already in stage coordinates.
	 */
	const wheel = (gesture: { x: number; y: number; deltaX: number; deltaY: number; zooming: boolean }) => {
		if (gesture.zooming) {
			/*
			 * A pinch arrives as a stream of small deltas and a ⌘-wheel notch as one
			 * delta of 100 or more, so the exponential is clamped: without it, the
			 * pinch is right and one notch of the wheel jumps 2.7x.
			 */
			const factor = Math.min(1.3, Math.max(1 / 1.3, Math.exp(-gesture.deltaY / 300)));
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
		const at = stageOrigin();
		return { id: event.pointerId, x: event.clientX - at.left, y: event.clientY - at.top };
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
		pan: (dx, dy) => pushCamera(pan(localCamera, dx, dy)),
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
		 * A double-click inside a board that has no components: edit the file.
		 *
		 * Answered here because the stage knows the board's format and the board does not.
		 * Returning false is what lets a component board's double-click carry on to the
		 * editor that selects a box.
		 */
		editSource: () => {
			const path = props.selected;
			const board = props.boards.find((candidate) => candidate.path === path);
			if (!path || !board || board.format === "component" || !props.onEditSource) return false;
			props.onEditSource(path);
			return true;
		},
		zoom: (direction) => {
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
	 * How long a board that has left the screen keeps its document.
	 *
	 * Visibility decides which boards *get* a document; this decides when one is taken
	 * away, and the two are deliberately not the same moment. Zooming in on a phone puts
	 * every other board outside the margin within a few steps, and zooming back out brings
	 * them all back — so a document was torn down in the middle of one gesture and parsed
	 * again in the middle of the next: `board.css`, `board.js`, KaTeX, Mermaid, for every
	 * board, while the finger was still moving. Measured on 17 boards at 4× CPU throttle,
	 * a wheel zoom in and out spent 37ms per step in `Document::shutdown` alone and more
	 * again re-parsing, against 8ms of everything else.
	 *
	 * So a board that leaves the screen is kept until it has been gone for a few seconds
	 * **and the camera has been still for one** — a document is never let go in the middle
	 * of a gesture, however long the gesture. A board zoomed away from and back to costs
	 * nothing the second time; a board really left behind is let go once the canvas is
	 * quiet, from an idle callback rather than from inside whatever the user is doing
	 * then. The memory cost is bounded by how many boards one gesture can pass over.
	 */
	const KEEP_MS = 3000;
	/** How long the camera has to have been still before a document is taken away. */
	const QUIET_MS = 1000;
	const lastSeen = new Map<string, number>();
	let lastMoved = 0;
	const [sweep, setSweep] = createSignal(0);
	let sweeper: ReturnType<typeof setTimeout> | undefined;
	const sweepLater = (after: number) => {
		if (sweeper !== undefined) return;
		sweeper = setTimeout(() => {
			sweeper = undefined;
			const still = performance.now() - lastMoved;
			// Not yet: the camera is moving. Ask again once it has had time to stop.
			if (still < QUIET_MS) return sweepLater(QUIET_MS - still + 50);
			const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
			if (idle) idle(() => setSweep((n) => n + 1), { timeout: 1000 });
			else setSweep((n) => n + 1);
		}, after);
	};
	onCleanup(() => clearTimeout(sweeper));

	/** Whether a board has a document: on screen now, or was within the last `KEEP_MS`. */
	const isMounted = (board: Board): boolean => {
		void sweep();
		const now = performance.now();
		if (isVisible(board)) {
			lastSeen.set(board.path, now);
			return true;
		}
		const seen = lastSeen.get(board.path);
		if (seen === undefined) return false;
		const gone = now - seen;
		const still = now - lastMoved;
		/*
		 * Both conditions, here as well as in the timer: this runs on every camera change,
		 * and a board whose grace ran out mid-gesture must not be dropped by the very step
		 * that asked. Come back once both have passed, so the document is let go then.
		 */
		if (gone < KEEP_MS || still < QUIET_MS) {
			sweepLater(Math.max(KEEP_MS - gone, QUIET_MS - still) + 50);
			return true;
		}
		return false;
	};


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
	 * One canvas for the stage, and a darkroom behind it.
	 *
	 * `drawElementImage` can only take an immediate child of the canvas it draws into, and
	 * it repaints the whole document on every call — so a stage that drew every board on
	 * every frame was measured at 21ms a pan step for 16 boards, 95ms at 4× CPU throttle,
	 * against the DOM renderer at the frame floor. Instead each board is drawn **once** into
	 * a hidden canvas of the same kind (the darkroom, whose children the documents are),
	 * copied out as a bitmap at the zoom it was captured for, and from then on the visible
	 * canvas only copies bitmaps: a pan is sixteen `drawImage` calls, a pinch stretches them,
	 * and the camera resting is what asks for new captures.
	 *
	 * A bitmap outlives its document. A board whose frame has been let go is still drawn
	 * from the picture it left, which is the one thing this renderer can do that the DOM
	 * one cannot. What it cannot do is let anyone click into a board: Chrome does not yet
	 * hit-test a drawn element where it was drawn, so the documents in the darkroom are
	 * inert and the boards are pictures.
	 */
	let pictureEl: HTMLCanvasElement | undefined;
	let darkroomEl: HTMLCanvasElement | undefined;
	/** Each board as a bitmap, with the size it was captured at. */
	const bitmaps = new Map<string, { bitmap: ImageBitmap; w: number; h: number }>();
	/**
	 * Boards whose document changed while the scale was moving.
	 *
	 * A paint event during a pinch is not acted on — the picture is being stretched and
	 * would be drawn again at rest anyway — but it must not be *lost*: the first version
	 * dropped it, and a board that finished rendering its markdown during the opening fit
	 * kept the blank picture taken at `load` for good, because at rest its size was right
	 * and nothing said its content was not.
	 */
	const stale = new Set<string>();
	let pictureRaf: number | undefined;

	/** Redraw the visible canvas on the next frame, once, however many changes ask. */
	const requestPicture = () => {
		if (props.renderer !== "one-canvas" || pictureRaf !== undefined) return;
		pictureRaf = requestAnimationFrame(() => {
			pictureRaf = undefined;
			drawScene();
		});
	};
	onCleanup(() => {
		if (pictureRaf !== undefined) cancelAnimationFrame(pictureRaf);
		for (const held of bitmaps.values()) held.bitmap.close();
		bitmaps.clear();
	});

	const drawScene = () => {
		const canvas = pictureEl;
		if (!canvas) return;
		const v = view();
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(v.width * dpr));
		const h = Math.max(1, Math.round(v.height * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		// Opaque, in the stage's own colour: the darkroom sits under this canvas at whatever
		// size its last capture needed, and this is what keeps it out of sight.
		ctx.fillStyle = getComputedStyle(element).backgroundColor || "#fff";
		ctx.fillRect(0, 0, w, h);
		// The camera the gestures are moving, not the one committed a frame later — the
		// world transform is written from the same number, and the two must agree.
		const cam = localCamera;
		ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (v.width / 2 - cam.x * cam.zoom), dpr * (v.height / 2 - cam.y * cam.zoom));
		ctx.imageSmoothingQuality = "high";
		for (const board of props.boards) {
			const held = bitmaps.get(board.path);
			if (!held) continue;
			const topLeft = toScreen(cam, v, { x: board.x, y: board.y });
			const bottomRight = toScreen(cam, v, { x: board.x + board.w, y: board.y + board.h });
			if (bottomRight.x < 0 || bottomRight.y < 0 || topLeft.x > v.width || topLeft.y > v.height) continue;
			ctx.drawImage(held.bitmap, board.x, board.y, board.w, board.h);
		}
	};

	/** The darkroom's box, in CSS pixels: the stage, and never anything else (`capture`). */
	const darkroomBox = () => {
		const v = view();
		return { w: Math.max(1, Math.round(v.width)), h: Math.max(1, Math.round(v.height)) };
	};
	/** Its backing store, which is also the largest picture a board's capture may have. */
	const darkroomBacking = (dpr: number) => {
		const box = darkroomBox();
		return { w: Math.max(1, Math.round(box.w * dpr)), h: Math.max(1, Math.round(box.h * dpr)) };
	};

	/** Draw one board's document through the darkroom and keep the result as its picture. */
	const capture = (path: string) => {
		const darkroom = darkroomEl;
		if (!darkroom) return;
		const board = props.boards.find((candidate) => candidate.path === path);
		if (!board) return;
		const frame = darkroom.querySelector(`iframe[data-path="${cssEscape(path)}"]`) as HTMLIFrameElement | null;
		if (!frame) return;
		const ctx = elementContext(darkroom);
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		/*
		 * The darkroom stands at the size of the stage and never changes, and that is
		 * load-bearing twice over.
		 *
		 * A canvas shown at one CSS pixel draws an element into a corner of its backing store
		 * and leaves the rest blank, worse the larger the store — a 940×894 board came out
		 * empty. So it has to be shown at a real size, and the stage is the largest picture
		 * worth taking anyway.
		 *
		 * And a canvas's *box* is laid out, so a box set in this tick is not the one this
		 * draw would use: the element arrives at the ratio from the last rendering update.
		 * Resizing the darkroom per board therefore drew each board at the previous board's
		 * ratio — a 1600-wide board at a 2× screen's ratio came out twice its picture, cropped
		 * to the top-left. Only the backing store changes here, which does take effect at
		 * once, and the picture is cropped out of the corner it was drawn into.
		 */
		const box = darkroomBox();
		if (darkroom.style.width !== `${box.w}px` || darkroom.style.height !== `${box.h}px`) {
			darkroom.style.width = `${box.w}px`;
			darkroom.style.height = `${box.h}px`;
			// Laid out this tick, so it is not the box this draw would be given. Next frame.
			redraws.add(path, () => capture(path));
			return;
		}
		const backing = darkroomBacking(dpr);
		if (darkroom.width !== backing.w || darkroom.height !== backing.h) {
			darkroom.width = backing.w;
			darkroom.height = backing.h;
		}
		const size = pictureSize(board, localCamera.zoom, dpr, backing);
		const ratio = canvasPixelRatio(darkroom);
		const scale = ratio && drawScale(size, frame.getBoundingClientRect(), ratio);
		if (!scale) return;
		try {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, darkroom.width, darkroom.height);
			ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
			ctx.drawElementImage(frame, 0, 0);
		} catch {
			// Not drawable yet — a document a frame away from its first snapshot. Its paint
			// event asks again.
			return;
		}
		// The copy is taken now; only the promise is later.
		void createImageBitmap(darkroom, 0, 0, size.w, size.h)
			.then((bitmap) => {
				bitmaps.get(path)?.bitmap.close();
				bitmaps.set(path, { bitmap, w: size.w, h: size.h });
				requestPicture();
			})
			.catch(() => {});
	};

	/** The browser saying which documents changed since the last frame. */
	const onDarkroomPaint = (event: Event) => {
		const changed = (event as PaintEvent).changedElements;
		const frames = changed ?? [...(darkroomEl?.children ?? [])];
		for (const node of frames) {
			const path = (node as HTMLElement).dataset?.path;
			if (!path) continue;
			if (scaling()) stale.add(path);
			else redraws.add(path, () => capture(path));
		}
	};

	const pictures: PictureHost = {
		queue: redraws,
		get darkroom() {
			return darkroomEl;
		},
		changed: (path) => redraws.add(path, () => capture(path)),
		has: (path) => bitmaps.has(path),
	};

	/*
	 * At rest after a zoom, every board in view whose picture is now the wrong size is
	 * captured again — through the queue, a few per frame. Runs on every camera change and
	 * does nothing on a pan, because `needsRedraw` says the size has not changed.
	 */
	createEffect(() => {
		if (props.renderer !== "one-canvas" || scaling()) return;
		const zoom = props.camera.zoom;
		const dpr = window.devicePixelRatio || 1;
		for (const board of props.boards) {
			if (!isVisible(board)) continue;
			const want = pictureSize(board, zoom, dpr, darkroomBacking(dpr));
			if (stale.has(board.path) || needsRedraw(bitmaps.get(board.path), want)) {
				stale.delete(board.path);
				redraws.add(board.path, () => capture(board.path));
			}
		}
	});

	// A board moved or was resized, or the window did: the scene is drawn from those.
	createEffect(() => {
		void props.boards;
		void view();
		requestPicture();
	});

	// Fit everything the first time boards arrive, so the deck opens looking at
	// itself rather than at world origin.
	let fitted = false;
	createEffect(() => {
		if (fitted || props.boards.length === 0 || view().width === 0) return;
		fitted = true;
		props.setCamera(frame(props.boards.map(boxOf)));
	});

	return (
		<div
			class="stage"
			data-mode={props.mode}
			data-renderer={props.renderer}
			data-previewing={Boolean(props.preview)}
			data-panning={panning()}
			data-scaling={scaling() && props.boards.filter(isVisible).length <= LAYER_BUDGET}
			ref={element}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			style={{ cursor: spaceHeld() ? "grab" : undefined }}
		>
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
						darkroomEl = canvas;
						canvas.addEventListener("paint", onDarkroomPaint);
						onCleanup(() => canvas.removeEventListener("paint", onDarkroomPaint));
					}}
				/>
				<canvas
					class="stage-picture"
					aria-hidden="true"
					ref={(canvas) => {
						pictureEl = canvas;
						requestPicture();
					}}
				/>
			</Show>
			<div
				class="world"
				ref={worldEl}
			>
				<For each={props.boards} fallback={null}>
					{(board) => (
						<BoardFrame
							board={board}
							renderer={props.renderer}
							scaling={scaling()}
							pictures={pictures}
							camera={props.camera}
							mounted={isMounted(board)}
							visible={isVisible(board)}
							selected={props.selected === board.path}
							{...(props.editing?.path === board.path ? { editing: props.editing.editing } : {})}
							{...(board.format === "slides" && props.onPresent
								? { onPresent: () => props.onPresent?.(board.path, deckIn(board.path)?.current() ?? 0) }
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
							{...(props.webStatus ? { webStatus: props.webStatus } : {})}
							{...(props.onWebReply ? { onWebReply: props.onWebReply } : {})}
							onSelect={() => props.onSelect(board.path)}
							{...(props.onExtent ? { onExtent: (extent) => props.onExtent?.(board.path, extent) } : {})}
							onMove={(x, y) => props.onMove(board.path, x, y)}
							{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
							onOpen={() => pushCamera(frame([boxOf(board)]))}
						/>
					)}
				</For>
			</div>
		</div>
	);
}
