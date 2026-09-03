import type { ModelOption, ThinkingLevel } from "@decks/protocol";

/**
 * The thinking scale, lowest effort first.
 *
 * The order is the whole reason this array exists rather than a `Set`: "nearest" is only
 * a question you can answer about a *scale*, and the protocol's union type has no order
 * of its own. Kept in step with `ThinkingLevel` in `@decks/protocol` — the `satisfies`
 * below is what makes a level added there and forgotten here a type error rather than a
 * chip that quietly never appears.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ThinkingLevel[];

/** Where the app lands when nothing has been chosen, and what an unknown level is read as. */
const DEFAULT: ThinkingLevel = "medium";

/**
 * Keep the user's intent when switching to a model that does not offer the current level:
 * take the nearest one it does, rather than silently resetting.
 *
 * Ported from `picone/apps/web/src/components/ModelPicker.tsx`. The alternative — the one
 * this replaces — is to send no level at all and let the backend fall back to `medium`,
 * which turns "I want this model to think hard" into "I want this model", silently, at the
 * moment you were thinking about the model and not about the level. Somebody who has
 * asked for `max` and moves to a model that stops at `high` means `high`; nobody means
 * `medium` by it.
 *
 * Ties go to whichever level `supported` lists first, which is why `supported` should be
 * in scale order too: between two equally distant neighbours the lower-effort one is the
 * cheaper mistake.
 */
export function nearestLevel(wanted: ThinkingLevel | undefined, supported: readonly ThinkingLevel[]): ThinkingLevel | undefined {
	// A model with no scale has no answer to give, and `undefined` is how the caller says
	// "send no level" rather than "send off" — those are different requests.
	if (supported.length === 0) return undefined;
	if (wanted && supported.includes(wanted)) return wanted;

	const asked = wanted ? THINKING_LEVELS.indexOf(wanted) : -1;
	const from = asked === -1 ? THINKING_LEVELS.indexOf(DEFAULT) : asked;
	const distance = (level: ThinkingLevel) => Math.abs(THINKING_LEVELS.indexOf(level) - from);
	return supported.reduce((best, level) => (distance(level) < distance(best) ? level : best));
}

/**
 * The levels a model offers.
 *
 * Decks' `ModelOption` says `reasoning: boolean` where picone's says which levels a model
 * takes, so today this is all of them or none of them and `nearestLevel` above can only
 * ever answer "the same one" or "nothing". It is still the right shape to build on: the
 * moment the protocol grows a per-model list — an Anthropic model without `xhigh`, say —
 * this is the one function that has to change, and the picker keeps working.
 */
export function levelsFor(option: ModelOption | undefined): readonly ThinkingLevel[] {
	return option?.reasoning ?? false ? THINKING_LEVELS : [];
}

/** The option in `models` that is the model currently running, if it is still on offer. */
export function optionFor(models: readonly ModelOption[], model: { provider: string; model: string } | undefined): ModelOption | undefined {
	if (!model) return undefined;
	return models.find((option) => option.provider === model.provider && option.model === model.model);
}
