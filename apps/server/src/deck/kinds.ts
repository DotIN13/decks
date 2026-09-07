import type { BoardFormat } from "../boards/templates.ts";

/**
 * What a board file *is* — decided from the file, never from a sidecar.
 *
 * Three formats (`BoardFormat`), and the pleasing part is that nothing had to be invented
 * to tell them apart:
 *
 * - `.slides.md` is a deck. The double extension rather than front-matter, so a markdown
 *   file is still a markdown file to every other tool, and so there is exactly one way to
 *   say what a file is.
 * - any other `.md` is flow.
 * - `.html` is **component if its body carries `class="board"`**, and flow if it does not.
 *
 * That last rule is the one that costs nothing. Every board this deck has ever written
 * already says `<body class="board">`, and a pandoc export or a saved page already says the
 * other thing by omitting it — so there is no migration, no metadata to keep in sync, and no
 * way for a file to disagree with itself about what it is.
 */

/** `boards/talk.slides.md` → slides. Checked before the plain `.md` rule. */
const SLIDES = /\.slides\.md$/i;
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
	if (SLIDES.test(path)) return "slides";
	if (MARKDOWN.test(path)) return "flow";
	if (!HTML.test(path)) return "flow";
	if (source === undefined) return "component";
	return isComponentBoard(source) ? "component" : "flow";
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
	const body = /<body\b([^>]*)>/i.exec(source);
	if (!body) return false;
	const attribute = /class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(body[1] ?? "");
	const value = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? "";
	return value.split(/\s+/).includes("board");
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
