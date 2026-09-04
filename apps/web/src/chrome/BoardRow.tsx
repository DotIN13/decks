import type { Board } from "@decks/protocol";
import Trash2 from "lucide-solid/icons/trash-2";
import { createSignal, onCleanup, Show } from "solid-js";
import { RailItem } from "../canvas/BoardRail.tsx";
import { picture } from "../canvas/thumb-cache.ts";
import { Icon } from "../icons.tsx";
import { deckFileUrl } from "../lib/api.ts";
import { basename } from "./panel-groups.ts";

/** How long an armed delete waits for the second press before forgetting it was asked. */
const ARMED_MS = 4000;

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
	/**
	 * Delete the board's file. Absent means the row has no delete on it.
	 *
	 * The row does not do it on the first press — see `press` below — so this is called only
	 * once the person has said it twice.
	 */
	onDelete?: () => void;
	onPick: () => void;
}) {
	/*
	 * Deleting takes two presses of the same button, and this is the bit in between.
	 *
	 * Every other × in this app removes something recoverable: closing a chat leaves the
	 * transcript on disk, forgetting an account leaves a login you can do again, hiding a
	 * board leaves the board. This one unlinks a file somebody wrote, in a list of seventy-
	 * eight rows, from a button that is 22px wide and appears under the pointer on approach.
	 * A modal for it would be the heavier answer and a worse one — the question is about
	 * *this row*, and a dialog takes the row off the screen to ask it.
	 *
	 * So the first press arms and says so, and the second one within four seconds does it.
	 * Leaving the row disarms it, because "somewhere else" is the plainest way of saying no.
	 */
	const [armed, setArmed] = createSignal(false);
	let waiting: ReturnType<typeof setTimeout> | undefined;
	const disarm = () => {
		clearTimeout(waiting);
		setArmed(false);
	};
	onCleanup(disarm);
	const press = () => {
		if (!armed()) {
			setArmed(true);
			clearTimeout(waiting);
			waiting = setTimeout(() => setArmed(false), ARMED_MS);
			return;
		}
		disarm();
		props.onDelete?.();
	};
	const name = () => basename(props.board.path);

	return (
		/*
		 * A box holding the row and the button, rather than a button inside the row: a
		 * `<button>` in a `<button>` is invalid, and the two mean different things. The same
		 * arrangement a menu row uses for its × (`.row-act` in `chrome.css`), spelled again in
		 * `panel.css` because that one's scope restyles anything wearing `data-row`.
		 */
		<div class="board-act" onPointerLeave={disarm} onFocusOut={(event) => {
			// Focus that lands somewhere else in the same box — the row to the button — is not
			// leaving, and disarming on it would make the keyboard route impossible.
			if (!event.currentTarget.contains(event.relatedTarget as Node | null)) disarm();
		}}>
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
				/* Delete from the keyboard, the way the agent list does it: the row is what the
				   arrows are on, so the row is where the key has to be heard. Two presses here
				   as well — the same arming, so the rule does not depend on how you asked. */
				onKeyDown={(event) => {
					if (event.key === "Escape" && armed()) {
						event.preventDefault();
						event.stopPropagation();
						disarm();
						return;
					}
					if (!props.onDelete) return;
					if (event.key !== "Delete" && event.key !== "Backspace") return;
					event.preventDefault();
					event.stopPropagation();
					press();
				}}
			>
				<BoardThumb board={props.board} />
				<span class="nm">{name()}</span>
				<Show when={props.onCanvas}>
					{/* Decorative: "on the canvas" is already said by the section this row is in. */}
					<span class="dot" aria-hidden="true" />
				</Show>
			</button>

			<Show when={props.onDelete}>
				<button
					class="board-del"
					type="button"
					data-armed={armed() ? "true" : undefined}
					title={armed() ? `Press again to delete ${name()} — the file goes with it` : `Delete ${name()} from the deck`}
					aria-label={armed() ? `Delete ${name()} — press again to confirm` : `Delete ${name()}`}
					onClick={(event) => {
						event.stopPropagation();
						press();
					}}
					onKeyDown={(event) => {
						if (event.key !== "Escape" || !armed()) return;
						event.preventDefault();
						event.stopPropagation();
						disarm();
					}}
				>
					<Icon of={Trash2} size={12} />
				</button>
			</Show>
		</div>
	);
}

/**
 * The same board as a tile, for when the list is switched to a grid.
 *
 * Here rather than in a file of its own because it is one board drawn two ways, and the
 * picture — which is the part with an argument behind it — is the same picture. The grid is
 * worth having for a context of seven boards an agent chose, and not for seventy-eight; that
 * is why it is a toggle in the foot and not the default.
 *
 * ### This is the one place that commissions a photograph
 *
 * And it has to be, or nothing does. A thumbnail in this app is the board itself, scaled
 * down: `RailItem` mounts the real document in an iframe, waits for `board.js` to finish
 * drawing markdown and maths, and photographs it on idle into `thumb-cache`. That used to
 * happen in the full-screen browse modal, which was the only surface doing it — and the
 * modal lost its trigger when the title bar went, so the cache stopped being filled and
 * every 20×14 row in the list drew an empty rectangle for ever.
 *
 * So the grid delegates to `RailItem` rather than drawing its own picture. One
 * implementation of "a board, photographed", already budgeted so a screen of them does not
 * mount seventy-eight documents at once, and already covered by the thumbnail checks. The
 * 20×14 rows then draw from the cache it fills, which is why browsing the deck once is what
 * makes the panel's rows look like something.
 */
export function BoardTile(props: { board: Board; current?: boolean; dim?: boolean; onPick: () => void }) {
	return <RailItem board={props.board} current={props.current ?? false} offCanvas={props.dim} cache onPick={props.onPick} />;
}

/**
 * The picture itself, 20×14, bordered.
 *
 * Exported so a row somewhere else — a search result, an `@board` mention — can draw a board
 * the same way rather than inventing a second small thumbnail.
 *
 * The border used to be tintable, so a board another agent held could wear that agent's
 * colour. The panel no longer lists anybody else's holdings, so there was one caller and
 * it passed nothing: a parameter kept for a case that cannot arise is a parameter the next
 * reader has to rule out.
 */
export function BoardThumb(props: { board: Board; class?: string }) {
	const shot = () => shotOf(props.board);
	return (
		<span class={`board-thumb ${props.class ?? ""}`}>
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
