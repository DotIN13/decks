import { Marked, type TokenizerExtension, type Tokens } from "marked";

/**
 * The markdown a card is written in: Obsidian's, plus two things Obsidian has no word for.
 *
 * Obsidian Flavored Markdown is CommonMark and GitHub's tables, task lists, strikethrough and
 * footnotes, and on top of them `==highlight==` (six colours by a leading 🔴🟠🟡🟢🔵🟣), `[[links]]`,
 * `![[embeds]]`, `![alt|240](url)` for an image's width, `> [!type] Title` callouts and `%%hidden
 * comments%%`. A card adds:
 *
 * - styled words, `[words]{.red}`, `[words]{.serif .large}`, written the way Pandoc and Djot write a
 *   span with attributes: a colour, a size (`small`, `large`, `huge`) and a font, `font="Lora"`
 *   (`.serif` and `.mono` for short);
 * - an agent's suggestions in CriticMarkup: `{~~old~>new~~}`, `{++added++}`, `{--removed--}`, and
 *   `{>>why<<}` after one of them for the reason.
 *
 * `toObsidian` takes both out, for a card going to Obsidian. Everything here reads as plain
 * words in pen.dev, which shows a card's markdown as it was typed.
 *
 * `marked` reads it: these are its inline and block extensions, shared by the reader that draws a
 * card (`markdown.ts`) and the editor that types into one (`CardEditor.tsx`).
 */

export const COLOURS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export type Colour = (typeof COLOURS)[number];
/** Obsidian's highlight colours, by the emoji that opens one. */
export const HIGHLIGHT_EMOJI: Record<string, Colour> = { "🔴": "red", "🟠": "orange", "🟡": "yellow", "🟢": "green", "🔵": "blue", "🟣": "purple" };
export const EMOJI_OF: Record<Colour, string> = Object.fromEntries(Object.entries(HIGHLIGHT_EMOJI).map(([emoji, colour]) => [colour, emoji])) as Record<Colour, string>;

export interface HighlightToken extends Tokens.Generic { type: "highlight"; colour?: Colour; tokens: Tokens.Generic[] }
export const SIZES = ["small", "large", "huge"] as const;
export type Size = (typeof SIZES)[number];
/** `.serif` and `.mono`, short for the two faces a card reaches for most. */
export const FACE_ALIAS: Record<string, string> = { serif: "Source Serif 4", mono: "JetBrains Mono" };
/**
 * The fonts a card's words can be set in, by group: any family the font CDN has would do
 * (`font="…"`), and these are the ones the style bar offers.
 */
