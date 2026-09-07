import type { Board, Camera, ChatItem } from "@decks/protocol";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { boxOf, fit, fitInto, INTERACT_ZOOM, pan, pinchCamera, toScreen, zoomAbout, type Viewport } from "../lib/camera.ts";
import { canvasBox } from "../lib/insets.ts";
import { BoardFrame } from "./BoardFrame.tsx";
import type { EditorHost, Tool } from "./Editor.ts";
import type { FileDropHost } from "./file-drop.ts";
import type { FrameGestureHost } from "./frame-gestures.ts";
import { zoomKey } from "./zoom-keys.ts";
import { deckMode, type DeckHandle, type SlideAction, slideKey } from "./slide-keys.ts";
import { cssEscape } from "./inspect.ts";
import { createEdgeSwipe } from "./edge-swipe.ts";
import { createTouches, type Finger, type TouchStep } from "./touch.ts";

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
		const node = element?.querySelector(`.board-node[data-path="${cssEscape(path)}"] iframe`) as HTMLIFrameElement | null;
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
	createEffect(() => {
		const mode = deckMode(props.camera.zoom, INTERACT_ZOOM);
		for (const board of props.boards) {
			if (board.format !== "slides") continue;
			deckIn(board.path)?.setMode(mode);
		}
	});

	const centre = () => ({ x: view().width / 2, y: view().height / 2 });

	const writeTransform = (cam: Camera) => {
		const v = view();
		worldEl.style.transform = `translate(${v.width / 2}px, ${v.height / 2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
	};

	const pushCamera = (cam: Camera) => {
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

	/** Where the pointer is, in stage coordinates rather than page ones. */
	const local = (event: { clientX: number; clientY: number }) => {
		const rect = element.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
		const rect = element.getBoundingClientRect();
		return { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
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
		element.removeEventListener("pointermove", onTouchMove);
		element.removeEventListener("pointerup", onTouchEnd);
		element.removeEventListener("pointercancel", onTouchEnd);
	};

	const beginTouch = (event: PointerEvent) => {
		// A tap on bare canvas clears the selection, exactly as a click does. Decided on
		// the way down rather than on the way up: a pan that starts on empty stage is not
		// a gesture that wants to keep a component selected either.
		if (event.target === element) props.onSelect(undefined);
		if (carried.size === 0) {
			element.addEventListener("pointermove", onTouchMove);
			element.addEventListener("pointerup", onTouchEnd);
			element.addEventListener("pointercancel", onTouchEnd);
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
	 * Which boards get a live document.
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
			data-previewing={Boolean(props.preview)}
			data-panning={panning()}
			ref={element}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			style={{ cursor: spaceHeld() ? "grab" : undefined }}
		>
			<div
				class="world"
				ref={worldEl}
			>
				<For each={props.boards} fallback={null}>
					{(board) => (
						<BoardFrame
							board={board}
							camera={props.camera}
							mounted={isVisible(board)}
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
