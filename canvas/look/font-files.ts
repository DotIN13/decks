import { isMarkdown, isMarkdownText, textStyleOf, walk, type PenDocument, type PenNode, type TextStyle, type ThemeState } from "@decks/pen";
import type { FontNeed } from "@decks/protocol/fonts";
import { FACE_ALIAS } from "../cards/card-syntax.ts";
import { parseMarkdown, wordsOf } from "../cards/markdown.ts";

// What a drawing's words need from the font files: the files themselves, and where they come from, are
// the protocol's (`protocol/fonts.ts`), so the page's engine and the server's pictures fetch the same.

export { EMOJI_URL, FALLBACK_FAMILY, FONT_CDN, fontFiles, fontsourceId, isFallbackFamily, roundWeight, type FontFile, type FontNeed } from "@decks/protocol/fonts";

/** The serif a card's `{.serif}` words are set in. */
export const SERIF_FAMILY = FACE_ALIAS.serif!;
/** The face a card's `code` is set in. */
const MONO_FAMILY = "JetBrains Mono";

/** What a drawing's words need from the font CDN. */
export function fontNeeds(nodes: readonly PenNode[], doc: PenDocument, theme: ThemeState): FontNeed[] {
	const needs: FontNeed[] = [];
	for (const node of walk(nodes)) {
		if (typeof node.content !== "string" || !node.content) continue;
		needs.push(...textNeeds(node.content, textStyleOf(doc, node, theme), isMarkdown(node) || isMarkdownText(node)));
	}
	return needs;
}

/**
 * What the stage engine will ask for (`font_needs` in `crates/web/src/engine.rs`), read from the
 * drawing before the engine is up, so the files are on their way while it loads: each text, note,
 * prompt and context in its face, and a markdown one in its bold, semibold and italic and in the
 * monospace face too. Read the same way, so nothing is fetched here that the engine would not ask
 * for; anything the engine finds besides it fetches itself.
 */
export function stageFontNeeds(nodes: readonly PenNode[], doc: PenDocument, theme: ThemeState): FontNeed[] {
	const needs: FontNeed[] = [];
	for (const node of walk(nodes)) {
		if (!["text", "note", "prompt", "context"].includes(node.type) || typeof node.content !== "string") continue;
		const style = textStyleOf(doc, node, theme);
		const italic = style.fontStyle === "italic";
		needs.push({ family: style.fontFamily, weight: style.fontWeight, italic, text: node.content });
		if (node.metadata?.type !== "decks.markdown") continue;
		for (const [weight, slanted] of [[600, false], [700, false], [400, true]] as const) needs.push({ family: style.fontFamily, weight, italic: slanted, text: node.content });
		needs.push({ family: MONO_FAMILY, weight: 400, italic: false, text: node.content });
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
