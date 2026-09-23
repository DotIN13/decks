import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a shared canvas held, read back for a chat whose record points at one.
 *
 * For a while boards lived on canvases (`.decks/canvases/<name>.json`) that several agents
 * shared, and a chat's record named its canvas instead of carrying its own boards. Each agent
 * owns its stage again, so a record like that is given the canvas's boards and places once, on
 * restore, and writes them as its own from then on. The files are only ever read here.
 */
export function readCanvasStage(deckPath: string, id: string): { boards: string[]; places: Record<string, { x: number; y: number }> } | undefined {
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
			const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as { id?: unknown; boards?: unknown; places?: unknown };
			if (raw.id !== id) continue;
			const boards = Array.isArray(raw.boards) ? raw.boards.filter((path): path is string => typeof path === "string") : [];
			const places: Record<string, { x: number; y: number }> = {};
			if (raw.places && typeof raw.places === "object") {
				for (const [path, at] of Object.entries(raw.places as Record<string, { x?: unknown; y?: unknown }>)) {
					const x = Number(at?.x);
					const y = Number(at?.y);
					if (Number.isFinite(x) && Number.isFinite(y)) places[path] = { x, y };
				}
			}
			return { boards, places };
		} catch {
			continue;
		}
	}
	return undefined;
}
