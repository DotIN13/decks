import { nearestLevel, THINKING_LEVELS, type ThinkingLevel } from "@decks/protocol";

/**
 * opencode's thinking levels, on Decks' scale.
 *
 * opencode does not have one scale; it has **variants** (`/docs/models.mdx`, "Variants"),
 * and the catalogue publishes each model's own list of them — `muse-spark` offers
 * `minimal`…`xhigh`, Google's models `low`/`high`, Anthropic's `high`/`max`. Decks' level
 * is one of seven words on a scale, so the two connect where the words coincide: a
 * variant whose id is a Decks level is *on* the scale; a custom variant like `fast` or
 * `thinking` has no position on it, so it cannot answer a request for "how hard to think".
 *
 * This is the shape the two sides were already the same: `@decks/protocol` owns the scale
 * and the nearest rule, and these two functions are only about deciding which of a
 * model's variant ids are on it at all.
 */

/** The variant ids that are Decks levels, in scale order regardless of declaration order. */
export function rankedVariants(variants: readonly string[] | undefined): readonly ThinkingLevel[] {
	return THINKING_LEVELS.filter((level) => variants?.includes(level));
}

/**
 * The variant to ask a model for, given the level wanted.
 *
 * `undefined` when the model's variants have nothing on Decks' scale — a model whose
 * variants are all custom ids, or none at all — and `undefined` is also what an
 * undefined level means: "no level was asked", which lets opencode resolve its own
 * default. The two are deliberately the same answer — a caller that wants the variant
 * drill-down (`@decks/protocol`'s `nearestLevel`, which answers "nearest to the default"
 * when nothing is wanted, is the display-side reading; this is the send side, where
 * sending nothing is a real request. A level that is off the model's range lands on the
 * nearest it offers, by the same nearest rule the model picker uses to keep a
 * switch-of-model from silently resetting a chosen level.
 */
export function variantFor(wanted: ThinkingLevel | undefined, variants: readonly string[] | undefined): ThinkingLevel | undefined {
	const ranked = rankedVariants(variants);
	if (wanted === undefined || ranked.length === 0) return undefined;
	return nearestLevel(wanted, ranked);
}