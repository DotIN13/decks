import { nearestLevel, THINKING_LEVELS, type ModelOption, type ThinkingLevel } from "@decks/protocol";

/**
 * The thinking scale and the "nearest" rule, shared with the server.
 *
 * Both live in `@decks/protocol` and are re-exported here: the picker chooses a level,
 * and a runtime maps a chosen level onto the levels its model actually offers, so the two
 * sides must be answering on the same ordered scale. This file keeps the two helpers that
 * are questions about a *model option* rather than about the scale itself.
 */
export { nearestLevel, THINKING_LEVELS };
export type { ThinkingLevel };

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