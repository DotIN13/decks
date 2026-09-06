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

/** Sizes that suit each shape, and that the agent is free to change afterwards. */
const SIZE: Record<BoardKind, { w: number; h: number }> = {
	answer: { w: 1200, h: 800 },
	design: { w: 1000, h: 700 },
	report: { w: 1280, h: 700 },
	plan: { w: 1000, h: 700 },
	blank: { w: 1200, h: 800 },
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
	const { w, h } = SIZE[kind];
	return source
		.replaceAll("{{TITLE}}", escapeHtml(title))
		.replaceAll("{{W}}", String(Math.round(size?.w ?? w)))
		.replaceAll("{{H}}", String(Math.round(size?.h ?? h)));
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
