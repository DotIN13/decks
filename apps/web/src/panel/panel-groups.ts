import type { Board } from "@decks/protocol";

/**
 * What the boards panel lists, and which of its three sections each board belongs to.
 *
 * Pure on purpose, and tested (`panel-groups.test.ts`). The panel itself is a picture of
 * this: three sentences and a count each, in a fixed order, and the grouping is the whole of
 * what the panel *knows*. Leaving it inside the component would have meant the only way to
 * ask "does a board an agent holds also appear under the deck" is to render one and look —
 * which is how the old rail ended up meaning two different things depending on state nobody
 * was watching.
 *
 * The three sections, in the order they are drawn:
 *
 * 1. **On the canvas** — what the canvas has up. The accent dot, and the only rows at full
 *    strength, because this list is the canvas written down.
 * 2. **Held, not shown** — boards the focused agent has taken off its stage and keeps a
 *    place for (its context); showing one puts it back where it was.
 *    Dimmed: `[data-off-canvas]` in the old rail did this with 45% opacity on a picture,
 *    which made a list look switched off; on a text row it is the muted colour.
 * 3. **In the deck** — everything else there is. Neither dimmed nor marked: browsing the
 *    deck, "held" and "up" are not two states worth telling apart, and the rows above have
 *    already said which boards are which.
 *
 * ### Why this is one list and not two tabs
 *
 * It was **Context** and **Deck**, a strip over two lists — and the two lists were the same
 * list with a line drawn through it. Everything in Context was also in Deck, so finding a
 * board meant first guessing which tab the app had put it in *this second*, and the answer
 * depended on what an agent had done since you last looked. They are not two collections;
 * they are three states of one. So they are three headings in one scroller, in the order
 * that matters — what you are looking at, what the agent is holding for you, then everything
 * else — with one search field over all of it and the counts beside the headings saying the
 * rest.
 *
 * A board the canvas holds appears **once**, in its own section and not again under the deck.
 * A list that shows a thing twice is a list you cannot count.
 */

export type SectionKind = "canvas" | "held" | "deck";

/** One board, and the two things a row's appearance depends on. */
export interface PanelRow {
	board: Board;
	/** In play: gets the accent dot. */
	onCanvas: boolean;
	/** Held but not shown, so the name is drawn muted rather than at full strength. */
	dim: boolean;
}

export interface PanelSection {
	kind: SectionKind;
	/**
	 * The whole label, sentence case, without the count: "On the canvas", "Held, not shown",
	 * "In the deck". Never uppercase — see `.meta` in `styles/chrome.css` for why.
	 */
	label: string;
	rows: PanelRow[];
}

export interface PanelInput {
	/** Every board there is. The third section is this, minus the two above it. */
	boards: Board[];
	/** Boards the canvas took off and keeps a place for, newest first: the second section. */
	kept?: string[];
	/** What is up on the canvas: the first section. */
	inPlay?: string[];
	/** What is typed in the search field. Filters the rows; the sections stay in order. */
	query?: string;
}

/** The last segment of a deck-relative path: `boards/the-shell.html` → `the-shell.html`. */
export function basename(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * Does this board match what was typed?
 *
 * Title and **basename**, not the whole path — every board in a deck lives under `boards/`,
 * so matching the path would make "boa" select the entire deck and make the count in the
 * foot say nothing. Substring and case-insensitive rather than fuzzy, for the reason
 * `AllBoards` gives: a deck's boards are named by the person who asked for them, so the
 * thing they type is usually a word that is really in the name.
 */
export function matches(board: Board, needle: string): boolean {
	if (!needle) return true;
	return `${board.title}\n${basename(board.path)}`.toLowerCase().includes(needle);
}

/** The needle, once: trimmed and folded, so callers do not each do it differently. */
const fold = (query?: string) => (query ?? "").trim().toLowerCase();

/**
 * The panel's sections, in drawing order, with the empty ones left out.
 *
 * An empty section is dropped rather than drawn as "Held, not shown · 0": the label is a
 * line *inside* the list, so a zero would be a sentence claiming a group that has no rows
 * under it — and with a search running, most of them are empty most of the time. The one
 * state worth saying out loud is "this deck has no boards at all", and that is a sentence in
 * the panel rather than three empty headings.
 *
 * Counts come from `rows.length` *after* filtering, so "On the canvas · 1" while a search is
 * running means one match, not one board. The alternative — the unfiltered count beside a
 * filtered list — is a number that disagrees with what is under it.
 */
export function panelSections(input: PanelInput): PanelSection[] {
	const needle = fold(input.query);
	const known = new Map(input.boards.map((board) => [board.path, board]));
	/* Both lists drop anything the deck no longer has: a row for a board that is not there is a row that cannot be picked. */
	const canvasPaths = (input.inPlay ?? []).filter((path, index, all) => known.has(path) && all.indexOf(path) === index);
	const up = new Set(canvasPaths);
	const quietPaths = (input.kept ?? []).filter((path) => known.has(path) && !up.has(path));
	/* What the first two sections have claimed, so the third is "the rest" rather than "the
	   deck all over again". */
	const claimed = new Set([...canvasPaths, ...quietPaths]);

	const sections: PanelSection[] = [];

	const pick = (paths: string[], make: (board: Board) => PanelRow): PanelRow[] =>
		paths.flatMap((path) => {
			const board = known.get(path);
			if (!board || !matches(board, needle)) return [];
			return [make(board)];
		});

	const canvas = pick(canvasPaths, (board) => ({ board, onCanvas: true, dim: false }));
	if (canvas.length > 0) sections.push({ kind: "canvas", label: "On the canvas", rows: canvas });

	const quiet = pick(quietPaths, (board) => ({ board, onCanvas: false, dim: true }));
	if (quiet.length > 0) sections.push({ kind: "held", label: "Held, not shown", rows: quiet });

	/*
	 * The rest of the deck, in the *deck's* order: this section is not about the canvas, and
	 * `boards` arrives sorted by path.
	 */
	const rest = input.boards.filter((board) => !claimed.has(board.path) && matches(board, needle));
	if (rest.length > 0) {
		sections.push({ kind: "deck", label: "In the deck", rows: rest.map((board) => ({ board, onCanvas: false, dim: false })) });
	}

	return sections;
}
