/**
 * Finding things on a shared page: the one element a target names, by a reference from the last
 * read or by a name down a ladder of ways to ask for it, and a cheap fingerprint of the page to
 * tell whether an action did anything. Kept apart from the bridge (`bridge.ts`), which holds the
 * connection, the person's answers and the verbs; these need only the page and the last read.
 */
import type { WebTarget } from "../canvas/service.ts";

type Page = import("playwright").Page;
type Locator = import("playwright").Locator;

/** The page the last read was of, whose `[ref=…]` ids are good until it moves. */
export type Refs = { url: string } | undefined;

/** What the page looks like, cheaply: its address and a fingerprint of its markup, to tell whether an action did anything. */
export async function markOf(page: Page): Promise<{ url: string; print: string }> {
	const seen = await page
		.evaluate(() => ({ href: location.href, print: `${document.documentElement.outerHTML.length}:${document.title}:${document.querySelectorAll("*").length}:${document.body?.innerText.length ?? 0}` }))
		.catch(() => ({ href: page.url(), print: "" }));
	// The page's own address, not Playwright's: a move within the page reaches it late or not at all through the relay.
	return { url: seen.href, print: seen.print };
}

/**
 * The one element a target names — or a sentence saying why not.
 *
 * A reference is exact. A name is not: it goes down the ladder of ways to ask for that
 * name, and **stops at the first rung that matches anything**. If that rung matches more
 * than one thing, it says so and names both ways out, rather than taking the first and
 * writing into whichever row happened to be earliest in the document.
 */
export async function locate(page: Page, refs: Refs, target: WebTarget, candidates: (name: string) => Locator[]): Promise<Locator> {
	if (typeof target === "object" && "ref" in target) return byRef(page, refs, target.ref);
	const name = typeof target === "string" ? target : target.name;
	const nth = typeof target === "object" && "nth" in target ? target.nth : undefined;
	if (!name?.trim()) throw new Error("A target needs a name, or a { ref } from decks web read.");
	for (const found of candidates(name)) {
		let candidate = found;
		let count = await candidate.count();
		if (count === 0) continue;
		// A label used twice is usually one copy on screen and one hidden (a stale dialog, a
		// template), or one in the open dialog and one on the page behind it. Narrow to what is
		// visible, then to the open dialog, before counting: what a person would mean.
		if (count > 1) {
			const visible = candidate.filter({ visible: true });
			const shown = await visible.count();
			if (shown > 0 && shown < count) [candidate, count] = [visible, shown];
		}
		if (count > 1) {
			const dialog = page.locator('[role="dialog"]:visible, dialog[open]').last();
			if ((await dialog.count()) > 0) {
				const inside = candidate.and(dialog.locator("*"));
				const there = await inside.count();
				if (there > 0 && there < count) [candidate, count] = [inside, there];
			}
		}
		if (nth !== undefined) {
			if (!Number.isInteger(nth) || nth < 1 || nth > count)
				throw new Error(`"${name}" matches ${count} ${count === 1 ? "element" : "elements"} on this page, so nth: ${nth} is out of range — nth: 1 is the first.`);
			return candidate.nth(nth - 1);
		}
		if (count > 1)
			throw new Error(
				`"${name}" matches ${count} elements on this page, so I did not guess. Take one by position with { name: "${name}", nth: 1 } — 1 is the first — or read the page (decks.web.read) and pass one of its references, like { ref: "e42" }.`,
			);
		return candidate.first();
	}
	throw new Error(`Nothing on the page is called "${name}". Read the page (decks.web.read) to see the names it uses.`);
}

/** The element a `[ref=…]` from the last read names, or a sentence about why it cannot. */
async function byRef(page: Page, refs: Refs, ref: string): Promise<Locator> {
	const id = String(ref ?? "").trim().replace(/^@/, "");
	if (!/^(f\d+)?e\d+$/.test(id)) throw new Error(`"${ref}" is not a reference. A reference looks like e42, or f3e42 inside a frame, and comes from decks web read.`);
	if (!refs) throw new Error("References come from the page itself: read it with decks web read first, then pass one of the [ref=…] ids it shows.");
	if (refs.url !== page.url())
		throw new Error(
			`That reference was read from ${refs.url} and the tab is now on ${page.url()}. Read the page again — every page numbers its references from e1, so an old one can point at the wrong element.`,
		);
	const target = page.locator(`aria-ref=${id}`);
	if ((await target.count()) === 0) throw new Error(`Nothing on this page has the reference ${id}. Read it again — the page may have redrawn.`);
	return target;
}
