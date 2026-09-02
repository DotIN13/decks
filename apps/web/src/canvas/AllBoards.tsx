import type { Board } from "@decks/protocol";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { RailItem } from "./BoardRail.tsx";

/**
 * Every board in the deck, searchable, in a modal.
 *
 * The panel beside the canvas answers "what is this agent working from"; this answers "what
 * is in the deck", and they are different enough questions to be different surfaces. They
 * used to be one: the context panel fell back to listing the whole deck whenever the agent
 * held nothing, which meant the same list meant two things depending on state nobody was
 * looking at — and on a deck of forty boards it was a scroll, not a list.
 *
 * A modal rather than a third panel, because finding a board is a thing you do and then stop
 * doing: it wants the width to show four across and the search to have focus, and neither is
 * worth taking from the canvas permanently. It borrows the picker's backdrop for the same
 * reason the ops sheet does — open, search, dismiss is one set of rules about how a press
 * outside dismisses it.
 *
 * **Nothing here is dimmed.** The context panel fades a board it is holding but not showing,
 * because there "held" and "up" are two different states worth telling apart. Browsing the
 * deck they are not: every board is equally a board, and marking the ones not currently on
 * the canvas made the whole list 45% opaque — a list that looks switched off rather than one
 * you are reading. The one under the cursor gets a border instead, which is the only thing
 * you can put round a picture without changing what is in it.
 *
 * Search is over the title and the path, substring and case-insensitive. Not fuzzy: a deck's
 * boards are named by the person who asked for them, so the thing they type is usually a
 * word that is actually in the name, and fuzzy matching mostly earns its keep by finding
 * things you spelled wrong rather than things you half-remember.
 */
export function AllBoards(props: {
	boards: Board[];
	/** Which board the canvas is centred on, so the row can say so. */
	current?: string;
	/** What the focused agent is holding, which is what must not be photographed. */
	held: string[];
	onPick: (board: Board) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = createSignal("");

	const found = createMemo(() => {
		const needle = query().trim().toLowerCase();
		if (!needle) return props.boards;
		return props.boards.filter((board) => `${board.title} ${board.path}`.toLowerCase().includes(needle));
	});

	/*
	 * Dismissed by a press that *begins* on the backdrop, for the reason `FilePicker`
	 * documents at length: the tap that opened this produces a `click` at the same
	 * coordinates afterwards, by which time the backdrop is under exactly that point, and a
	 * modal that closes itself on the way in is worse than one that will not close at all.
	 */
	return (
		<div
			class="picker-backdrop"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<div
				class="panel-float all-boards static flex max-h-[80%] w-[min(760px,calc(100vw-24px))] flex-col overflow-hidden bg-bg p-0"
				role="dialog"
				aria-label="Every board in the deck"
			>
				<header class="flex items-center gap-2 border-b border-line py-2 pr-2.5 pl-3">
					<Icon of={Search} class="flex-none text-faint" size={15} />
					<input
						/*
						 * The browser's own ring, silenced, and the app's put back on `:focus-visible`.
						 *
						 * A borderless field on a panel gets the UA's black rounded rectangle, which
						 * is the loudest thing in the modal and lands there the moment it opens —
						 * because it opens focused. `:focus-visible` is the distinction that makes
						 * both true: nothing when the modal was clicked open and the caret is enough,
						 * an accent ring when someone arrived here with Tab.
						 */
						class="min-w-0 flex-1 border-0 bg-none py-1 text-[13px] text-fg outline-none placeholder:text-faint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
						// The field has focus as the modal appears: this exists to be typed in,
						// and one that needs a click first is one that looks broken.
						ref={(element) => requestAnimationFrame(() => element.focus())}
						type="text"
						spellcheck={false}
						placeholder="Search the deck…"
						value={query()}
						onInput={(event) => setQuery(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") props.onClose();
							// Enter takes the only match, which is what a search of forty boards
							// is usually two letters away from.
							if (event.key === "Enter" && found().length === 1) props.onPick(found()[0]!);
						}}
					/>
					<span class="flex-none text-[11px] text-faint">
						{found().length}
						{found().length === props.boards.length ? "" : ` of ${props.boards.length}`}
					</span>
					<button class="icon-button" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={16} />
					</button>
				</header>

				{/*
					`items` is not decoration: `RailItem` roots its viewport observer at the nearest
					one, so this is what bounds how many boards are live documents at a time.

					`min-h-0` is what makes the scroll real, and its absence was two bugs in one. A
					flex child defaults to `min-height: auto` and refuses to shrink below its
					content, so a deck of two dozen grew this box past the modal — which has
					`overflow-hidden`, so the rows past the second were **clipped and unreachable**,
					not scrolled to. And with the box as tall as its content, every board was within
					the observer's margin, so all 24 were live documents at once.
				*/}
				<div class="items grid min-h-0 grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 overflow-y-auto overscroll-contain p-3">
					<For each={found()}>
						{(board) => (
							<RailItem
									board={board}
									current={props.current === board.path}
									// Photographed and kept (`thumb-cache.ts`), unless an agent is holding
									// it: those are the boards being rewritten, so a picture would be stale
									// before it landed and re-taken on every revision.
									cache={!props.held.includes(board.path)}
									onPick={() => props.onPick(board)}
								/>
						)}
					</For>
				</div>

				<Show when={found().length === 0}>
					<div class="border-t border-line px-3 py-4 text-center text-[12px] text-faint">
						{props.boards.length === 0 ? "This deck has no boards yet. Ask for one." : `Nothing in the deck matches “${query().trim()}”.`}
					</div>
				</Show>
			</div>
		</div>
	);
}
