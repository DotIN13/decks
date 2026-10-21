/**
 * Putting a mention into what is being typed, where the caret is.
 *
 * A file attached or dropped is something you are about to talk about, so it goes into the
 * sentence at the caret — not over it, which is what a rewound message does, because there
 * the field was about to be rewritten anyway. A space either side unless one is already there,
 * so a mention is never glued to a word, and the caret lands after it, ready for the next.
 */
export function withMention(text: string, caret: number, mention: string): { text: string; caret: number } {
	const at = Math.max(0, Math.min(caret, text.length));
	const before = text.slice(0, at);
	const after = text.slice(at);
	const lead = before === "" || /\s$/.test(before) ? "" : " ";
	const trail = /^\s/.test(after) ? "" : " ";
	const inserted = `${lead}${mention}${trail}`;
	return { text: before + inserted + after, caret: before.length + inserted.length };
}
