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
	// `cards/sales/index.html.m0.js` in a canvas's own folder (Studio), or `canvases/x/cards/sales/index.html.m0.js` in a deck (a harness).
	const match = /^((?:.*\/)?cards\/[^/]+\/index\.html)\.m(\d+)\.js$/i.exec(unstampCard(path));
	return match ? { card: match[1]!, n: Number(match[2]) } : undefined;
}

/**
 * A card's folder at one of its versions: `cards/sales@<rev>/chart.js`. The stage loads a card from its
 * folder stamped with its revision, so a changed `chart.js` is a new address: a page keeps every module
 * it has imported for as long as it lives, and the same address would hand it the old one. Whoever
 * serves cards takes the stamp off before looking for the file.
 */
export function unstampCard(path: string): string {
	return path.replace(/((?:^|\/)cards\/[^/@]+)@[A-Za-z0-9]+(?=\/)/, "$1");
}
