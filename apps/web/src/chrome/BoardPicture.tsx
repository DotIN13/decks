import type { Board } from "@decks/protocol";
import { createEffect, createSignal, type JSX, Show } from "solid-js";
import { thumbUrl } from "../lib/api.ts";
import { scheme } from "../lib/theme.ts";

/**
 * A board as a picture: the one the server took (`boards/thumbs.ts` over there).
 *
 * Every small drawing of a board is this: a gallery card, a chip on a task, a tile in the
 * panel's grid and the 20×14 beside a row's name. There used to be a second source, a
 * photograph this browser took of a live frame with `modern-screenshot`, which meant a board
 * had a picture only where it had already been open, cost 160ms of main thread a time, and
 * was a redrawing of the board by a library rather than the board. The server's picture is
 * Chromium's, exists for every board, and is taken when the board changes.
 *
 * **The picture of the last revision stays up until the next one has loaded.** A board an
 * agent is writing gets a revision per write, and a tile that went blank on each would
 * flicker for as long as the agent worked. So there are two images while a revision is on
 * its way: the one being shown, and the one being waited for, clear, on top of it.
 *
 * `loading="lazy"` is the whole of the scheduling on this side. The server holds a request
 * until its picture exists, so a picture that is asked for is a connection that is taken,
 * and a gallery of six hundred cards must ask only for the screenful it is showing.
 *
 * `fallback` is what is drawn when the server cannot take pictures at all (no Chromium on
 * the machine, a 503) and `waiting` is what stands behind a first picture until it lands.
 */
export function BoardPicture(props: { board: Pick<Board, "path" | "rev">; waiting?: JSX.Element; fallback?: JSX.Element; alt?: string }) {
	const want = () => thumbUrl(props.board, scheme());
	const [shown, setShown] = createSignal<string>();
	const [failed, setFailed] = createSignal<string>();
	// A different board in the same slot (a keyed list reusing a row) has no "last revision".
	let path = props.board.path;
	createEffect(() => {
		if (props.board.path === path) return;
		path = props.board.path;
		setShown(undefined);
	});

	return (
		<span class="board-picture" data-state={shown() ? "ready" : failed() === want() ? "failed" : "waiting"}>
			<Show when={!shown()}>
				<Show when={failed() === want()} fallback={props.waiting}>
					{props.fallback}
				</Show>
			</Show>
			<Show when={shown()}>{(src) => <img src={src()} alt={props.alt ?? ""} draggable={false} data-thumb="ready" />}</Show>
			<Show when={shown() !== want() && failed() !== want()}>
				<img
					src={want()}
					alt=""
					loading="lazy"
					decoding="async"
					draggable={false}
					data-thumb="waiting"
					onLoad={() => setShown(want())}
					onError={() => setFailed(want())}
				/>
			</Show>
		</span>
	);
}
