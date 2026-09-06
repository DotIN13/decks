import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The shells a new board starts from.
 *
 * A board is fifteen lines of document before any content, and answering in the chat
 * column costs nothing — so an agent asked to answer on boards will answer in chat unless
 * the boilerplate goes away. These are that boilerplate, one file per shape, kept in
 * `runtime/templates` beside the primitives and the skills so they can be read and edited
 * rather than being buried in a string.
 *
 * Substitution is three tokens and no template engine, the same as `pi/context.ts` does
 * for `AGENTS.md.tmpl`.
 */

export type BoardKind = "answer" | "design" | "report" | "plan" | "blank";

export const BOARD_KINDS: readonly BoardKind[] = ["answer", "design", "report", "plan", "blank"];

/**
 * The widest a board should ever be, and it is a **ceiling rather than a target**.
 *
 * A board is read at the size the canvas has: `stage.viewport()` is the room on screen, not
 * divided by the zoom, so a board wider than the viewport is read scaled down and a board
 * much narrower than its content is read as a wall. The rule that follows is one line —
 * `min(viewport width, 1600)` — and 1600 is in it because past that a line of prose is too
 * long to track back to, whatever the screen is.
 *
 * Enforced rather than suggested: `boardWidth` clamps, `stage.newBoard` calls it, and
 * `templates.test.ts` refuses a default above it.
 */
export const MAX_BOARD_W = 1600;

/** The margin every template leaves around its content, on both sides. */
const MARGIN = 48;

/** The gap between two columns, and the gap between rows. */
const GUTTER = 48;

/**
 * The content width under which a pair of cards stops being a pair.
 *
 * Two columns of 300px are two columns; two columns of 130px are a mistake with a rule
 * through the middle. Below this the second card goes *under* the first, which is also the
 * reading order the file already has — so the layout changes and the DOM does not.
 */
const STACK_BELOW = 720;

/**
 * The widest a board of this shape should be when nobody said.
 *
 * Not "the widest it may be": each of these is the smallest width that holds the shape
 * without stuffing it, and every one is under `MAX_BOARD_W` by a distance. A `report` is
 * the widest because it is the only shape with a number, two columns and a tail.
 */
const SIZE: Record<BoardKind, { w: number; h: number }> = {
	answer: { w: 1000, h: 480 },
	design: { w: 1000, h: 620 },
	report: { w: 1200, h: 700 },
	plan: { w: 1000, h: 680 },
	blank: { w: 1000, h: 400 },
};

/**
 * A width a board may actually be: what was asked for, or the shape's own, clamped.
 *
 * `viewport` is the room the canvas has (`stage.viewport()`), and `undefined` means nobody
 * is looking — a board written by an agent nobody is watching gets the ceiling rather than
 * a guess, because a guess would be indistinguishable from a measurement at the point it
 * got used.
 *
 * A phone is the case that makes this worth having: at a 390px viewport every default here
 * is wider than the screen, and a board wider than the screen is read scaled down. Clamping
 * to 390 is what makes `renderTemplate` fold its columns instead.
 */
export function boardWidth(wanted: number | undefined, viewport: number | undefined, kind: BoardKind = "blank"): number {
	const ceiling = Math.min(viewport ?? MAX_BOARD_W, MAX_BOARD_W);
	// A width somebody typed is theirs — the clamp is about what *we* choose when they did
	// not, and an agent that means 1800 has a reason we cannot see from here.
	if (wanted) return Math.round(wanted);
	return Math.max(320, Math.min(SIZE[kind].w, ceiling));
}

/**
 * Where a template's rows and columns land, at the width it is being drawn.
 *
 * Templates carry no pixel widths of their own any more; they are written against these
 * tokens, so one file is a two-column board at 1200 and a single column at 390. That is
 * the whole of what "never wider than the viewport" costs, and the alternative was a board
 * whose content is clipped in silence on the one screen nobody checks.
 *
 * The tokens, and they are the vocabulary a template is written in:
 *
 * - `CONTENT` — the full width inside the margins
 * - `COL` — one column of a pair, or the full width when a pair has folded
 * - `COLX` — the x of a pair's second card: beside the first, or back at the margin
 * - `ROW1`, `ROW2`, … — the top of each row, in the order the file reads
 * - `PAIRB` — the top of a pair's *second* card, which is the pair's own row until it folds
 * - `BOTTOM` — where the content ends, which is what the board's height is measured against
 */
function layout(w: number, rhythm: Rhythm): Record<string, number> {
	const content = w - MARGIN * 2;
	const stacked = content < STACK_BELOW;
	const col = stacked ? content : Math.floor((content - GUTTER) / 2);
	const tokens: Record<string, number> = {
		CONTENT: content,
		COL: col,
		COLX: stacked ? MARGIN : MARGIN + col + GUTTER,
		// A shape with no pair still substitutes it: a token left unreplaced would ship
		// `{{PAIRB}}` into a board, and `templates.test.ts` refuses that for every kind.
		PAIRB: rhythm.first,
	};
	let y = rhythm.first;
	rhythm.rows.forEach((row, index) => {
		tokens[`ROW${index + 1}`] = y;
		if (row.pair) {
			tokens.PAIRB = stacked ? y + row.h + GUTTER : y;
			y += stacked ? (row.h + GUTTER) * 2 : row.h + GUTTER;
		} else {
			y += row.h + GUTTER;
		}
	});
	tokens.BOTTOM = y - GUTTER + MARGIN;
	return tokens;
}

