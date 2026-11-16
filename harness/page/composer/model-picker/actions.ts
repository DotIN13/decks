import type { ModelOption, ThinkingLevel } from "@decks/protocol";
import { levelsFor, nearestLevel } from "./model.ts";

// What picking a model does: it keeps the nearest thinking level the new model takes.

/** A model was picked: the thinking level comes across only as far as the new model allows. */
export function pickModel(option: ModelOption, current: ThinkingLevel | undefined, onModel: (provider: string, model: string, thinking?: ThinkingLevel) => void, done: () => void): void {
	onModel(option.provider, option.model, nearestLevel(current, levelsFor(option)));
	done();
}
