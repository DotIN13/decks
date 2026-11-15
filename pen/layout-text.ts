import type { PenDocument, PenNode } from "./types.ts";
import { fontWeightOf, num, resolve, type ThemeState } from "./values.ts";

/**
 * Measure text: one line when `maxWidth` is undefined, wrapped at it otherwise. `node` is the item
 * the words belong to, for a measure that sets some items' words differently (a markdown card's).
 */
export type MeasureText = (text: string, style: TextStyle, maxWidth: number | undefined, node?: PenNode) => { w: number; h: number };

export interface TextStyle {
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	fontStyle: string;
	letterSpacing: number;
	/** A multiplier of the font size; undefined is the font's own, as pen.dev draws it. */
	lineHeight: number | undefined;
}

export const DEFAULT_FONT = "Inter";
export const DEFAULT_FONT_SIZE = 14;
/** The note's padding and default width: pen.dev draws a note as a card with its text inside. */
export const NOTE_PAD = 16;
export const NOTE_WIDTH = 240;
/** The items whose size comes from their words. */
export const TEXTY = new Set(["text", "note", "prompt", "context"]);

/** A rough measure for the server, where there is no font engine: 0.55 em a character, 1 em for wide scripts. */
export const estimateText: MeasureText = (text, style, maxWidth) => {
	const em = style.fontSize;
	const charWidth = (ch: string) => (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? em : em * 0.55) + style.letterSpacing;
	const lineHeight = em * (style.lineHeight ?? 1.2);
	const lines: number[] = [];
	for (const paragraph of text.split("\n")) {
		if (maxWidth === undefined) {
			lines.push([...paragraph].reduce((sum, ch) => sum + charWidth(ch), 0));
			continue;
		}
		let line = 0;
		for (const word of paragraph.split(/(\s+)/)) {
			const width = [...word].reduce((sum, ch) => sum + charWidth(ch), 0);
			if (line > 0 && line + width > maxWidth && word.trim()) {
				lines.push(line);
				line = width;
			} else line += width;
		}
		lines.push(line);
	}
	const widest = Math.max(0, ...lines);
	return { w: maxWidth === undefined ? widest : Math.min(maxWidth, widest), h: Math.max(1, lines.length) * lineHeight };
};

export function textStyleOf(doc: PenDocument, node: PenNode, theme: ThemeState): TextStyle {
	const family = resolve(doc, node.fontFamily, theme);
	const style = resolve(doc, node.fontStyle, theme);
	return {
		fontFamily: typeof family === "string" && family ? family : DEFAULT_FONT,
		fontSize: num(doc, node.fontSize, theme, DEFAULT_FONT_SIZE),
		fontWeight: fontWeightOf(doc, node, theme),
		fontStyle: typeof style === "string" ? style : "normal",
		letterSpacing: num(doc, node.letterSpacing, theme, 0),
		lineHeight: node.lineHeight === undefined ? undefined : num(doc, node.lineHeight, theme, 1.2),
	};
}
