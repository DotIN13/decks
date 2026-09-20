import type { BoardFormat } from "../boards/templates.ts";

/**
 * What a board file *is* — decided from the file, never from a sidecar.
 *
 * **Two formats, and one of them is every board.** There used to be three: `component` for
 * a canvas of absolutely positioned boxes and `flow` for a document that reflows, told
 * apart by a word on the body's class attribute. They are one now, because the distinction
 * was never a property of the *file*: a board is an HTML document, the stylesheet it links
 * puts its root-level blocks in absolute position, and a block that is not placed is a
 * block that flows. Which of those a given block is belongs to the block, and the one place
 * that has to know asks the browser for its computed position rather than asking the file
 * what format it is.
 *
 * So what is left here is the one difference a reader can see before a frame has loaded:
 *
 * - `.slides.html` and `.slides.md` are decks: paged with the arrow keys, laid out at a
 *   fixed logical size and scaled rather than reflowed. The double extension rather than a
 *   metadata field, so the file is still an ordinary HTML or markdown file to every other
 *   tool, and so there is exactly one way to say what a file is.
 * - everything else is a `board`.
 *
 * `.slides.html` is reveal's own format — `<section>` elements, which is what reveal *is*;
 * its markdown support is a plugin. So an HTML deck is the native one and a `.slides.md` is
 * the plugin's dialect, which is the reverse of the order they were built in here. Both are
 * read by `lib/slides.js`, which picks its splitter from the extension.
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
 *   renders it into itself (`boards/shell.ts`). A deck is content too, in either dialect —
 *   the shell is what gives it the `.deck` component and the slide view.
 * - **an HTML file with no board class** is `foreign`: a saved page or an export. It gets a
 *   shell as well, and inside a *sandboxed* frame — it may carry scripts, and a document
 *   from somewhere else must not run in the deck's own origin. The price is that a sandboxed
 *   frame has no measurable height, so that one board keeps the height its file states.
 */

/**
 * `boards/talk.slides.html` and `boards/talk.slides.md` → slides.
 *
 * Checked before the plain `.md` and `.html` rules — an HTML deck is a deck whatever its
 * body says, because the name is the declaration.
 */
const SLIDES = /\.slides\.(?:html?|md)$/i;
const MARKDOWN = /\.mdx?$/i;
const HTML = /\.html?$/i;

/** Whether this path is a board at all — the glob, as a predicate. */
export function isBoardFile(path: string): boolean {
	return SLIDES.test(path) || MARKDOWN.test(path) || HTML.test(path);
}

/**
 * A board's format, from its path: a deck of slides, or a board.
 *
 * The source is no longer read for this. It was read to tell a component board from a flow
 * document, and that question no longer exists; what the source still decides is how the
 * file has to be *delivered*, which is `shellFor` below.
 */
export function formatOf(path: string): BoardFormat {
	return SLIDES.test(path) ? "slides" : "board";
}

/**
 * How a board has to be *delivered*, or nothing when the file is already a document.
 *
 * `content` is a file that has to be rendered *into* a document — a `.md`, or a deck in
 * either dialect. `foreign` is an HTML page from somewhere else, which gets a document too
 * and is put in a sandboxed frame inside it. A board this app wrote answers `undefined`: it
 * carries the primitives itself, and wrapping one would be a document inside a document.
 */
export function shellFor(path: string, source?: string): "content" | "foreign" | undefined {
	// A deck is content in either dialect: the shell is what gives it the `.deck` component
	// and the slide view, so `.slides.html` needs one exactly as `.slides.md` does.
	if (SLIDES.test(path)) return "content";
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

/**
 * The default width for a format, when the deck has not been told one.
 *
 * 960 for a slide because that is the logical width a slide is laid out at, so a deck opens
 * at exactly 1:1 before anybody resizes it, and 1000 for a board, which is the measure a
 * board is written to and about as wide as one is read at.
 */
export function defaultWidth(format: BoardFormat): number {
	return format === "slides" ? 960 : 1000;
}

/** A slide's aspect, as a height for a given width. 16:9 unless the deck says otherwise. */
export function slideHeight(width: number, aspect?: string): number {
	const [w = 0, h = 0] = (aspect ?? "16:9").split(":").map(Number);
	const ratio = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? h / w : 9 / 16;
	return Math.round(width * ratio);
}
