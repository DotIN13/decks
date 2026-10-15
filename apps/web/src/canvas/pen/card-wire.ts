import type { TextStyle } from "@decks/pen";
import { highlight } from "./highlight.ts";
import { parseMarkdown, type Block, type Run } from "./markdown.ts";

/**
 * A card's markdown, parsed here and handed to the C++ scene (`packages/engine/cpp/card.cpp`), which
 * lays it out as `layoutMarkdown` does (`markdown-layout.ts`) and measures every paragraph itself.
 *
 * Numbers, and a pool of UTF-8 each string points into by its offset and length. A run's words are
 * written as `layoutMarkdown` sets them (a picture's alt after 🖼, a suggestion's 💬), with the font
 * chain it asks for; what only changes colour is left out, since it changes no size.
 */
export interface CardWire {
	numbers: Float64Array;
	pool: Uint8Array;
}

export interface CardEnv {
	chain(family: string): readonly string[];
	mono: string;
	scheme: "light" | "dark";
	/** A picture's size once it has arrived, as the card is drawn with it. */
	image?(url: string): { width(): number; height(): number } | undefined;
}

const SIZE_SCALE = { small: 0.85, large: 1.25, huge: 1.6 } as const;
const encoder = new TextEncoder();

export function encodeCard(text: string, style: TextStyle, env: CardEnv): CardWire {
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
				numbers.push(block.blocks.length);
				blocks(block.blocks);
				return;
			case "code": {
				const coloured = highlight(block.text.replace(/\n$/, ""), block.lang, env.scheme);
				numbers.push(7, coloured.length);
				for (const run of coloured) {
					ref(run.text);
					numbers.push((run.bold ? 4 : 0) | (run.italic ? 8 : 0));
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
	numbers.push(1, style.fontSize, style.fontWeight, style.letterSpacing, style.lineHeight ?? NaN);
	ref(chain(style.fontFamily));
	ref(chain(env.mono));
	numbers.push(parsed.length);
	blocks(parsed);
	return { numbers: Float64Array.from(numbers), pool: Uint8Array.from(bytes) };
}
