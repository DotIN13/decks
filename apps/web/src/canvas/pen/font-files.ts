import { isMarkdown, isMarkdownText, textStyleOf, walk, type PenDocument, type PenNode, type TextStyle, type ThemeState } from "@decks/pen";
import { parseMarkdown, wordsOf } from "./markdown.ts";
import { SERIF_FAMILY } from "./markdown-layout.ts";

/**
 * Which font files a drawing's words need, and where they come from: the page's fonts (`fonts.ts`)
 * and the server's measure (`apps/server/src/stage/text.ts`) both fetch by this list, so the two
 * hold the same files and measure the same words alike. Nothing here touches a browser.
 *
 * The files come from Fontsource's CDN, which serves every Google font as TrueType. The fallback
 * chain is the family asked for, then Inter (pen.dev's default), then Noto Sans SC for Chinese and
 * Japanese, the Noto symbol fonts for arrows and ticks, and Noto Color Emoji. A family Fontsource
 * does not have falls through to Inter.
 */

/** The face a card's `code` is set in. */
export const MONO_FAMILY = "JetBrains Mono";
export const FONT_CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
export const FALLBACK_FAMILY = "Inter";
const CJK_FAMILY = "Noto Sans SC";
const CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
/** Arrows, ticks, stars and the other signs Inter does not draw. */
const SYMBOL_FAMILIES = ["Noto Sans Symbols 2", "Noto Sans Symbols"];
const SYMBOLS = /[\u2190-\u21ff\u2300-\u23ff\u2460-\u27bf\u2900-\u2bff]/;
const EMOJI_FAMILY = "Noto Color Emoji";
/** Added to a face's name for its extended-Latin file (`fontChain`). */
const EXT = " Ext";
const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * The families a paragraph in `family` asks for, in order. A face's extended-Latin letters are a
 * file of their own under a name of their own (`EXT`), tried after the face: registered under the
 * face's own name, the extended file was sometimes picked for plain words, and it has no digits or
 * punctuation, so "10 s" came out in a symbol font and a full stop as a missing-glyph box.
 */
export function fontChain(family: string): string[] {
	return [...new Set([family, `${family}${EXT}`, FALLBACK_FAMILY, `${FALLBACK_FAMILY}${EXT}`, CJK_FAMILY, ...SYMBOL_FAMILIES, EMOJI_FAMILY])];
}

export interface FontNeed {
	family: string;
	weight: number;
	italic: boolean;
	text: string;
}

/** One file: `key` names it, `family` is what it is registered as, and `fallback` is tried when `url` fails. */
export interface FontFile {
	key: string;
	family: string;
	url: string;
	fallback?: string;
}

export const fontsourceId = (family: string) => family.trim().toLowerCase().replace(/\s+/g, "-");
export const roundWeight = (weight: number) => Math.min(900, Math.max(100, Math.round(weight / 100) * 100));

/** The files these texts need, Inter's upright always among them. */
export function fontFiles(needs: readonly FontNeed[]): FontFile[] {
	const wanted = new Map<string, FontFile>();
	const want = (family: string, subset: string, weight: number, italic: boolean) => {
		const id = fontsourceId(family);
		const style = italic ? "italic" : "normal";
		const key = `${id}/${subset}/${weight}/${style}`;
		const name = subset === "latin-ext" ? `${family}${EXT}` : family;
		if (!wanted.has(key)) wanted.set(key, { key, family: name, url: `${FONT_CDN}/${id}@latest/${subset}-${weight}-${style}.ttf`, ...(weight !== 400 || italic ? { fallback: `${FONT_CDN}/${id}@latest/${subset}-400-normal.ttf` } : {}) });
	};
	want(FALLBACK_FAMILY, "latin", 400, false);
	for (const need of needs) {
		const weight = roundWeight(need.weight);
		for (const family of new Set([need.family, FALLBACK_FAMILY])) {
			want(family, "latin", weight, need.italic);
			// Letters past plain Latin that are still Latin: ā, ł, ő, ș, ẞ and the rest.
			if (/[\u0100-\u024f\u1e00-\u1eff]/.test(need.text)) want(family, "latin-ext", weight, need.italic);
		}
		if (CJK.test(need.text)) want(CJK_FAMILY, "chinese-simplified", weight >= 600 ? 700 : 400, false);
		if (SYMBOLS.test(need.text)) for (const family of SYMBOL_FAMILIES) want(family, "symbols", 400, false);
		if ([...need.text].some((ch) => EMOJI.test(ch) && !SYMBOLS.test(ch))) want(EMOJI_FAMILY, "emoji", 400, false);
	}
	return [...wanted.values()];
}

/** What a drawing's words need from the font CDN. */
export function fontNeeds(nodes: readonly PenNode[], doc: PenDocument, theme: ThemeState): FontNeed[] {
	const needs: FontNeed[] = [];
	for (const node of walk(nodes)) {
		if (typeof node.content !== "string" || !node.content) continue;
		needs.push(...textNeeds(node.content, textStyleOf(doc, node, theme), isMarkdown(node) || isMarkdownText(node)));
	}
	return needs;
}

/** What one text needs, set in `style`, and read as markdown when it is a card's. */
export function textNeeds(content: string, style: TextStyle, markdown: boolean): FontNeed[] {
	const needs: FontNeed[] = [{ family: style.fontFamily, weight: style.fontWeight, italic: style.fontStyle === "italic", text: content }];
	if (!markdown) return needs;
	// A markdown card sets headings and bold heavier, emphasis in italic and code in a monospace face.
	// The picture sign only for a card that has a picture: it is an emoji, and the emoji font is 25MB
	// of a phone's memory for a card that never shows it.
	const pictured = /!\[|<img\b/i.test(content);
	needs.push({ family: style.fontFamily, weight: 400, italic: false, text: `${wordsOf(parseMarkdown(content))}◦▪${pictured ? "🖼" : ""}` });
	needs.push({ family: style.fontFamily, weight: 700, italic: false, text: content }, { family: style.fontFamily, weight: 600, italic: false, text: content }, { family: style.fontFamily, weight: style.fontWeight, italic: true, text: content });
	if (/`|^( {4}|\t)|<code|<pre|\.mono\b/m.test(content)) needs.push({ family: MONO_FAMILY, weight: 400, italic: false, text: content }, { family: MONO_FAMILY, weight: 700, italic: false, text: content });
	// Words in a font of their own, `[words]{font="Lora"}` or `.serif`, in its upright, bold and italic.
	const faces = new Set([...content.matchAll(/font=(?:"([^"]+)"|([\w-]+))/g)].map((m) => (m[1] ?? m[2])!));
	if (/\.serif\b/.test(content)) faces.add(SERIF_FAMILY);
	for (const family of faces) needs.push({ family, weight: 400, italic: false, text: content }, { family, weight: 700, italic: false, text: content }, { family, weight: 400, italic: true, text: content });
	return needs;
}
