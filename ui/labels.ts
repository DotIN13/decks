/** How long a label may be before it is cut, in characters (`shortLabel`). */
export const LABEL_LIMIT = 28;

/** Any words, on one line, short enough to sit in a sentence. */
export function shortLabel(words: string): string {
	const flat = words.replace(/\s+/g, " ").trim();
	return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT - 1).trimEnd()}…` : flat;
}
