import type { Board, Camera } from "@decks/protocol";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { boardUrl } from "../lib/api.ts";
import { INTERACT_ZOOM } from "../lib/camera.ts";
import { attachEditor, type EditorHost } from "./Editor.ts";
import { attachFrameGestures, type FrameGestureHost } from "./frame-gestures.ts";
import { paintFrame } from "../lib/theme.ts";

/**
 * One board on the stage: a title above it, and the document itself in a frame.
 *
 * The frame is same-origin (DESIGN §4), so from M4 the editor reads and writes
 * `frame.contentDocument` directly. Two things follow already: the board is sized
 * in world units and left to scale with the stage rather than re-laid-out at every
 * zoom, and above `INTERACT_ZOOM` the frame stops taking pointer events so a pan
 * across a board is a pan.
 *
 * The title bar is deliberately outside the surface — a board is a document, not a
 * window, and its own top-left corner belongs to the page. It is also the drag
 * handle, so moving a board never depends on hitting a part of the page that
 * happens to be empty.
 */
export function BoardFrame(props: {
	board: Board;
	camera: Camera;
	mounted: boolean;
	selected: boolean;
	/** Bumped by `stage.reload`, for a change the watcher cannot see. */
	nonce?: number;
	/** Where an agent is pointing, in board coordinates. */
	cursor?: { x: number; y: number; label: string; color: string };
	onSelect: () => void;
	onMove: (x: number, y: number) => void;
	onOpen: () => void;
	/** Take this board off the canvas. It stays in the agent's context. */
	onHide?: () => void;
	/** Editing lives inside the frame, because the frame is same-origin (§4). */
	editor: EditorHost;
	/** Canvas gestures that start inside the frame and belong to the stage. */
	gestures: FrameGestureHost;
	/**
	 * The revision this frame should display, when that is not the newest one — after
	 * this browser's own edit, the DOM is already correct and reloading it would
	 * flash. Undefined means "whatever the board says".
	 */
	showRev?: number;
	/**
	 * A revision to render instead of the file, while the timeline is being previewed.
	 * Read-only by construction: it is a different URL, and the store never changes.
	 */
	previewSha?: string;
}) {
	let detachEditor: (() => void) | undefined;
	let detachGestures: (() => void) | undefined;
	onCleanup(() => {
		detachEditor?.();
		detachGestures?.();
	});

	const [dragging, setDragging] = createSignal(false);
	/** Where the board sits while a drag is in flight, before the server knows. */
	const [ghost, setGhost] = createSignal<{ x: number; y: number } | null>(null);

	const at = () => ghost() ?? { x: props.board.x, y: props.board.y };
	const frameSrc = () => {
		if (props.previewSha) return `/api/revision/${props.previewSha}`;
		// 0 means unpinned: show whatever the board now is.
		const rev = props.showRev && props.showRev > 0 ? props.showRev : props.board.rev;
		const url = boardUrl({ path: props.board.path, rev });
		return props.nonce ? `${url}&r=${props.nonce}` : url;
	};
	const inert = () => props.camera.zoom < INTERACT_ZOOM;

	/**
	 * Point the frame at a URL, but only when that URL actually changed.
	 *
	 * Assigning `src` reloads an iframe *even when the value is identical*, so this cannot
	 * be a plain reactive attribute. `frameSrc` reads `showRev` when the board is pinned
	 * and `board.rev` when it is not, and pinning happens the moment the user edits: the
	 * rev being pinned to is the rev already on screen, so the string does not change but
	 * the dependency does. As a JSX attribute that re-ran the setter and tore down the
	 * document the user was editing — a white flash on every component drag, to show the
	 * bytes the live DOM already had.
	 */
	let frameEl: HTMLIFrameElement | undefined;
	const applySrc = () => {
		const next = frameSrc();
		if (!frameEl || frameEl.getAttribute("src") === next) return;
		frameEl.setAttribute("src", next);
	};
	createEffect(applySrc);

	const startDrag = (event: PointerEvent) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();
		props.onSelect();

		const handle = event.currentTarget as HTMLElement;
		// Pointer capture, so a drag that outruns the cursor keeps dragging rather
		// than stopping the moment the pointer leaves the 24px title bar.
		handle.setPointerCapture(event.pointerId);
		setDragging(true);

		const from = { x: event.clientX, y: event.clientY };
		const origin = { x: props.board.x, y: props.board.y };
		const zoom = props.camera.zoom;

		const move = (moveEvent: PointerEvent) => {
			// Screen delta / zoom, because the board's coordinates are world units:
			// at 0.25 zoom the pointer travels four pixels for every one it moves.
			setGhost({
				x: origin.x + (moveEvent.clientX - from.x) / zoom,
				y: origin.y + (moveEvent.clientY - from.y) / zoom,
			});
		};

		const finish = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", finish);
			handle.removeEventListener("pointercancel", finish);
			setDragging(false);
			const landed = ghost();
			// The ghost stays until the server's board.changed comes back with the
			// new position, or the board would jump home for a frame.
			if (landed) props.onMove(Math.round(landed.x), Math.round(landed.y));
			setGhost(null);
		};

		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
	};

	return (
		<div
			class="board-node"
			data-dragging={dragging()}
			data-selected={props.selected}
			data-inert={inert()}
			data-path={props.board.path}
			style={{
				left: `${at().x}px`,
				top: `${at().y}px`,
				width: `${props.board.w}px`,
				height: `${props.board.h}px`,
			}}
		>
			{/*
				Counter-scaled against the camera, so the title stays legible at any zoom —
				one that shrinks with the board is unreadable exactly when the board is too
				small to identify by its content.

				The identity to keep in mind: this box sits inside a world scaled by `zoom`
				and carries `scale(1/zoom)`, so the two cancel and **its layout size is its
				size on screen**. Height and width are therefore written in screen pixels
				(24, and the board's on-screen width). `top` is the exception: it positions
				the layout box *before* the transform, and the transform's origin is the
				box's bottom-left — so the constant part is the 24 the box will occupy, and
				only the visual gap needs dividing by the zoom.

				Asking for `24 / zoom` here made the bar 88px tall at 27% zoom, which is why
				it appeared to drift off the boards as they shrank.
			*/}
			<div
				class="chrome"
				style={{
					transform: `scale(${1 / props.camera.zoom})`,
					"transform-origin": "0 100%",
					width: `${props.board.w * props.camera.zoom}px`,
					top: `${-(24 + 2 / props.camera.zoom)}px`,
					height: "24px",
				}}
				onPointerDown={startDrag}
				onDblClick={() => props.onOpen()}
			>
				<span class="title">{props.board.title}</span>
				<span class="file">{props.board.path}</span>
				<Show when={props.onHide}>
					{(hide) => (
						<button
							class="hide"
							type="button"
							title="Take this board off the canvas. The agent keeps it in context."
							aria-label="Take this board off the canvas"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								hide()();
							}}
						>
							<Icon of={X} size={14} />
						</button>
					)}
				</Show>
			</div>

			{/*
				When the frame is inert — zoomed out far enough that a board is a tile on a
				map rather than a document — its whole body is the drag handle. The title
				bar alone is a 24px target that can sit behind a floating panel, and at that
				distance there is nothing inside the board to click anyway.
			*/}
			<div
				class="surface"
				style={{ width: `${props.board.w}px`, height: `${props.board.h}px` }}
				onPointerDown={(event) => {
					props.onSelect();
					if (inert()) startDrag(event);
				}}
			>
				<Show
					when={props.mounted}
					fallback={<div class="placeholder">{props.board.path}</div>}
				>
					<iframe
						ref={(element) => {
							frameEl = element;
							// The first src has to be set here rather than as an attribute: the
							// effect below is what owns this attribute, and letting JSX also
							// write it would navigate twice on mount.
							applySrc();
						}}
						title={props.board.title}
						width={props.board.w}
						height={props.board.h}
						referrerpolicy="no-referrer"
						onLoad={(event) => {
							const frame = event.currentTarget;
							paintFrame(frame);
							// Re-attached on every load: a reload is a new document, and the
							// listeners went with the old one.
							detachEditor?.();
							detachGestures?.();
							detachEditor = attachEditor(frame, props.board.path, props.editor);
							detachGestures = attachFrameGestures(frame, props.gestures);
						}}
					/>
				</Show>
			</div>

			{/* An agent pointing at something, in the board's own coordinates and
			    counter-scaled so the label stays readable however far out you are. */}
			<Show when={props.cursor}>
				{(cursor) => (
					<div
						class="agent-cursor"
						style={{
							left: `${cursor().x}px`,
							top: `${cursor().y}px`,
							transform: `scale(${1 / props.camera.zoom})`,
							"--cursor-color": cursor().color,
						}}
					>
						<span class="dot" />
						<span class="label">{cursor().label}</span>
					</div>
				)}
			</Show>
		</div>
	);
}
