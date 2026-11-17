/** What the style bar's menus offer: the kinds of block, the sizes of words, and the six colours of a mark or of words. */
export const BLOCK_MENU: ReadonlyArray<[string, string]> = [["p", "Body text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["quote", "Quote"], ["code", "Code block"]];
export const SIZE_MENU: ReadonlyArray<[string, string]> = [["small", "Small"], ["normal", "Normal"], ["large", "Large"], ["huge", "Huge"]];
export const SIX = ["yellow", "orange", "red", "green", "blue", "purple"] as const;
