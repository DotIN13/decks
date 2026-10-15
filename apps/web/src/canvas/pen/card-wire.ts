import type { TextStyle } from "@decks/pen";
import { highlight } from "./highlight.ts";
import { parseMarkdown, type Block, type Run } from "./markdown.ts";
import { ALERTS, CARD_PALETTE, INK, MARK, SUGGEST } from "./markdown-layout.ts";

/**
 * A card's markdown, parsed here and handed to the C++ scene (`packages/engine/cpp/card.cpp`), which
 * lays it out as `layoutMarkdown` does (`markdown-layout.ts`) and measures every paragraph itself.
 *
 * Numbers, and a pool of UTF-8 each string points into by its offset and length. A run's words are
 * written as `layoutMarkdown` sets them (a picture's alt after 🖼, a suggestion's 💬), with the font
 * chain it asks for, and what the painter needs to draw it (`paint.cpp`): the palette, and each run's
 * ink, background and lines, as colours [r, g, b, a] where an alpha of -1 means the block's own colour.
 */
export interface CardWire {
	numbers: Float64Array;
	pool: Uint8Array;
}

export interface CardEnv {
	chain(family: string): readonly string[];
	mono: string;
	scheme: "light" | "dark";
	/** A picture's size once it has arrived, as the card is drawn with it, and its id with the painter. */
	image?(url: string): { width(): number; height(): number; id?: number } | undefined;
}

