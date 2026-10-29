/**
 * A card's scripts, as whoever serves cards serves them (a harness, Decks Studio): each inline script
 * that runs is a module at its own address beside the card, `sales.html.m0.js`, so its relative
 * imports resolve from the card's folder and an error names the card's file. The stage counts the
 * same scripts in the same order (`@decks/canvas`, `card.ts`).
 */

/** A script's `type` that is JavaScript a card runs: none, a module, or a plain script. */
const RUNS = /^(?:|module|text\/javascript|application\/javascript)$/i;
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const typeOf = (attrs: string) => /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "";

/** Whether a script tag's attributes say it runs as a card's script. */
export const runsInCard = (attrs: string): boolean => RUNS.test(typeOf(attrs));

/** The card's inline scripts that run, in order: the nth is served at `<card>.m<n>.js`. */
export function cardModules(source: string): string[] {
	const out: string[] = [];
	for (const match of source.matchAll(SCRIPT)) {
		const attrs = match[1] ?? "";
		if (/\bsrc\s*=/.test(attrs) || !runsInCard(attrs)) continue;
		out.push(match[2] ?? "");
	}
	return out;
}

/** A card script's address taken apart: the card's path and which script, or undefined for any other path. */
export function cardModuleOf(path: string): { card: string; n: number } | undefined {
	// `cards/a.html.m0.js` in a canvas's own folder (Studio), or `canvases/x/cards/a.html.m0.js` in a deck (a harness).
	const match = /^((?:.*\/)?cards\/[^/]+\.html?)\.m(\d+)\.js$/i.exec(path);
	return match ? { card: match[1]!, n: Number(match[2]) } : undefined;
}
