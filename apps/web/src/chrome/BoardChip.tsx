/**
 * A board as a small picture chip: the thumbnail the gallery already has, and the name.
 *
 * Drawn on a task card for each board its turn wrote, and on a schedule card for the boards
 * the job carries, so a card looks like what it made. A press opens the preview panel, the
 * same as a gallery card. The picture comes from `thumb-cache` when there is one; a board
 * not yet pictured gets a plain tile with its first letter, which the picture replaces.
 */
import type { Board } from "@decks/protocol";
import { Show } from "solid-js";
import { picture } from "../canvas/thumb-cache.ts";
import { fileName } from "./dispatch-view.ts";

export function BoardChip(props: { path: string; boards: Board[]; onPreview?: (path: string) => void }) {
	const board = () => props.boards.find((one) => one.path === props.path);
	const src = () => {
		const found = board();
		return found ? picture(found) : undefined;
	};
	return (
		<button type="button" class="dispatch-pic" title={props.path} aria-label={`Preview ${fileName(props.path)}`} onClick={() => props.onPreview?.(props.path)}>
			<span class="dispatch-pic-img">
				<Show when={src()} fallback={<span class="dispatch-pic-tile">{fileName(props.path).slice(0, 1).toUpperCase()}</span>}>
					{(url) => <img src={url()} alt="" loading="lazy" draggable={false} />}
				</Show>
			</span>
			<span class="dispatch-pic-name">{fileName(props.path)}</span>
		</button>
	);
}
