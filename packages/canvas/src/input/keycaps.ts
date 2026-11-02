/**
 * Which parts of "shift-arrows" are keys and which are words.
 *
 * The cheat sheet's left column is a mix: real keys (`0`, `⌘D`, `⌫`), gestures (`pinch`,
 * `two-finger scroll`), whole sentences (`drop a file on a board`), and hybrids of a key and
 * a word (`space-drag`, `⌘-wheel`). Only the keys should be drawn as keycaps — a rounded
 * bordered box round "drop a file on a board" is a caption pretending to be a keyboard.
 *
 * The alternative was to mark them up in the data, and it was worse: the rows read as prose
 * today and would have become `[["⌘"], [{word: "wheel"}]]`, which is harder to write, harder
 * to scan, and easy to get subtly wrong in a list of forty. So the *shape of a key* is the
 * rule, stated here once and tested, and the data stays a sentence.
 *
 * Three rules, in order:
 *
 * 1. **` · ` separates alternatives.** "either of these does it", drawn with a faint dot.
 * 2. **A hyphen joins a chord** — but only where both halves are keys. `shift-arrows` is two
 *    caps; `space-drag` is a cap and a word; `double-click` is neither, so it stays whole.
 * 3. **A key is a key by its shape**: a named one, a single character, or `⌘` with a letter.
 */

/** The named keys that appear on this sheet. Modifiers, and the two that are words. */
const NAMED = new Set(["space", "shift", "arrows", "esc", "escape", "enter", "tab", "ctrl", "alt", "option", "cmd", "del"]);

export type Token = { cap: string } | { word: string } | { or: true };

/** Whether a bare token is a key rather than a word. */
export function isKey(token: string): boolean {
	if (!token) return false;
	if (NAMED.has(token.toLowerCase())) return true;
	// A single character: `0`, `V`, `/`, `[`, `⌫`. Counted in code points, so `⌫` is one.
	if ([...token].length === 1) return true;
	// A chord written the way a Mac writes it: the glyph and one letter, `⌘D`.
	return /^[⌘⇧⌥⌃][A-Za-z0-9]$/.test(token);
}

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
