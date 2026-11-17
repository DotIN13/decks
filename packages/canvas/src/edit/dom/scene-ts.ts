/**
 * The seam answered from the TypeScript side of the engine. The only file in the editor that
 * knows `stage/engine.ts` exists.
 */
import type { PenDocument } from "@decks/pen";
import { docIndex } from "../../model/doc-index.ts";
import type { CanvasEngine } from "../../render/engine.ts";
import type { PageBox } from "../core/model.ts";
import type { EngineSeam, SceneQuery } from "../core/scene.ts";

export function tsScene(engine: CanvasEngine, doc: () => PenDocument | undefined, boards: () => readonly PageBox[]): SceneQuery {
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
		pageItem: (path) => engine.questions.pageIdOf(path),
		under: (point) => engine.questions.pickAll(point),
		onLine: (id, point) => engine.questions.onLine(id, point),
	};
}

/** What the editor tells the engine (`core/scene.ts`, `EngineSeam`), said to the TypeScript side of it. */
export function tsSeam(engine: CanvasEngine): EngineSeam {
	return {
		preview: (changes) => engine.previews.preview(changes),
		settle: (landing) => engine.glides.settle(landing),
		carry: (paths, offset) => engine.cardLayer.carry(paths, offset),
		mark: () => engine.tiles.mark(),
		shows: (mark) => engine.tiles.shows(mark),
		linkAt: (point) => engine.questions.linkAt(point),
		muteText: (ids) => engine.previews.muteText(ids),
		showDoc: (doc, base) => engine.setDoc(doc, base),
	};
}
