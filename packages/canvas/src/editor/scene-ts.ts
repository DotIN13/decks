/**
 * The seam answered from the TypeScript side of the engine. The only file in the editor that
 * knows `stage/engine.ts` exists.
 */
import type { PenDocument } from "@decks/pen";
import { docIndex } from "../pen/doc-index.ts";
import type { StageEngine } from "../stage/engine.ts";
import type { BoardBox } from "./core/model.ts";
import type { EngineSeam, SceneQuery } from "./core/scene.ts";

export function tsScene(engine: Pick<StageEngine, "placed" | "bounds" | "pickAll" | "onLine">, doc: () => PenDocument | undefined, boards: () => readonly BoardBox[]): SceneQuery {
	const found = (id: string) => {
		const current = doc();
		return current ? docIndex(current).get(id) : undefined;
	};
	return {
		items: () => engine.placed.values(),
		item: (id) => engine.placed.get(id),
		box: (id) => engine.bounds.get(id) ?? engine.placed.get(id)?.box,
		drawn: (id) => engine.bounds.get(id),
		node: (id) => found(id)?.node,
		parent: (id) => found(id)?.parent,
		boards,
		under: (point) => engine.pickAll(point),
		onLine: (id, point) => engine.onLine(id, point),
	};
}

/** What the editor tells the engine (`core/scene.ts`, `EngineSeam`), said to the TypeScript side of it. */
export function tsSeam(engine: Pick<StageEngine, "preview" | "settle" | "carry" | "mark" | "shows" | "linkAt" | "muteText" | "setDoc">): EngineSeam {
	return {
		preview: (changes) => engine.preview(changes),
		settle: (landing) => engine.settle(landing),
		carry: (paths, offset) => engine.carry(paths, offset),
		mark: () => engine.mark(),
		shows: (mark) => engine.shows(mark),
		linkAt: (point) => engine.linkAt(point),
		muteText: (ids) => engine.muteText(ids),
		showDoc: (doc, base) => engine.setDoc(doc, base),
	};
}
