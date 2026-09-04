import type { Board } from "@decks/protocol";

/**
 * What the boards panel lists, and which of its three sections each board belongs to.
 *
 * Pure on purpose, and tested (`panel-groups.test.ts`). The panel itself is a picture of
 * this: three sentences and a count each, in a fixed order, and the grouping is the whole of
 * what the panel *knows*. Leaving it inside the component would have meant the only way to
 * ask "does a board an agent holds also appear under the deck" is to render one and look —
 * which is how the old rail ended up meaning two different things depending on state nobody
 * was watching (see the note on `contextBoards` in `App.tsx`).
 *
 * The three sections, in the order they are drawn:
 *
 * 1. **On the canvas** — held *and* in play. The accent dot, and the only rows at full
 *    strength, because this list is the canvas written down.
 * 2. **Held, not shown** — the agent is working from it without asking you to look at it.
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
 * A board an agent holds appears **once**, in its own section and not again under the deck.
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
	/**
	 * The agent whose canvas and shelf the first two sections are.
	 *
	 * Without one there is nothing to put in them and the list is simply the deck, which is
	 * the honest picture of a fresh session rather than an empty panel.
	 */
	focused?: string;
	/**
	 * Agent id → the paths it holds, in attach order.
	 *
	 * Still the whole record rather than one agent's list, because `focused` is what picks
	 * out of it and it can be absent — and a caller that has to do the lookup itself is a
	 * caller that has to decide what "no agent" means.
	 */
	holdings: Record<string, string[]>;
	/** The focused agent's in-play set: what is actually drawn on the canvas. */
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
	const focused = input.focused;
	const holdings = input.holdings ?? {};

	/*
	 * The focused agent's holdings, in attach order, dropping anything the deck no longer
	 * has. A context can name a board that has since been deleted, and a row for a board
	 * that is not there is a row that cannot be picked.
	 */
	const held = (focused ? holdings[focused] ?? [] : []).filter((path) => known.has(path));
	const heldSet = new Set(held);
	const playing = new Set((input.inPlay ?? []).filter((path) => known.has(path)));

	/*
	 * In play but not held should be impossible — playing a board attaches it — but if it
	 * ever happens the board is *on the canvas*, and a list of what is on the canvas that
	 * omits something on the canvas is the one error this panel must not make. So the
	 * canvas section is held-and-playing in attach order, then anything else in play.
	 */
	const canvasPaths = [...held.filter((path) => playing.has(path)), ...[...playing].filter((path) => !heldSet.has(path))];
	const quietPaths = held.filter((path) => !playing.has(path));
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
	 * The rest of the deck, in the *deck's* order rather than an agent's attach order: this
	 * section is not about the agent, and `boards` arrives sorted by path.
	 */
	const rest = input.boards.filter((board) => !claimed.has(board.path) && matches(board, needle));
	if (rest.length > 0) {
		sections.push({ kind: "deck", label: "In the deck", rows: rest.map((board) => ({ board, onCanvas: false, dim: false })) });
	}

	return sections;
}

/**
 * What the sections add up to, for the foot.
 *
 * `held` is the first two together — what the focused agent is working from, on screen or
 * not — and `shown` is every row, which is what a search narrows. Summed from the sections
 * rather than from the input, so the foot cannot disagree with the list above it.
 */
export function panelTally(sections: PanelSection[]): { onCanvas: number; held: number; deck: number; shown: number } {
	let onCanvas = 0;
	let held = 0;
	let deck = 0;
	for (const section of sections) {
		if (section.kind === "deck") deck += section.rows.length;
		else held += section.rows.length;
		if (section.kind === "canvas") onCanvas += section.rows.length;
	}
	return { onCanvas, held, deck, shown: held + deck };
}
