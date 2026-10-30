import { highlight } from "./highlight.ts";
import { parseMarkdown, type Block } from "../model/markdown.ts";
import { typesetFormula } from "./math.ts";

/** The app's typesetter, as the engine calls it: TeX in, the formula's outlines out as JSON, or null. */
export function mathTypesetter(): (tex: string, display: boolean) => string | null {
	return (tex, display) => {
		const formula = typesetFormula(tex, display);
		return formula && formula.width > 0 ? JSON.stringify(formula) : null;
	};
}

/**
 * The app's markdown reader, as the engine calls it: a card's source in, its blocks out as JSON,
 * with each code block's words already coloured by the app's highlighter.
 */
export function cardReader(scheme: "light" | "dark"): (source: string) => string {
	const colour = (blocks: Block[]): unknown[] =>
		blocks.map((block) => {
			switch (block.kind) {
				case "code":
					return { ...block, runs: highlight(block.text.replace(/\n$/, ""), block.lang, scheme) };
				case "list":
					return { ...block, items: block.items.map((item) => ({ ...item, blocks: colour(item.blocks) })) };
				case "quote":
					return { ...block, blocks: colour(block.blocks) };
				case "footnotes":
					return { ...block, items: block.items.map((item) => ({ ...item, blocks: colour(item.blocks) })) };
				default:
					return block;
			}
		});
	return (source) => JSON.stringify(colour(parseMarkdown(source)));
}
