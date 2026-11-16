// Which parts of a shortcut's words are keys, drawn as keycaps, and which are words:
// the shape of a key is the rule, so the data stays a sentence.

export type Token = { cap: string } | { word: string } | { or: true };

/**
 * One cell of the key column, as things to draw.
 *
 * Alternatives come back separated by `{ or: true }` so the renderer decides how a dot
 * looks; a chord comes back as neighbouring caps with nothing between them, which is what
 * `shift` `arrows` sitting side by side already says.
 */
export function tokens(keys: string): Token[] {
	const out: Token[] = [];
	const alternatives = keys.split(" · ");
	for (const [index, alternative] of alternatives.entries()) {
		if (index > 0) out.push({ or: true });
		out.push(...parts(alternative.trim()));
	}
	return out;
}

function parts(alternative: string): Token[] {
	if (!alternative) return [];
	if (isKey(alternative)) return [{ cap: alternative }];

	/*
	 * A hyphen is a chord only when it joins two keys.
	 *
	 * Split on the *first* hyphen and ask about both halves, rather than splitting on all of
	 * them: "two-finger scroll" has a hyphen and no keys anywhere in it, and a per-hyphen
	 * loop would have to put it back together again.
	 */
	const hyphen = alternative.indexOf("-");
	if (hyphen > 0) {
		const left = alternative.slice(0, hyphen);
		const right = alternative.slice(hyphen + 1);
		if (isKey(left)) return [{ cap: left }, ...parts(right)];
	}
	return [{ word: alternative }];
}

/** Whether a bare token is a key rather than a word. */
export function isKey(token: string): boolean {
	if (!token) return false;
	if (NAMED.has(token.toLowerCase())) return true;
	// A single character: `0`, `V`, `/`, `[`, `⌫`. Counted in code points, so `⌫` is one.
	if ([...token].length === 1) return true;
	// A chord written the way a Mac writes it: the glyph and one letter, `⌘D`.
	return /^[⌘⇧⌥⌃][A-Za-z0-9]$/.test(token);
}

/** The named keys that appear on this sheet. Modifiers, and the two that are words. */
const NAMED = new Set(["space", "shift", "arrows", "esc", "escape", "enter", "tab", "ctrl", "alt", "option", "cmd", "del"]);
