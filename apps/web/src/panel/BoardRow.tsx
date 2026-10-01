import type { Board } from "@decks/protocol";
import Trash2 from "lucide-solid/icons/trash-2";
import EyeOff from "lucide-solid/icons/eye-off";
import { createSignal, onCleanup, Show } from "solid-js";
import { Icon } from "../ui/icons.tsx";
import { basename } from "./panel-groups.ts";

/** How long an armed delete waits for the second press before forgetting it was asked. */
const ARMED_MS = 4000;

/**
 * One board, as a line: an empty box the shape of a board, its filename, and a dot if it is up.
 *
 * It says the **filename**, not the title. A row this size reads left to right like a
 * filename, which is what a board mostly is — and titles are sentences, which ellipsise into
 * indistinguishable prefixes at 160px of width. The title is the tooltip, and `panel-groups`
 * searches both, so nothing is lost by not drawing it.
 *
 * **The box, with nothing in it.** The row used to draw a picture of the board in its 20×14 box,
 * fetched from the server and decoded per row; on a phone a list of them held hundreds of
 * megabytes of images to draw full stops. The box stays, bordered and empty: at this size a
 * rectangle already reads as a board, and it keeps the names in one column.
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
	/** Take the board off the canvas, keeping the file. Drawn only on a row that is on it. */
	onHide?: () => void;
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
				<span class="board-thumb" aria-hidden="true" />
				<span class="row-name">{name()}</span>
				<Show when={props.onCanvas}>
					{/* Decorative: "on the canvas" is already said by the section this row is in. */}
					<span class="dot" aria-hidden="true" />
				</Show>
			</button>

			{/*
				A hide, beside the bin, on a row that is on the canvas: it takes the board off the
				canvas and nothing else, so one press does it — there is no file to lose, and the
				Boards tab is where it comes back from.
			*/}
			<Show when={props.onHide && props.onCanvas}>
				<button
					class="board-hide"
					type="button"
					title={`Take ${name()} off the canvas`}
					aria-label={`Hide ${name()}`}
					onClick={(event) => {
						event.stopPropagation();
						props.onHide?.();
					}}
				>
					<Icon of={EyeOff} size={12} />
				</button>
			</Show>

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
