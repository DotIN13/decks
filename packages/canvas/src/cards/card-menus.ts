import { m } from "@decks/i18n";

/** What the style bar's menus offer: the kinds of block, the sizes of words, and the six colours of a mark or of words. */
export const BLOCK_MENU: ReadonlyArray<[string, () => string]> = [["p", () => m.canvas_card_block_body()], ["h1", () => m.canvas_card_block_h1()], ["h2", () => m.canvas_card_block_h2()], ["h3", () => m.canvas_card_block_h3()], ["quote", () => m.canvas_card_block_quote()], ["code", () => m.canvas_card_block_code()]];
export const SIZE_MENU: ReadonlyArray<[string, () => string]> = [["small", () => m.canvas_card_size_small()], ["normal", () => m.canvas_card_size_normal()], ["large", () => m.canvas_card_size_large()], ["huge", () => m.canvas_card_size_huge()]];
export const SIX = ["yellow", "orange", "red", "green", "blue", "purple"] as const;
