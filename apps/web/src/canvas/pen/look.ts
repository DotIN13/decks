import { FALLBACK_FAMILY, FONT_CDN, fontsourceId, roundWeight } from "./font-files.ts";
import type { Block } from "./markdown.ts";

/**
 * What the stage's own HTML takes from how the engine draws: a card's palette and where its first
 * line sits, so the editor over a card lines up with the words under it, and a note's corner.
 * The engine draws the same (`packages/stage/crates/text/src/card.rs`).
 */

/** The app's palette (`index.css`), light and dark. */
export const CARD_PALETTE = {
	light: { paper: "#ffffff", fg: "#161616", muted: "#5c5c5c", faint: "#808080", line: "#0000001a", strong: "#00000033", subtle: "#f2f2f2", code: "#0000000f", accent: "#3b5cf6", box: "#ffffff" },
	dark: { paper: "#242424", fg: "#fafafa", muted: "#aeaeae", faint: "#808080", line: "#ffffff1f", strong: "#ffffff3d", subtle: "#2e2e2e", code: "#ffffff14", accent: "#6f8bff", box: "#242424" },
} as const;
const HEADING_SIZE = [1.6, 1.3, 1.12, 1, 0.9, 0.85];

/** Where a card's first block puts its first line, from the card's words' top. */
export function firstLine(block: Block | undefined, size: number, lineHeight?: number): { top: number; height: number } {
	const line = (s: number, multiplier = 1.5) => s * (lineHeight ?? multiplier);
	switch (block?.kind) {
		case "heading":
			return { top: 0, height: line(size * HEADING_SIZE[block.level - 1]!, 1.3) };
		case "list":
			return firstLine(block.items[0]?.blocks[0], size, lineHeight);
		case "quote":
			if (block.alert) return { top: size * 0.4, height: line(size) };
			return firstLine(block.blocks[0], size, lineHeight);
		case "code":
			return { top: size * 0.85, height: size * 0.88 * 1.5 };
		case "table":
			return { top: 0, height: size * 0.45 * 2 + line(size * 0.9) };
		case "rule":
			return { top: 0, height: size + 1 };
		case "math":
			return { top: 0, height: line(size) };
		case "image":
		case "embed":
			return { top: 0, height: size * 3 };
		default:
			return { top: 0, height: line(size) };
	}
}
/** The serif a page font is fetched in for the editor (`card-syntax.ts`, `FACE_ALIAS`). */
export { SERIF_FAMILY } from "./font-files.ts";

/** A note's and a board's corner on the canvas (`--radius-panel`). */
export const NOTE_RADIUS = 12;

/**
 * The same font files the canvas draws with, for the page's own text: the editor that types over a
 * drawn item has to set its words exactly where the canvas set them, and a system font in its place
 * wraps and spaces them differently. Registered under a name of their own ("Pen Inter"), so the
 * app's interface fonts are never touched, and fetched once per family, weight and style.
 */
const pageFonts = new Map<string, Promise<void>>();
export function pageFont(family: string, weight: number, italic: boolean): string {
	const face = (name: string) => {
		const w = roundWeight(weight);
		const style = italic ? "italic" : "normal";
		const key = `${name}/${w}/${style}`;
		if (!pageFonts.has(key)) {
			const id = fontsourceId(name);
			const load = async () => {
				{
					const font = new FontFace(`Pen ${name}`, `url(${FONT_CDN}/${id}@latest/latin-${w}-${style}.woff2)`, { weight: String(w), style });
					try {
						document.fonts.add(await font.load());
					} catch {
						/* a family the CDN does not have: the next name in the list is used */
					}
				}
			};
			pageFonts.set(key, load());
		}
	};
	face(family);
	face(FALLBACK_FAMILY);
	return `"Pen ${family}", "Pen ${FALLBACK_FAMILY}", system-ui, sans-serif`;
}