export const FONT_GROUPS: ReadonlyArray<{ group: string; fonts: readonly string[] }> = [
	{ group: "Sans", fonts: ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Work Sans", "DM Sans", "IBM Plex Sans", "Space Grotesk"] },
	{ group: "Serif", fonts: ["Source Serif 4", "Merriweather", "Lora", "Playfair Display", "EB Garamond", "Libre Baskerville", "Crimson Pro", "IBM Plex Serif"] },
	{ group: "Mono", fonts: ["JetBrains Mono", "Fira Code", "IBM Plex Mono", "Source Code Pro"] },
	{ group: "Hand and display", fonts: ["Caveat", "Patrick Hand", "Kalam", "Bebas Neue", "Pacifico"] },
];
/** Every class a span may carry: a colour, a size, a face's short name. */
const CLASSES = new Set<string>([...COLOURS, ...SIZES, ...Object.keys(FACE_ALIAS)]);
export interface ColourToken extends Tokens.Generic { type: "colour"; colour?: Colour; size?: Size; face?: string; tokens: Tokens.Generic[] }
/**
 * A span's attributes, Pandoc's way: `{.red .large font="Lora"}`. Undefined when any of them is not
 * one a card knows, so `[words]{anything}` stays the words it was typed as.
 */
export function spanAttributes(text: string): { colour?: Colour; size?: Size; face?: string } | undefined {
	const out: { colour?: Colour; size?: Size; face?: string } = {};
	const parts = text.match(/\.[\w-]+|font=(?:"[^"]*"|[\w-]+)|\S+/g) ?? [];
	if (!parts.length) return undefined;
	for (const part of parts) {
		if (part.startsWith(".")) {
			const name = part.slice(1);
			if (!CLASSES.has(name)) return undefined;
			if ((COLOURS as readonly string[]).includes(name)) out.colour = name as Colour;
			else if ((SIZES as readonly string[]).includes(name)) out.size = name as Size;
			else out.face = FACE_ALIAS[name];
		} else if (part.startsWith("font=")) {
			const family = part.slice(5).replace(/^"|"$/g, "").trim();
			if (!family) return undefined;
			out.face = family;
		} else return undefined;
	}
	return out;
}
const SPAN = `\\[((?:[^\\[\\]\\n]|\\[[^\\]\\n]*\\])+)\\]\\{([^{}\\n]+)\\}`;
export interface WikiToken extends Tokens.Generic { type: "wiki"; target: string; alias?: string; embed: boolean; width?: number }
export interface CriticToken extends Tokens.Generic { type: "critic"; op: "replace" | "add" | "remove" | "comment" | "highlight"; old: string; new: string }
export interface HiddenToken extends Tokens.Generic { type: "hidden"; text: string }

const highlight: TokenizerExtension = {
	name: "highlight",
	level: "inline",
	start: (src) => src.indexOf("=="),
	tokenizer(src) {
		// Closed at the first `==`, so two highlights side by side, `==a====b==`, are two.
		const m = /^==(🔴|🟠|🟡|🟢|🔵|🟣)?(?=\S)([^\n]*?\S)==/u.exec(src);
		if (!m) return undefined;
		const token: HighlightToken = { type: "highlight", raw: m[0], text: m[2]!, tokens: [], ...(m[1] ? { colour: HIGHLIGHT_EMOJI[m[1]] } : {}) };
		this.lexer.inlineTokens(m[2]!, token.tokens);
		return token;
	},
};

const colour: TokenizerExtension = {
	name: "colour",
	level: "inline",
	start: (src) => src.indexOf("["),
	tokenizer(src) {
		const m = new RegExp(`^${SPAN}`).exec(src);
		const attributes = m ? spanAttributes(m[2]!) : undefined;
		if (!m || !attributes) return undefined;
		const token: ColourToken = { type: "colour", raw: m[0], text: m[1]!, tokens: [], ...attributes };
		this.lexer.inlineTokens(m[1]!, token.tokens);
		return token;
	},
};

const wiki: TokenizerExtension = {
	name: "wiki",
	level: "inline",
	start: (src) => {
		const i = src.indexOf("[[");
		return i > 0 && src[i - 1] === "!" ? i - 1 : i;
	},
	tokenizer(src) {
		const m = /^(!?)\[\[([^\]\n|]+?)(?:\|([^\]\n]+))?\]\]/.exec(src);
		if (!m) return undefined;
		const embed = m[1] === "!";
		// An embed's `|240` is a width, as on an image; a link's is the words it shows.
		const width = embed && m[3] && /^\d+(x\d+)?$/.test(m[3]) ? parseInt(m[3], 10) : undefined;
		return { type: "wiki", raw: m[0], text: m[2]!.trim(), target: m[2]!.trim(), embed, ...(m[3] && width === undefined ? { alias: m[3].trim() } : {}), ...(width ? { width } : {}) } satisfies WikiToken;
	},
};