const SIZE_SCALE = { small: 0.85, large: 1.25, huge: 1.6 } as const;
const encoder = new TextEncoder();
/** A colour as four numbers, from `#rrggbb` or `#rrggbbaa`. */
const rgba = (hex: string): number[] => {
	const n = parseInt(hex.slice(1), 16);
	const a = hex.length > 7 ? (n & 0xff) / 255 : 1;
	const rgb = hex.length > 7 ? n >>> 8 : n;
	return [((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255, a];
};
/** The block's own colour, whatever it is where the run sits. */
const INHERIT = [0, 0, 0, -1];
const NONE = [0, 0, 0, 0];
const PALETTE = ["fg", "muted", "faint", "line", "strong", "subtle", "code", "accent", "box"] as const;

export function encodeCard(text: string, style: TextStyle, env: CardEnv, align = "left"): CardWire {
	const numbers: number[] = [];
	const bytes: number[] = [];
	const known = new Map<string, [number, number]>();
	const ref = (value: string) => {
		let at = known.get(value);
		if (!at) {
			const encoded = encoder.encode(value);
			at = [bytes.length, encoded.length];
			for (const byte of encoded) bytes.push(byte);
			known.set(value, at);
		}
		numbers.push(at[0], at[1]);
	};
	const chain = (family: string) => env.chain(family).join("\n");
	const runs = (list: readonly Run[]) => {
		numbers.push(list.length);
		list.forEach((run, i) => {
			ref(run.image ? `🖼 ${run.image.alt || "image"}` : run.text + (run.reason && list[i + 1]?.reason !== run.reason ? " 💬" : ""));
			ref(chain(run.code ? env.mono : (run.face ?? style.fontFamily)));
			numbers.push((run.code ? 1 : 0) | (run.sup ? 2 : 0) | (run.bold ? 4 : 0) | (run.italic ? 8 : 0), run.size ? SIZE_SCALE[run.size] : 1);
			// How it is drawn, as `para` in markdown-layout.ts styles it: ink, background, lines and their colour.
			const C = CARD_PALETTE[env.scheme];
			const S = SUGGEST[env.scheme];
			const ink = run.added ? S.added : run.removed ? S.removed : run.link || run.wiki || run.sup ? C.accent : run.image ? C.muted : run.colour ? INK[run.colour][env.scheme] : undefined;
			const back = run.added ? S.addedBg : run.mark ? MARK[run.mark][env.scheme] : run.code ? C.code : undefined;
			let lines = 0;
			let lineInk: number[] = INHERIT;
			if (run.strike || run.removed) (lines = 2), (lineInk = run.removed ? rgba(S.removed) : INHERIT);
			if (run.link || run.wiki) (lines = 1), (lineInk = rgba(`${C.accent}66`));
			if (run.added) (lines = 1), (lineInk = rgba(S.added));
			if (run.underline) (lines = 1 | (run.strike ? 2 : 0)), (lineInk = ink ? rgba(ink) : INHERIT);
			numbers.push(...(ink ? rgba(ink) : INHERIT), ...(back ? rgba(back) : NONE), lines, ...lineInk);
			// Where its link goes, for the page's presses (`cardGeometry`); empty for none.
			ref(run.link ?? "");
		});
	};
	const blocks = (list: readonly Block[]) => {
		for (const block of list) one(block);
	};
	const one = (block: Block) => {
		switch (block.kind) {
			case "heading":
				numbers.push(1, block.level);
				runs(block.runs);
				return;
			case "paragraph":
				numbers.push(2);
				runs(block.runs);
				return;
			case "image": {
				const image = env.image?.(block.url);
				const has = !!image && image.width() > 0;
				numbers.push(3, has ? 1 : 0, has ? image!.width() : 0, has ? image!.height() : 0, block.width ?? NaN);
				ref(`🖼 ${block.alt || block.url}`);
				numbers.push(has && image!.id !== undefined ? image!.id : -1);
				return;
			}
			case "embed":
				numbers.push(4);
				ref(`📄 ${block.target}`);
				return;
			case "list":
				numbers.push(5, block.ordered ? 1 : 0, block.start, block.loose ? 1 : 0, block.items.length);
				for (const item of block.items) {
					numbers.push(item.checked === undefined ? -1 : item.checked ? 1 : 0, item.blocks.length);
					blocks(item.blocks);
				}
				return;
			case "quote":
				numbers.push(6, block.alert ? 1 : 0);
				ref(block.title ?? "Note");
				numbers.push(...(block.alert ? rgba(ALERTS[block.alert][env.scheme]) : NONE), block.blocks.length);
				blocks(block.blocks);
				return;
			case "code": {
				const coloured = highlight(block.text.replace(/\n$/, ""), block.lang, env.scheme);
				numbers.push(7, coloured.length);
				for (const run of coloured) {
					ref(run.text);
					numbers.push((run.bold ? 4 : 0) | (run.italic ? 8 : 0), ...(run.colour ? rgba(run.colour) : INHERIT));
				}
				return;
			}
			case "table": {
				const rows = [block.header, ...block.rows];
				const columns = Math.max(...rows.map((row) => row.length));
				numbers.push(8, columns, rows.length);
				for (let c = 0; c < columns; c++) numbers.push(block.align[c] === "center" ? 1 : block.align[c] === "right" ? 2 : 0);
				for (const row of rows) for (let c = 0; c < columns; c++) runs(row[c] ?? []);
				return;
			}
			case "rule":
				numbers.push(9);
				return;
			case "footnotes":
				numbers.push(10, block.items.length);
				for (const item of block.items) {
					numbers.push(item.number, item.blocks.length);
					blocks(item.blocks);
				}
				return;
		}
	};
	const parsed = parseMarkdown(text);
	numbers.push(2, style.fontSize, style.fontWeight, style.letterSpacing, style.lineHeight ?? NaN);
	ref(chain(style.fontFamily));
	ref(chain(env.mono));
	// The palette, in `PALETTE`'s order, and the alignment the card's paragraphs take.
	for (const name of PALETTE) numbers.push(...rgba(CARD_PALETTE[env.scheme][name]));
	numbers.push(align === "center" ? 2 : align === "right" ? 1 : 0, parsed.length);
	blocks(parsed);
	return { numbers: Float64Array.from(numbers), pool: Uint8Array.from(bytes) };
}
