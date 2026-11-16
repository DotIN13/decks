// Words put into a draft at the caret, with one space either side and none doubled.

/** Putting a mention into what is being typed, where the caret is. */
export function withMention(text: string, caret: number, mention: string): { text: string; caret: number } {
	const at = Math.max(0, Math.min(caret, text.length));
	const before = text.slice(0, at);
	const after = text.slice(at);
	const lead = before === "" || /\s$/.test(before) ? "" : " ";
	const trail = /^\s/.test(after) ? "" : " ";
	const inserted = `${lead}${mention}${trail}`;
	return { text: before + inserted + after, caret: before.length + inserted.length };
}
