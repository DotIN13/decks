/**
 * The seam answered from the TypeScript side of the engine. The only file in the editor that
 * knows `stage/engine.ts` exists.
 */
import { indexOf, type PenDocument } from "@decks/pen";
import type { StageEngine } from "../../stage/engine.ts";
import type { BoardBox } from "./core/model.ts";
import type { SceneQuery } from "./core/scene.ts";

export function tsScene(engine: Pick<StageEngine, "placed" | "bounds" | "pickAll" | "onLine">, doc: () => PenDocument | undefined, boards: () => readonly BoardBox[]): SceneQuery {
	const found = (id: string) => {
		const current = doc();
		return current ? indexOf(current).get(id) : undefined;
	};
	return {
		items: () => engine.placed.values(),
		item: (id) => engine.placed.get(id),
		box: (id) => engine.bounds.get(id) ?? engine.placed.get(id)?.box,
		node: (id) => found(id)?.node,
		parent: (id) => found(id)?.parent,
		boards,
		under: (point) => engine.pickAll(point),
		onLine: (id, point) => engine.onLine(id, point),
	};
}
