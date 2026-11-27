import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRecord } from "./store.ts";

/**
 * Two shapes an agent's record was kept in before deck version 0.1.0, read as each chat is restored,
 * and only in a deck old enough to hold them (`deck/old-shapes.ts`).
 *
 * **2026-09-22: shared canvases (`.decks/canvases/<name>.json`) are gone, and each chat keeps its own**
 * (`fromSharedCanvas`, from `agents/registry.ts`), once per record: the record is written back
 * without `fromCanvas`, so it never comes here again.
 *
 * For a while cards lived on canvases (`.decks/canvases/<name>.json`) that several agents
 * shared, and a chat's record named its canvas instead of carrying its own cards. Each agent
 * owns its canvas again, so a record like that is given the canvas's cards and places once, on
 * restore, and writes them as its own from then on. The files are only ever read here.
 */
function readSharedCanvas(deckPath: string, id: string): { cards: string[]; places: Record<string, { x: number; y: number }> } | undefined {
	const dir = join(deckPath, ".decks", "canvases");
	if (!existsSync(dir)) return undefined;
	let names: string[];
	try {
		names = readdirSync(dir).filter((name) => name.endsWith(".json"));
	} catch {
		return undefined;
	}
	for (const name of names) {
		try {
			const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as { id?: unknown; cards?: unknown; places?: unknown };
			if (raw.id !== id) continue;
			const cards = Array.isArray(raw.cards) ? raw.cards.filter((path): path is string => typeof path === "string") : [];
			const places: Record<string, { x: number; y: number }> = {};
			if (raw.places && typeof raw.places === "object") {
				for (const [path, at] of Object.entries(raw.places as Record<string, { x?: unknown; y?: unknown }>)) {
					const x = Number(at?.x);
					const y = Number(at?.y);
					if (Number.isFinite(x) && Number.isFinite(y)) places[path] = { x, y };
				}
			}
			return { cards, places };
		} catch {
			continue;
		}
	}
	return undefined;
}

/**
 * A restored record that still names a shared canvas, given that canvas's cards and places as its
 * own and written straight back, so the canvas file is never needed again. Every chat that was on
 * one canvas gets its own copy of it. `exists` says which cards the deck still has.
 */
export function fromSharedCanvas(record: AgentRecord, deckPath: string, exists: (path: string) => boolean, write: (record: AgentRecord) => void): AgentRecord {
	if (!record.fromCanvas) return record;
	const { fromCanvas, ...rest } = record;
	const canvas = rest.inPlay.length === 0 && !rest.positions ? readSharedCanvas(deckPath, fromCanvas) : undefined;
	if (!canvas) {
		write(rest);
		return rest;
	}
	const cards = canvas.cards.filter(exists);
	const context = [...cards, ...rest.context.filter((path) => !cards.includes(path))];
	const places = Object.fromEntries(Object.entries(canvas.places).filter(([path]) => context.includes(path)));
	const next: AgentRecord = { ...rest, context, inPlay: cards, ...(Object.keys(places).length > 0 ? { positions: places } : {}) };
	write(next);
	return next;
}

/**
 * 2026-10-16: which cards are on a canvas is the canvas file's alone (`canvas/canvas-ops.ts`).
 *
 * Before, each agent's record kept its own list (`inPlay` in `.decks/agents/<id>/meta.json`). A
 * restored record still carrying one has it written into its canvas file, once, and only when that
 * file holds no cards yet: a canvas file with cards in it is the truth, and another agent's list
 * must not be laid over it. The record stops saving the list on its next write (`agents/session.ts`).
 *
 * As each agent is restored (`DeckAgent.adoptCanvas`). Returns the cards to put on the canvas, or nothing.
 */
export function recordedCardsToAdopt(onCanvas: number, recorded: readonly string[] | undefined): string[] {
	if (onCanvas > 0 || !recorded?.length) return [];
	return [...recorded];
}
