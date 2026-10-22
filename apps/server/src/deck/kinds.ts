/**
 * What a board file *is* — decided from the file, never from a sidecar.
 *
 * **One format.** There used to be more: `component` for a canvas of absolutely positioned
 * boxes, `flow` for a document that reflows, and `slides` for a reveal deck. A board is an HTML
 * document whose content flows, top to bottom, as wide as its meta says and as tall as what is
 * in it. A `.slides.html` left over from the deck format is read like any other HTML file.
 *
 * ### Three kinds of board, and only one of them is foreign
 *
 * A board is a document this app wrote, a markdown file, or an HTML file from somewhere
 * else. They are not *delivered* the same way, which is what `shellFor` answers:
 *
 * - **a document that says `class="board"`** is ours, and needs nothing: board.css,
 *   board.js and its own blocks. Served as it is, same origin, and it measures its own
 *   height like any other board.
 * - **`.md`** is `content`: not a document, so it is wrapped in a synthesised shell that
 *   renders it into itself (`boards/shell.ts`).
 * - **an HTML file with no board class** is `foreign`: a saved page or an export. It gets a
 *   shell as well, and inside a *sandboxed* frame — it may carry scripts, and a document
 *   from somewhere else must not run in the deck's own origin. The price is that a sandboxed
 *   frame has no measurable height, so that one board keeps the height its file states.
 */

const MARKDOWN = /\.mdx?$/i;
const HTML = /\.html?$/i;

/** Whether this path is a board at all — the glob, as a predicate. */
export function isBoardFile(path: string): boolean {
	return MARKDOWN.test(path) || HTML.test(path);
}

/**
 * How a board has to be *delivered*, or nothing when the file is already a document.
 *
 * `content` is a file that has to be rendered *into* a document — a `.md`. `foreign` is an
 * HTML page from somewhere else, which gets a document too and is put in a sandboxed frame inside it. A board this app wrote answers `undefined`: it
 * carries the primitives itself, and wrapping one would be a document inside a document.
 */
export function shellFor(path: string, source?: string): "content" | "foreign" | undefined {
	if (MARKDOWN.test(path)) return "content";
	if (!HTML.test(path)) return "content";
	if (source === undefined) return undefined;
	return isOurs(source) ? undefined : "foreign";
}

/**
 * What a board is a live view of, or nothing.
 *
 * A live board is a stub: one component carrying `data-live`, drawn from `postMessage` by
 * the app that framed it (`lib/live-chat.js`, `lib/live-web.js`). The same source scan that
 * decides the shell answers this, for the same reason — it is one attribute in bytes
 * already being read, and a regex over them is not the parse it looks like.
 */
export function liveKindOf(source: string): string | undefined {
	const match = /<body[^>]*>[\s\S]{0,4000}?data-live\s*=\s*["']([a-z]+)["']/i.exec(source);
	return match?.[1];
}

/**
 * Whether a board is one box that fills it: a document (`data-live="doc"`), an app (`data-live="app"`)
 * or one file (`data-bare`).
 *
 * The same cheap scan as `liveKindOf`, over the start of the body, where both templates put it.
 */
export function fillsOf(source: string, live: string | undefined): boolean {
	if (live === "doc" || live === "app") return true;
	return /<body[^>]*>[\s\S]{0,4000}?<div[^>]*\bdata-embed=[^>]*\bdata-bare\b/i.test(source);
}

/**
 * Whether an HTML document is one of Decks' own boards.
 *
 * A regex over the opening `<body>` tag, in the spirit of `meta.ts`: this runs for every
 * board on every deck load and on every file change, and a parser would be paying for
 * correctness that is not at stake. What *is* at stake is not matching `class="board"`
 * somewhere else in the document — hence anchoring to the body tag and nothing else.
 *
 * `class` may hold more than one name and they may be in any order, so the test is for the
 * word rather than for the value. `flow` counts as well: it is the word the second format
 * used to be declared with, it is on every document board written before the two became
 * one, and those files are ours whether or not they also say `board`.
 */
export function isOurs(source: string): boolean {
	const classes = bodyClasses(source);
	return classes.includes("board") || classes.includes("flow");
}

/** The words on the opening `<body>` tag's class attribute, or none. */
function bodyClasses(source: string): string[] {
	const body = /<body\b([^>]*)>/i.exec(source);
	if (!body) return [];
	const attribute = /class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(body[1] ?? "");
	const value = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? "";
	return value.split(/\s+/).filter(Boolean);
}
