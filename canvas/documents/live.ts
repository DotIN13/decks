import type { DocChange, Splice } from "./model.ts";
import type { Mark } from "./marks.ts";

/**
 * The page you type into, for markdown and LaTeX: the file's own text, drawn as it reads.
 *
 * Every character on the page is a character of the file, in order, so a caret is an offset into
 * the file and a keystroke is one splice of it, exactly. What makes it read as a document rather
 * than as source is styling: a heading line is drawn large, `**` around a word makes it bold, and
 * the syntax that says so (the `#`, the `**`, a link's address) is hidden until the caret comes
 * into the heading or the word, as Typora does. Maths, pictures and tables are drawn beside their
 * source, which shows only while the caret is in them.
 *
 * The browser never edits the page itself. Every input is turned into a splice of the file here
 * (`beforeinput`), applied, and the touched blocks are drawn again from the file, so the page and
 * the file cannot drift. The one exception is an input method composing a word, which has to be
 * left alone until it is done; its result is read back off the page and turned into a splice.
 *
 * Undo is this page's own: a list of the splices that would take each edit back, moved past
 * whatever others wrote since, so undo never takes back an agent's words.
 */

export interface LiveHost {
	/** Set the maths in an element (KaTeX's auto-render, in Decks). */
	math?(into: HTMLElement): Promise<void> | void;
	/** A URL a picture's address can be drawn from: relative addresses are the file's neighbours. */
	asset?(src: string): Promise<string | undefined>;
	/** A URL of a PDF's first page drawn as a picture, for a LaTeX figure that is a PDF. */
	pdfPicture?(src: string): Promise<string | undefined>;
	/** Where other writers' words are, to highlight. */
	marks(): readonly Mark[];
	changes(): readonly DocChange[];
	/** After the caret moves or the text changes: what the toolbar shows as pressed. */
	onState?(state: FormatState): void;
}

export interface FormatState {
	bold: boolean;
	italic: boolean;
	strike: boolean;
	underline: boolean;
	code: boolean;
	mark: boolean;
	link: boolean;
	math: boolean;
	/** The line the caret is on: `p`, `h1`…`h6`, `quote`, `ul`, `ol`, `task`, or `code` inside a fenced block. */
	block: string;
}

export type InlineStyle = "bold" | "italic" | "strike" | "underline" | "code" | "mark" | "math";
export type BlockStyle = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "ul" | "ol" | "task" | "code";

export interface Range2 {
	start: number;
	end: number;
}

export interface UndoEntry {
	/** The splices that take this edit back, in the text as it stands now. */
	undo: Splice[];
	caret: Range2;
	after: Range2;
	at: number;
	kind: string;
}

// The editor, its drawing of source text, and what keys and the toolbar do, each in live/: the
// editor puts its input on itself, so importing it alone gives a whole editor.
export { LiveEditor } from "./live/editor.ts";