/**
 * Each shape's vertical rhythm: where the first row starts, and the rows after it.
 *
 * Heights are nominal — these are placeholder cards, and `stage.fit` is what makes a board
 * the size of its real content. What matters here is the *order*, because it is the order
 * the file is written in and the order a reader's eye takes.
 */
interface Rhythm {
	first: number;
	rows: Array<{ h: number; pair?: boolean }>;
}

const ROWS: Record<BoardKind, Rhythm> = {
	answer: { first: 152, rows: [{ h: 220 }] },
	design: { first: 168, rows: [{ h: 220, pair: true }, { h: 110 }] },
	// The number first, then the two columns that explain it, then what is left.
	report: { first: 168, rows: [{ h: 110 }, { h: 230, pair: true }, { h: 110 }] },
	plan: { first: 152, rows: [{ h: 210, pair: true }, { h: 190 }] },
	blank: { first: 152, rows: [] },
};

function templatesDir(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../runtime/templates");
}

export function isBoardKind(value: unknown): value is BoardKind {
	return typeof value === "string" && (BOARD_KINDS as readonly string[]).includes(value);
}

/**
 * The document for a new board of this shape.
 *
 * A missing template file is a broken install rather than a reason to refuse: fall back to
 * the blank shape's markup so a deck can still be worked in.
 */
export function renderTemplate(kind: BoardKind, title: string, size?: { w?: number; h?: number }): string {
	const file = join(templatesDir(), `${kind}.html`);
	const source = existsSync(file) ? readFileSync(file, "utf8") : FALLBACK;
	const w = Math.round(size?.w ?? SIZE[kind].w);
	const boxes = layout(w, ROWS[kind]);
	/*
	 * The height follows the layout rather than the table, because folding the columns adds
	 * a row: a `plan` is 780 tall at 1000 and taller at 390, and a height that did not know
	 * that would clip the steps in silence on the one screen nobody checks.
	 */
	const h = Math.round(size?.h ?? Math.max(SIZE[kind].h, boxes.BOTTOM ?? 0));
	let out = source.replaceAll("{{TITLE}}", escapeHtml(title)).replaceAll("{{W}}", String(w)).replaceAll("{{H}}", String(h));
	for (const [token, value] of Object.entries(boxes)) out = out.replaceAll(`{{${token}}}`, String(value));
	return out;
}

/**
 * A file name from a title: lower case, words joined by dashes, ASCII only where it can be.
 *
 * Titles are often not English — the first board written in this app was in Chinese — so
 * anything left after stripping the shape of a filename is kept rather than mangled, and a
 * title that reduces to nothing falls back to the kind.
 */
export function slugFor(title: string, kind: BoardKind): string {
	const slug = title
		.toLowerCase()
		.replace(/['"`]/g, "")
		.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || kind;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FALLBACK = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>{{TITLE}}</title>
		<meta name="board" content='{"w":{{W}},"h":{{H}},"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<div class="text" data-id="heading" style="left: 48px; top: 40px; width: 900px">
			<h1>{{TITLE}}</h1>
		</div>

		<script src="../lib/board.js"></script>
	</body>
</html>
`;

/** The default size of a mirror: tall and narrow, because a conversation is a column. */
export const MIRROR_SIZE = { w: 560, h: 900 };

/**
 * The whole document of a live board.
 *
 * Four lines that never change, which is the point: a mirror's content is a conversation
 * the app is already holding, fed in over `postMessage` by `canvas/live-chat.ts` and drawn
 * by `lib/live-chat.js`. Nothing here is written again as the conversation grows — no
 * watcher event, no revision churn, and a board file somebody can read and understand.
 *
 * The component fills the board and carries an explicit height, so `contentExtent`
 * measures it exactly: a mirror never clips and `stage.fit` has nothing to do to it. The
 * growth happens inside, where the list scrolls.
 */
export function renderMirror(name: string, agentId: string, size?: { w?: number; h?: number }): string {
	const w = Math.round(size?.w ?? MIRROR_SIZE.w);
	const h = Math.round(size?.h ?? MIRROR_SIZE.h);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeHtml(name)} — the conversation</title>
		<meta name="board" content='{"w":${w},"h":${h},"bg":"plain"}' />
		<link rel="stylesheet" href="../../lib/board.css" />
	</head>
	<body class="board">
		<div
			class="live"
			data-id="mirror"
			data-live="chat"
			data-agent="${escapeHtml(agentId)}"
			style="left: 0; top: 0; width: ${w}px; height: ${h}px"
		></div>

		<script src="../../lib/board.js"></script>
	</body>
</html>
`;
}
