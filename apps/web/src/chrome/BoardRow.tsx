import type { Board } from "@decks/protocol";
import { Show } from "solid-js";
import { picture } from "../canvas/thumb-cache.ts";
import { deckFileUrl } from "../lib/api.ts";
import { basename } from "./panel-groups.ts";

/**
 * One board, as a line: a 20×14 picture of it, its filename, and a dot if it is up.
 *
 * The row that replaced `RailItem` in the panel, and the reason the list stopped looking
 * empty. The old one was a 92px thumbnail plus a two-line label, which showed five boards of
 * seventy-eight and is why finding one meant opening a modal over the canvas you were
 * looking at; the first fix drawn for it was a 32px row carrying a 10px glyph, and *that*
 * read as a list of nothing — "crowded on top, sparse for board lists" was the complaint.
 * **So the cure for the sparseness is content, not tighter leading**: 28px, and a real
 * picture in it.
 *
 * It says the **filename**, not the title. A row this size reads left to right like a
 * filename, which is what a board mostly is — and titles are sentences, which ellipsise into
 * indistinguishable prefixes at 160px of width. The title is the tooltip, and `panel-groups`
 * searches both, so nothing is lost by not drawing it.
 *
 * ### Why it never mounts a document
 *
 * A thumbnail in this app is the board itself, scaled down (DESIGN §6.6) — that is what
 * `RailItem` does, and at 150px wide with a load budget behind it, it is right. At 20×14 it
 * would be absurd: seventy-eight live documents parsing `board.css`, KaTeX and Mermaid to
 * fill a space the size of a full stop. So the row takes what is already there and never
 * asks for more:
 *
 * 1. the photograph `thumb-cache.ts` has of this exact revision, if one has been taken,
 * 2. the `<meta name="poster">` the board offered, if it did,
 * 3. otherwise an empty bordered rectangle — the same box, the same size, so the list does
 *    not reflow when a picture arrives.
 *
 * The empty rectangle is the honest state and it is common on a fresh session, which is the
 * cost of not commissioning pictures: the panel shows what the app happens to know. It is
 * also why the border matters more than the fill — a rectangle *is* a board, at this size.
 */
export function BoardRow(props: {
	board: Board;
	/** The board the canvas is centred on: washed and semibold. */
	current?: boolean;
	/** Held but not shown — the muted name that used to be 45% opacity on a picture. */
	dim?: boolean;
	/** In play: the accent dot at the right end. */
	onCanvas?: boolean;
	/** Another agent's identity colour, on the thumbnail's border. See `panel-groups.ts`. */
	tint?: string;
	onPick: () => void;
}) {
	return (
		<button
			class="board-row"
			type="button"
			/* What the list's arrow keys rove over — the same contract `ui/Popover.tsx` uses. */
			data-row
			data-current={props.current ? "true" : undefined}
			data-dim={props.dim ? "true" : undefined}
			/* Not `aria-selected`: this is a button that plays a board, not an option in a
			   listbox, and `aria-current` is the attribute for "the one you are looking at". */
			aria-current={props.current ? "true" : undefined}
			title={props.dim ? `${props.board.title} — held, not on the canvas. Click to show it.` : props.board.title}
			onClick={props.onPick}
		>
			<BoardThumb board={props.board} tint={props.tint} />
			<span class="nm">{basename(props.board.path)}</span>
			<Show when={props.onCanvas}>
				{/* Decorative: "on the canvas" is already said by the section this row is in. */}
				<span class="dot" aria-hidden="true" />
			</Show>
		</button>
	);
}

/**
 * The same board as a tile, for when the list is switched to a grid.
 *
 * Here rather than in a file of its own because it is one board drawn two ways, and the
 * picture — which is the part with an argument behind it — is the same picture. The grid is
 * worth having for a context of seven boards an agent chose, and not for seventy-eight; that
 * is why it is a toggle in the foot and not the default.
 */
export function BoardTile(props: { board: Board; current?: boolean; dim?: boolean; tint?: string; onPick: () => void }) {
	const shot = () => shotOf(props.board);
	return (
		<button
			class="board-tile"
			type="button"
			data-row
			data-current={props.current ? "true" : undefined}
			data-dim={props.dim ? "true" : undefined}
			aria-current={props.current ? "true" : undefined}
			title={props.board.title}
			onClick={props.onPick}
			style={props.tint ? { "border-color": props.tint } : undefined}
		>
			<span class="im">
				<Show when={shot()}>{(src) => <img src={src()} alt="" />}</Show>
			</span>
			<span class="cap">{basename(props.board.path)}</span>
		</button>
	);
}

/**
 * The picture itself, 20×14, bordered.
 *
 * Exported so a row somewhere else — a search result, an `@board` mention — can draw a board
 * the same way rather than inventing a second small thumbnail.
 */
export function BoardThumb(props: { board: Board; tint?: string; class?: string }) {
	const shot = () => shotOf(props.board);
	return (
		<span class={`board-thumb ${props.class ?? ""}`} style={props.tint ? { "border-color": props.tint } : undefined}>
			{/* `alt=""` on purpose: the filename is right beside it, and "the-shell.html
			    (thumbnail)" read out after "the-shell.html" is noise. */}
			<Show when={shot()}>{(src) => <img src={src()} alt="" />}</Show>
		</span>
	);
}

/** A photograph of this revision, or the poster the board offered, or nothing. Reactive. */
function shotOf(board: Board): string | undefined {
	return picture(board) ?? (board.poster ? deckFileUrl(board.poster, board.rev) : undefined);
}
