/**
 * The one slug rule, shared by the two things that need one.
 *
 * A tag and a workspace are both free text an agent writes into itself, and both have to end up
 * as a word that can be *compared* — `"Panel CSS"` and `panel-css` have to be one tag, and
 * `"Political LLM"` and `political-llm` one workspace, or "who else is on this" has no answer at
 * all. Two copies of the rule would be two answers to that, so it lives here.
 *
 * What stays with the callers is everything that is a *policy* rather than the rule: how long
 * something may be, and whether an empty result is a value or an absence.
 *
 * Slugging keeps Unicode letters and digits (`\p{L}\p{N}`), because an agent working on 水墨花卉
 * should be able to say so; only punctuation and whitespace collapse.
 *
 * Truncation happens **after** slugging and **falls back to the last word boundary**, which is
 * the difference between `reading-panel-css-and` and `reading-panel-css-and-me`. A model told to
 * tag itself writes a sentence, so this is the common case rather than the edge one — and a word
 * cut in half reads as a typo, which is worse than a word that says less.
 *
 * Whatever is longer than the cap with no boundary in it is hard-cut, because there is nothing
 * to fall back to and returning nothing would lose it entirely.
 */
export function slug(raw: string, max: number): string {
	const slugged = raw
		.normalize("NFC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	if (slugged.length <= max) return slugged;
	const cut = slugged.slice(0, max);
	const boundary = cut.lastIndexOf("-");
	return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/g, "");
}
