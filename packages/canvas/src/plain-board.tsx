import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { StageBoardProps } from "./board-slot.ts";

/**
 * A board as a host with no board editor draws it: its page in a frame while the stage lets it
 * have one, and nothing otherwise, since the stage's sheet draws every board without a page as
 * its picture (`StageShots.picture`).
 *
 * The Decks app draws boards with `board/BoardFrame.tsx`, which edits a board's own document,
 * runs live chats and takes file drops; this is the part of it that is the canvas's: where the
 * board is, the selection, and a bar to move it by. `page` is the board's live address, or
 * undefined for a board that is only ever a picture.
 */
export function PlainBoard(props: StageBoardProps & { page?: string | undefined }) {
	const at = createMemo(() => {
		const resized = props.view.resized();
		return props.origin ?? { x: resized?.x ?? props.board.x, y: resized?.y ?? props.board.y };
	});
	const size = () => {
		const resized = props.view.resized();
		return { w: resized?.w ?? props.board.w, h: resized?.h ?? props.board.h };
	};
	const shift = () => {
		const by = props.view.shift();
		return by ? `translate(${by.dx}px, ${by.dy}px)` : undefined;
	};
	/** A press on the board or its bar: the editor takes it as a move of the selection, or it selects the board. */
	const press = (event: PointerEvent) => {
		if (event.button !== 0) return;
		if (event.pointerType !== "touch" && props.view.press(event)) return;
		props.view.select();
	};
	const live = () => props.mounted && props.page !== undefined;
	/*
	 * Whether the page takes the pointer (`canvas.css`, `iframe:not([data-wired])`): once it has
	 * loaded, and only after a double-click on the board, the way a design tool treats an embed.
	 * A host's page is usually from another origin, so unlike `BoardFrame` nothing here can reach
	 * into it to hand a wheel or a pinch back to the stage. Until then the board is a picture to
	 * the pointer: a press picks it, a drag moves it (selected or not), scrolling over it pans.
	 * Entered, its buttons, fields and scrolling are its own, until it stops being selected.
	 */
	const [loaded, setLoaded] = createSignal(false);
	const [entered, setEntered] = createSignal(false);
	createEffect(() => {
		if (!live()) setLoaded(false);
	});
	createEffect(() => {
		if (!props.selected || !live()) setEntered(false);
	});
	const interactive = () => live() && loaded() && entered();
	const enter = () => {
		if (!live()) return;
		props.view.select();
		setEntered(true);
	};
	/*
	 * The stage's sheet draws a board's picture until the board says its page is showing
	 * (`onLive`), and again once it is gone: said on the page's load, and when it is unmounted.
	 */
	let said = false;
	const say = (on: boolean) => {
		if (on === said) return;
		said = on;
		props.onLive?.(on);
	};
	createEffect(() => {
		if (!live()) say(false);
	});
	onCleanup(() => say(false));
	return (
		<div
			class="board-node plain-board"
			data-path={props.board.path}
			data-selected={props.selected}
			data-inert={!live()}
			data-carried={props.carried ? "" : undefined}
			onPointerEnter={() => props.view.hover(true)}
			onPointerLeave={() => props.view.hover(false)}
			style={{
				left: `${at().x}px`,
				top: `${at().y}px`,
				transform: shift(),
				width: `${size().w}px`,
				height: `${size().h}px`,
			}}
		>
			<div class="shade" aria-hidden="true" />
			<Show when={props.visible}>
				<div class="plain-board-bar" title={props.board.path} onPointerDown={press} onDblClick={() => props.onOpen()}>
					{props.board.title}
				</div>
			</Show>
			<div
				class="surface"
				style={{ width: `${size().w}px`, height: `${size().h}px` }}
				title={live() && !interactive() ? "Double-click to use the board" : undefined}
				onPointerDown={(event) => !interactive() && press(event)}
				onDblClick={() => !interactive() && enter()}
			>
				<Show when={live()}>
					<iframe
						class="plain-board-page"
						src={props.page}
						onLoad={() => {
							setLoaded(true);
							say(live());
						}}
						data-wired={interactive() ? "" : undefined}
						title={props.board.title}
						data-path={props.board.path}
						style={{ width: "100%", height: "100%", border: "0" }}
					/>
				</Show>
			</div>
		</div>
	);
}
