import { THINKING_LEVELS, type ModelOption, type ThinkingLevel } from "@decks/protocol";

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
const MAKERS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", deepseek: "DeepSeek", openrouter: "OpenRouter", xai: "xAI", mistral: "Mistral", groq: "Groq" };

/** A maker's id as people write it: anthropic is Anthropic, openai is OpenAI. */
export function makerName(id: string): string {
	return MAKERS[id.toLowerCase()] ?? (id ? id[0]!.toUpperCase() + id.slice(1) : id);
}

/** The models a search keeps, over `provider/id`, so one field narrows by maker or by name. */
export function matchModels(models: readonly ModelOption[], filter: string): readonly ModelOption[] {
	const needle = filter.toLowerCase().trim();
	if (!needle) return models;
	return models.filter((option) => `${option.provider}/${option.model}`.toLowerCase().includes(needle));
}

/** The makers in a list, in the order their first model appears. */
export const makersOf = (models: readonly ModelOption[]): string[] => [...new Set(models.map((option) => option.provider))];

/** The chip's label: the model's own name, not `provider/name`. */
export function modelLabel(models: readonly ModelOption[], model: { provider: string; model: string } | undefined): string {
	return optionFor(models, model)?.label ?? model?.model ?? "default model";
}

/** Whether an option is the agent's model. */
export const isCurrent = (model: { provider: string; model: string } | undefined, option: ModelOption): boolean => model?.provider === option.provider && model?.model === option.model;
