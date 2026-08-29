import type { Board, Camera } from "@decks/protocol";
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { boxOf, fit, INTERACT_ZOOM, pan, toScreen, zoomAbout, type Viewport } from "../lib/camera.ts";
import { BoardFrame } from "./BoardFrame.tsx";
import { notePointer } from "../lib/panels.ts";
import type { EditorHost } from "./Editor.ts";
import type { FileDropHost } from "./file-drop.ts";
import type { FrameGestureHost } from "./frame-gestures.ts";

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
 */
export function Stage(props: {
	boards: Board[];
	camera: Camera;
	setCamera: (camera: Camera) => void;
	selected?: string;
	onSelect: (path: string | undefined) => void;
	onMove: (path: string, x: number, y: number) => void;
	onHide?: (path: string) => void;
	/** Per-board reload counters, from `stage.reload`. */
	nonces?: Record<string, number>;
	cursor?: { path: string; x: number; y: number; label: string; color: string } | null;
	/** So the server can answer `stage.camera()` with what the user can see. */
	onViewport?: (viewport: Viewport) => void;
	editor: EditorHost;
	/** A file dropped from the desktop onto a board, per board (`file-drop.ts`). */
	drops: (path: string) => FileDropHost;
	/** Which revision each frame is showing; see `selfEdited` in App. */
	frameRevs?: Record<string, number>;
	/** While previewing a past point: board path -> revision sha to render instead. */
	preview?: Record<string, string>;
}) {
	let element!: HTMLDivElement;
	const [view, setView] = createSignal<Viewport>({ width: 0, height: 0 });
	const [panning, setPanning] = createSignal(false);
	const [spaceHeld, setSpaceHeld] = createSignal(false);

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
			const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
			if (typing) return;
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

	const centre = () => ({ x: view().width / 2, y: view().height / 2 });

	/**
	 * The camera shortcuts, in one place.
	 *
	 * Called from this document's keydown and from a board frame's — a click on a board
	 * puts focus inside its iframe, and a keypress there never reaches the parent, so
	 * without forwarding the shortcuts stopped working the moment anyone touched a
	 * board. Returns whether the key meant anything, so the caller knows to swallow it.
	 */
	const shortcut = (key: string): boolean => {
		switch (key) {
			case "0":
				props.setCamera(fit(props.boards.map(boxOf), view()));
				return true;
			case "1": {
				const board = props.boards.find((candidate) => candidate.path === props.selected) ?? props.boards[0];
				if (board) props.setCamera(fit([boxOf(board)], view()));
				return true;
			}
			case "+":
			case "=":
				props.setCamera(zoomAbout(props.camera, view(), centre(), 1.2));
				return true;
			case "-":
				props.setCamera(zoomAbout(props.camera, view(), centre(), 1 / 1.2));
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
			props.setCamera(zoomAbout(props.camera, view(), { x: gesture.x, y: gesture.y }, factor));
			return;
		}
		props.setCamera(pan(props.camera, -gesture.deltaX, -gesture.deltaY));
	};

	const onWheel = (event: WheelEvent) => {
		event.preventDefault();
		const at = local(event);
		// `ctrlKey` is a trackpad pinch, not a key anybody pressed; `metaKey` is the
		// deliberate mouse-wheel zoom. Everything else is a two-finger scroll.
		wheel({ x: at.x, y: at.y, deltaX: event.deltaX, deltaY: event.deltaY, zooming: event.ctrlKey || event.metaKey });
	};

	/** What a board frame hands back when a canvas gesture starts inside it. */
	const gestures: FrameGestureHost = {
		wheel,
		pan: (dx, dy) => props.setCamera(pan(props.camera, dx, dy)),
		space: (held) => setSpaceHeld(held),
		spaceHeld: () => spaceHeld(),
		interactive: () => props.camera.zoom >= INTERACT_ZOOM,
		pointer: (x) => notePointer(x),
		key: (name) => shortcut(name),
	};

	const onPointerDown = (event: PointerEvent) => {
		const middle = event.button === 1;
		const emptySpace = event.button === 0 && event.target === element;
		if (!middle && !emptySpace && !(spaceHeld() && event.button === 0)) return;

		event.preventDefault();
		if (emptySpace) props.onSelect(undefined);
		element.setPointerCapture(event.pointerId);
		setPanning(true);

		let last = { x: event.clientX, y: event.clientY };
		const move = (moveEvent: PointerEvent) => {
			props.setCamera(pan(props.camera, moveEvent.clientX - last.x, moveEvent.clientY - last.y));
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
		props.setCamera(fit(props.boards.map(boxOf), view()));
	});

	return (
		<div
			class="stage"
			data-previewing={Boolean(props.preview)}
			data-panning={panning()}
			ref={element}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			style={{ cursor: spaceHeld() ? "grab" : undefined }}
		>
			<div
				class="world"
				style={{
					transform: `translate(${view().width / 2}px, ${view().height / 2}px) scale(${props.camera.zoom}) translate(${-props.camera.x}px, ${-props.camera.y}px)`,
				}}
			>
				<For each={props.boards} fallback={null}>
					{(board) => (
						<BoardFrame
							board={board}
							camera={props.camera}
							mounted={isVisible(board)}
							selected={props.selected === board.path}
							nonce={props.nonces?.[board.path]}
							cursor={props.cursor?.path === board.path ? props.cursor : undefined}
							editor={props.editor}
							gestures={gestures}
							drops={props.drops(board.path)}
							showRev={props.frameRevs?.[board.path]}
							previewSha={props.preview?.[board.path]}
							onSelect={() => props.onSelect(board.path)}
							onMove={(x, y) => props.onMove(board.path, x, y)}
							{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
							onOpen={() => props.setCamera(fit([boxOf(board)], view()))}
						/>
					)}
				</For>
			</div>
		</div>
	);
}