const critic: TokenizerExtension = {
	name: "critic",
	level: "inline",
	start: (src) => {
		const m = /\{(~~|\+\+|--|>>|==)/.exec(src);
		return m ? m.index : -1;
	},
	tokenizer(src) {
		let m = /^\{~~([\s\S]*?)~>([\s\S]*?)~~\}/.exec(src);
		if (m) return { type: "critic", raw: m[0], text: m[2]!, op: "replace", old: m[1]!, new: m[2]! } satisfies CriticToken;
		m = /^\{\+\+([\s\S]+?)\+\+\}/.exec(src);
		if (m) return { type: "critic", raw: m[0], text: m[1]!, op: "add", old: "", new: m[1]! } satisfies CriticToken;
		m = /^\{--([\s\S]+?)--\}/.exec(src);
		if (m) return { type: "critic", raw: m[0], text: m[1]!, op: "remove", old: m[1]!, new: "" } satisfies CriticToken;
		m = /^\{>>([\s\S]+?)<<\}/.exec(src);
		if (m) return { type: "critic", raw: m[0], text: m[1]!, op: "comment", old: "", new: m[1]! } satisfies CriticToken;
		m = /^\{==([\s\S]+?)==\}/.exec(src);
		if (m) return { type: "critic", raw: m[0], text: m[1]!, op: "highlight", old: m[1]!, new: m[1]! } satisfies CriticToken;
		return undefined;
	},
};

/** `%%hidden%%` inside a line. */
const hidden: TokenizerExtension = {
	name: "hidden",
	level: "inline",
	start: (src) => src.indexOf("%%"),
	tokenizer(src) {
		const m = /^%%([\s\S]*?)%%/.exec(src);
		return m ? ({ type: "hidden", raw: m[0], text: m[1]! } satisfies HiddenToken) : undefined;
	},
};

/** `%%` on a line of its own opens a hidden block, closed by the next `%%`. */
const hiddenBlock: TokenizerExtension = {
	name: "hiddenBlock",
	level: "block",
	start: (src) => {
		const m = /^%%/m.exec(src);
		return m ? m.index : -1;
	},
	tokenizer(src) {
		const m = /^%%[^\n]*?(?:\n[\s\S]*?)?%%[ \t]*(?:\n+|$)/.exec(src);
		return m ? ({ type: "hidden", raw: m[0], text: m[0] } satisfies HiddenToken) : undefined;
	},
};

/** The one reader of a card's markdown. */
export const cardMarked = (): Marked => new Marked({ gfm: true, breaks: false }, { extensions: [hiddenBlock, hidden, critic, wiki, colour, highlight] });

/** An image's alt with Obsidian's `|240` or `|240x120` taken off: its words and its width. */
export function sizedAlt(alt: string): { alt: string; width?: number } {
	const m = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(alt);
	return m ? { alt: m[1]!.trim(), width: parseInt(m[2]!, 10) } : { alt };
}

/** Obsidian's callout types, folded onto the colour each is drawn in, as Obsidian draws them. */
export const CALLOUTS: Record<string, string> = {
	note: "blue", info: "blue", todo: "blue",
	abstract: "cyan", summary: "cyan", tldr: "cyan", tip: "cyan", hint: "cyan", important: "cyan",
	success: "green", check: "green", done: "green",
	question: "orange", help: "orange", faq: "orange", warning: "orange", caution: "orange", attention: "orange",
	failure: "red", fail: "red", missing: "red", danger: "red", error: "red", bug: "red",
	example: "purple",
	quote: "gray", cite: "gray",
};

/**
 * A card's markdown as Obsidian takes it: coloured words lose their colour, an open suggestion
 * goes out as the words it would replace, and its reason as a hidden `%%comment%%`.
 */
export function toObsidian(md: string): string {
	return plainSpans(md)
		.replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, "$1")
		.replace(/\{\+\+([\s\S]+?)\+\+\}/g, "")
		.replace(/\{--([\s\S]+?)--\}/g, "$1")
		.replace(/\{==([\s\S]+?)==\}/g, "==$1==")
		.replace(/\s*\{>>([\s\S]+?)<<\}/g, " %%$1%%")
;
}

/** Styled words, `[words]{.red .large}`, as the words alone; a span inside a span too. */
function plainSpans(md: string): string {
	const span = new RegExp(SPAN, "g");
	for (let was = ""; was !== md; ) (was = md), (md = md.replace(span, (whole, words: string, attributes: string) => (spanAttributes(attributes) ? words : whole)));
	return md;
}
