import type { BoardFormat } from "../boards/templates.ts";

/**
 * What a board file *is* — decided from the file, never from a sidecar.
 *
 * Three formats (`BoardFormat`), and the pleasing part is that nothing had to be invented
 * to tell them apart:
 *
 * - `.slides.html` and `.slides.md` are decks. The double extension rather than a metadata
 *   field, so the file is still an ordinary HTML or markdown file to every other tool, and
 *   so there is exactly one way to say what a file is.
 * - any other `.html` is read from its **body class**: `flow` is a document that reflows,
 *   `board` is the positioned-component kind, and neither of those is a foreign document.
 * - any other `.md` is flow too — markdown is still read, it is simply no longer what this
 *   app *writes*. Every board it writes is a single HTML file.
 *
 * `.slides.html` is reveal's own format — `<section>` elements, which is what reveal *is*;
 * its markdown support is a plugin. So an HTML deck is the native one and a `.slides.md` is
 * the plugin's dialect, which is the reverse of the order they were built in here. Both are
 * read by `lib/slides.js`, which picks its splitter from the extension.
 *
 * The body-class rule costs nothing. Every board this deck has ever written already says
 * `<body class="board">`, and a pandoc export or a saved page already says the other thing
 * by omitting it — so there is no migration, no metadata to keep in sync, and no way for a
 * file to disagree with itself about what it is.
 *
 * ### Three flow boards, and only one of them is foreign
 *
 * `flow` covers a document this app wrote, a markdown file, and an HTML file from somewhere
 * else. They are not *delivered* the same way, which is what `shellFor` answers:
 *
 * - **`class="flow"`** is ours, and the file is already a board document: board.css,
 *   board.js, and one full-bleed component holding the content. Served as it is, same
 *   origin, and it measures its own height like any other board.
 * - **`.md`** is `content`: not a document, so it is wrapped in a synthesised shell that
 *   renders it into itself (`boards/shell.ts`). A deck is content too, in either dialect —
 *   the shell is what gives it the `.deck` component and the slide view.
 * - **an HTML file with neither class** is `foreign`: a saved page or an export. It gets a
 *   shell as well, and inside a *sandboxed* frame — it may carry scripts, and a document
 *   from somewhere else must not run in the deck's own origin. The price is that a sandboxed
 *   frame has no measurable height, so that one board keeps a stored size.
 */

/**
 * `boards/talk.slides.html` and `boards/talk.slides.md` → slides.
 *
 * Checked before the plain `.md` and `.html` rules, and before the `class="board"` test —
 * an HTML deck is a deck whatever its body says, because the name is the declaration.
 */
const SLIDES = /\.slides\.(?:html?|md)$/i;
const MARKDOWN = /\.mdx?$/i;
const HTML = /\.html?$/i;

/** Whether this path is a board at all — the glob, as a predicate. */
export function isBoardFile(path: string): boolean {
	return SLIDES.test(path) || MARKDOWN.test(path) || HTML.test(path);
}

/**
 * A board's format, from its path and — for HTML only — its source.
 *
 * `source` is optional so a caller that has the path but not the bytes can still get the
 * answer for markdown, which is every caller that is only deciding whether to *list* a
 * file. An HTML file with no source given is assumed to be a component board, because that
 * is what every HTML board in every existing deck is: guessing `flow` there would make one
 * unreadable frame out of a correct file, where guessing `component` at worst makes a
 * document render as an unstyled one.
 */
export function formatOf(path: string, source?: string): BoardFormat {
	// The name first, so an HTML deck is never mistaken for a component board — a
	// `.slides.html` written by this app carries `class="board"` on its body, because the
	// shell it is served in needs one, and the extension has to outrank that.
	if (SLIDES.test(path)) return "slides";
	if (MARKDOWN.test(path)) return "flow";
	if (!HTML.test(path)) return "flow";
	if (source === undefined) return "component";
	const classes = bodyClasses(source);
	// `flow` before `board`, because a flow board written by this app says both: `board` is
	// what makes the primitives apply, and `flow` is what says the content reflows.
	if (classes.includes("flow")) return "flow";
	return classes.includes("board") ? "component" : "flow";
}

/**
 * How a board has to be *delivered*, or nothing when the file is already a document.
 *
 * `content` is a file that has to be rendered *into* a document — a `.md`, or a deck in
 * either dialect. `foreign` is an HTML page from somewhere else, which gets a document too
 * and is put in a sandboxed frame inside it. A component board and a flow board answer
 * `undefined`: they carry the primitives themselves, and wrapping one would be a document
 * inside a document.
 */
export function shellFor(path: string, source?: string): "content" | "foreign" | undefined {
	// A deck is content in either dialect: the shell is what gives it the `.deck` component
	// and the slide view, so `.slides.html` needs one exactly as `.slides.md` does.
	if (SLIDES.test(path)) return "content";
	if (MARKDOWN.test(path)) return "content";
	if (!HTML.test(path)) return "content";
	if (source === undefined) return undefined;
	const classes = bodyClasses(source);
	return classes.includes("flow") || classes.includes("board") ? undefined : "foreign";
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
 * word rather than for the value.
 */
export function isComponentBoard(source: string): boolean {
	const classes = bodyClasses(source);
	// A flow board says `board` as well — the primitives are the same — so the narrower
	// word decides. Without this, every flow board this app writes would be handed the
	// component editor and asked to be dragged.
	return classes.includes("board") && !classes.includes("flow");
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
 * 720 for prose because that is a readable measure — a line of text much wider than this is
 * one the eye loses its place in — and 960 for a slide because that is the logical width a
 * slide is laid out at, so a deck opens at exactly 1:1 before anybody resizes it.
 */
export function defaultWidth(format: BoardFormat): number {
	return format === "slides" ? 960 : 720;
}

/** A slide's aspect, as a height for a given width. 16:9 unless the deck says otherwise. */
export function slideHeight(width: number, aspect?: string): number {
	const [w = 0, h = 0] = (aspect ?? "16:9").split(":").map(Number);
	const ratio = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? h / w : 9 / 16;
	return Math.round(width * ratio);
}
