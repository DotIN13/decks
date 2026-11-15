import { estimateText, isMarkdown, isMarkdownText, type MeasureText, type TextStyle } from "@decks/pen";

/**
 * Words measured as the server measures them (`apps/server/src/stage/text.ts`): with the stage
 * engine's own fonts and markdown reader (`PageEngine.measure`, the server's `TextMeasure`), and by
 * the estimate while the engine is not up or a font the words need has not landed, as the server
 * does then. A person's edit is laid out with this on the page ahead of the server's drawing
 * (`drawing.ts`), so a card sized by its words is the size the server will find, and an arrow joined
 * to it is routed where the server will route it.
 *
 * The stage's engine (`engine.ts`) gives its words here while it runs: one at a time, the last started.
 */
export type Words = (text: string, style: TextStyle, maxWidth: number, markdown: boolean, align: string) => { w: number; h: number } | undefined;

let words: Words | undefined;

/** The running engine's words, or undefined when it stops (only the one given takes itself away). */
export function setStageWords(next: Words | undefined, was?: Words): void {
	if (next || words === was) words = next;
}

export const stageMeasure: MeasureText = (text, style, maxWidth, node) => {
	const markdown = !!node && (isMarkdown(node) || isMarkdownText(node));
	const align = markdown ? (node!.textAlign ?? "left") : "";
	return words?.(text, style, markdown ? (maxWidth ?? 240) : (maxWidth ?? -1), markdown, align) ?? estimateText(text, style, maxWidth, node);
};
