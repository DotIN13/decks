import type { Board, Identity } from "@decks/protocol";

/**
 * What the Context tab lists, and which of its three sections each board belongs to.
 *
 * Pure on purpose, and tested (`panel-groups.test.ts`). The panel itself is a picture of
 * this: three sentences and a count each, in a fixed order, and the grouping is the whole of
 * what the panel *knows*. Leaving it inside the component would have meant the only way to
 * ask "does a board held by two agents appear twice" is to render one and look — which is
 * how the old rail ended up meaning two different things depending on state nobody was
 * watching (see the note on `contextBoards` in `App.tsx`).
 *
 * The three sections, in the order they are drawn:
 *
 * 1. **On the canvas** — held *and* in play. The accent dot, and the only rows at full
 *    strength, because this list is the canvas written down.
 * 2. **Held, not shown** — the agent is working from it without asking you to look at it.
 *    Dimmed: `[data-off-canvas]` in the old rail did this with 45% opacity on a picture,
 *    which made a list look switched off; on a text row it is the muted colour.
 * 3. **&lt;name&gt; is holding** — one section per *other* agent that holds something, and the
 *    only place another agent appears on this screen. Not somewhere to switch from — the
 *    selector in the pill does that — but because "Pi is holding the conversation board" is
 *    the answer to why you cannot find it, and a redesign that hid other agents completely
 *    would have to invent that answer somewhere else.
 *
 * A board held by the focused agent *and* by someone else appears once, in the focused
 * agent's section. The third group answers "who has the ones I do not", so listing a board
 * you already have in it is answering a question nobody asked, twice.
 */

export type SectionKind = "canvas" | "held" | "other";

/** One board, and the three things a row's appearance depends on. */
export interface PanelRow {
	board: Board;
	/** In play: gets the accent dot. */
	onCanvas: boolean;
	/** Held but not shown, so the name is drawn muted rather than at full strength. */
	dim: boolean;
	/**
	 * The identity colour of the agent holding it, when that is somebody else.
	 *
	 * It lands on the thumbnail's *border* rather than the text: the row still has to read
	 * as a board name, and a coloured filename reads as a link or an error.
	 */
	tint?: string;
}

export interface PanelSection {
	kind: SectionKind;
	/**
	 * The whole label, sentence case, without the count: "On the canvas", "Held, not shown",
	 * "Pi is holding". Never uppercase — see `.meta` in `styles/chrome.css` for why.
	 */
	label: string;
	rows: PanelRow[];
	/** Whose section this is, when it is somebody else's. */
	agent?: string;
	/** That agent's identity colour, so the section and its rows agree. */
	tint?: string;
}

export interface ContextInput {
	/** The whole deck. A path held by an agent but missing from here is a board that was deleted. */
	boards: Board[];
	/** The agent whose context this is. Without one there is no context to group. */
	focused?: string;
	/** Agent id → the paths it holds, in attach order. */
	holdings: Record<string, string[]>;
	/** The focused agent's in-play set: what is actually drawn on the canvas. */
	inPlay?: string[];
	/** Names and colours, for the third section's label and tint. */
	identities?: Record<string, Identity>;
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

/** The Deck tab: every board there is, filtered by the same rule the Context tab uses. */
export function filterBoards(boards: Board[], query?: string): Board[] {
	const needle = fold(query);
	if (!needle) return boards;
	return boards.filter((board) => matches(board, needle));
}

/**
 * The Context tab's sections, in drawing order, with the empty ones left out.
 *
 * An empty section is dropped rather than drawn as "Held, not shown · 0": the label is a
 * line *inside* the list now, so a zero would be a sentence claiming a group that has no
 * rows under it — and with a search running, most of them are empty most of the time. The
 * one state worth saying out loud is "this agent holds nothing at all", and that is a
 * sentence in the panel rather than three empty headings.
 *
 * Counts come from `rows.length` *after* filtering, so "On the canvas · 1" while a search is
 * running means one match, not one board. The alternative — the unfiltered count beside a
 * filtered list — is a number that disagrees with what is under it.
 */
export function contextSections(input: ContextInput): PanelSection[] {
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

	const sections: PanelSection[] = [];

	const pick = (paths: string[], make: (board: Board) => PanelRow): PanelRow[] =>
		paths.flatMap((path) => {
			const board = known.get(path);
			if (!board || !matches(board, needle)) return [];
			return [make(board)];
		});

	const canvas = pick(canvasPaths, (board) => ({ board, onCanvas: true, dim: false }));
	if (canvas.length > 0) sections.push({ kind: "canvas", label: "On the canvas", rows: canvas });

	const quiet = pick(
		held.filter((path) => !playing.has(path)),
		(board) => ({ board, onCanvas: false, dim: true }),
	);
	if (quiet.length > 0) sections.push({ kind: "held", label: "Held, not shown", rows: quiet });

	/*
	 * The other agents, by name rather than by whatever order the server's record happens to
	 * iterate in. A list of people that reorders itself when one of them writes a file is a
	 * list you have to re-read every time you look at it.
	 */
	const others = Object.keys(holdings)
		.filter((id) => id !== focused && (holdings[id] ?? []).some((path) => known.has(path) && !heldSet.has(path)))
		.map((id) => ({ id, name: input.identities?.[id]?.name ?? id, tint: input.identities?.[id]?.color }))
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const other of others) {
		const rows = pick(
			(holdings[other.id] ?? []).filter((path) => !heldSet.has(path)),
			(board) => ({ board, onCanvas: false, dim: true, tint: other.tint }),
		);
		if (rows.length === 0) continue;
		sections.push({ kind: "other", label: `${other.name} is holding`, rows, agent: other.id, tint: other.tint });
	}

	return sections;
}

/** How many boards the focused agent holds, and how many of those are up. For the foot. */
export function contextTally(sections: PanelSection[]): { held: number; onCanvas: number } {
	let held = 0;
	let onCanvas = 0;
	for (const section of sections) {
		if (section.kind === "other") continue;
		held += section.rows.length;
		if (section.kind === "canvas") onCanvas += section.rows.length;
	}
	return { held, onCanvas };
}
