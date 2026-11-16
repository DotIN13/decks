/**
 * The links a page's text holds, and putting changed ones in: what copying a page to another folder
 * needs (`copy-in.ts`, `copy-shared.ts`), and what the move to standalone canvases needed
 * (`migrations/2026-10-20-standalone-canvases.ts`).
 */

/** A link a page's text may hold: in quotes, in `url(…)` or a markdown link, with a file extension. */
export const LINK = /(["'(])((?:\.{1,2}\/)*[A-Za-z0-9_ -\uFFFF][^"'()\s<>?#|*:]*\.[A-Za-z0-9]{1,8})(?=[?#"')])/g;

/** A page's text with each changed link put in, in quotes, `url(…)` and markdown links alike. */
export function rewriteLinks(text: string, links: ReadonlyArray<{ from: string; to: string }>): string {
	const map = new Map(links.map((one) => [one.from, one.to]));
	return text.replace(LINK, (all, lead: string, link: string) => (map.has(link) ? `${lead}${map.get(link)}` : all));
}
