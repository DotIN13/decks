import { THINKING_LEVELS, type ModelOption, type ThinkingLevel } from "@decks-next/protocol";

// The thinking scale is the protocol's; the nearest-level rule and the default are behaviour.
export { THINKING_LEVELS };
export type { ThinkingLevel };

/** The level a new conversation thinks at, and where "nearest" counts from when none is asked. */
export const DEFAULT_THINKING: ThinkingLevel = "medium";

/** The supported level closest to the one wanted; undefined when the model has no scale. */
export function nearestLevel(wanted: ThinkingLevel | undefined, supported: readonly ThinkingLevel[]): ThinkingLevel | undefined {
	if (supported.length === 0) return undefined;
	if (wanted && supported.includes(wanted)) return wanted;
	const asked = wanted ? THINKING_LEVELS.indexOf(wanted) : -1;
	const from = asked === -1 ? THINKING_LEVELS.indexOf(DEFAULT_THINKING) : asked;
	const distance = (level: ThinkingLevel) => Math.abs(THINKING_LEVELS.indexOf(level) - from);
	return supported.reduce((best, level) => (distance(level) < distance(best) ? level : best));
}

/** The levels a model offers. */
export function levelsFor(option: ModelOption | undefined): readonly ThinkingLevel[] {
	return option?.reasoning ?? false ? THINKING_LEVELS : [];
}

/** The option in `models` that is the model currently running, if it is still on offer. */
export function optionFor(models: readonly ModelOption[], model: { provider: string; model: string } | undefined): ModelOption | undefined {
	if (!model) return undefined;
	return models.find((option) => option.provider === model.provider && option.model === model.model);
}