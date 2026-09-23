import { slug } from "./slug.ts";

/**
 * What a tag is allowed to be.
 *
 * The whole of what the feature *knows*, in one pure function, for the reason
 * `panel/panel-groups.ts` is pure: a free-text field an agent writes into itself will fill
 * with sentences unless the shape refuses them, and "does it refuse them" is a question that
 * should be answerable without starting a runtime and reading a menu.
 *
 * Two callers, and they are deliberately the same code. `stage.me.setTags` is the agent
 * tagging itself; `agent.tags` is you tagging it from the customise popup. Both go through
 * here, so a tag you type and a tag an agent sets are the same kind of object — which is what
 * makes them comparable at a glance in the panel, and what stops one surface accepting
 * `"Panel CSS"` while the other stores `panel-css`.
 */

/** Four. What the panel row wraps to two lines of chips at 264px, and what the 220px hover
 *  card shows without growing — the two surfaces that draw them agree on the cap. */
export const MAX_TAGS = 4;

/** Long enough for `flaky-editing-check`, short enough that two fit on a line. */
export const MAX_TAG_LENGTH = 24;

/**
 * Slug one tag.
 *
 * The rule itself lives in `slug.ts`, because a workspace slugs the same way — what is a tag's
 * own is the cap, and that a tag is allowed to be nothing at all (it is dropped, not refused).
 */
export const slugTag = (raw: string): string => slug(raw, MAX_TAG_LENGTH);

/**
 * The list, cleaned: slugged, empties dropped, deduped keeping first position, capped at four.
 *
 * **Extras are dropped rather than refused.** An agent that sends six tags has still told you
 * something true, and failing the call would leave it with none — worse than four. The same
 * argument covers a tag that slugs to nothing: it disappears quietly instead of taking the
 * other three with it.
 *
 * Order is the agent's own, first occurrence winning, so the row is stable between renders
 * and the tag it considers most important is the one that survives a cap.
 */
export function cleanTags(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const one = slugTag(item);
		if (!one || out.includes(one)) continue;
		out.push(one);
		if (out.length === MAX_TAGS) break;
	}
	return out;
}

/**
 * Whether two cleaned lists are the same, so nothing is broadcast for a no-op.
 *
 * An agent that sets the same tags at the top of every turn would otherwise put an
 * `agent.identity` on the wire per turn, and every browser would re-render its panel for a
 * fact that did not change.
 */
export function sameTags(a: string[] | undefined, b: string[] | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	if (left.length !== right.length) return false;
	return left.every((tag, index) => tag === right[index]);
}
