/**
 * A board as a small picture chip: the thumbnail the gallery already has, and the name.
 *
 * Drawn on a task card for each board its turn wrote, and on a schedule card for the boards
 * the job carries, so a card looks like what it made. A press opens the preview panel, the
 * same as a gallery card. The picture is the server's (`BoardPicture`); until it lands, and for a
 * board that is gone, there is a plain tile with the first letter.
 */
import type { Board } from "@decks/protocol";
import { Show } from "solid-js";
import { BoardPicture } from "./BoardPicture.tsx";
import { fileName } from "./dispatch-view.ts";

export function BoardChip(props: { path: string; boards: Board[]; onPreview?: (path: string) => void }) {
	const board = () => props.boards.find((one) => one.path === props.path);
	const tile = () => <span class="dispatch-pic-tile">{fileName(props.path).slice(0, 1).toUpperCase()}</span>;
	return (
		<button type="button" class="dispatch-pic" title={props.path} aria-label={`Preview ${fileName(props.path)}`} onClick={() => props.onPreview?.(props.path)}>
			<span class="dispatch-pic-img">
				{/* A board that has since been deleted has no picture to ask for: the tile is all there is. */}
				<Show when={board()} fallback={tile()}>
					{(found) => <BoardPicture board={found()} waiting={tile()} fallback={tile()} />}
				</Show>
			</span>
			<span class="dispatch-pic-name">{fileName(props.path)}</span>
		</button>
	);
}
