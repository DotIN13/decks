// The migrations a deck may still need, oldest first. Today's seven (to 0.5.1) moved stages,
// boards and leftovers once; every deck in use has run them, so they stay with today's server,
// and an older shape is named and refused (OLD_SHAPES). New ones are added after FLOOR, in MIGRATIONS.
import { toDeckPath, type Deck, type DeckPath, type UpgradeParts } from "../kernel/index.ts";
import { agentsToPeople } from "./agents.ts";
import type { Semver } from "./version.ts";

/** The version every migration of today's server leaves a deck at. */
export const FLOOR: Semver = "0.5.1";

/** One migration: the deck's files, a line to say what it did, and the stores and today's .decks leftovers (parts). */
export type Migration = { version: Semver; id: string; run(deck: Deck, say: (line: string) => void, parts: UpgradeParts): Promise<void> };

/** Migrations after FLOOR, oldest first. Each is idempotent: run twice, the second changes nothing. */
export const MIGRATIONS: readonly Migration[] = [{ version: "0.6.0", id: "2026-11-15-agents-to-people", run: agentsToPeople }];

export const LATEST: Semver = MIGRATIONS.at(-1)?.version ?? FLOOR;

/** What of a shape before FLOOR this deck still holds, as sentences; none means it is at FLOOR. */
export async function oldShapes(deck: Deck): Promise<string[]> {
	const found: string[] = [];
	if ((await names(deck, "stages")).length) found.push("canvases still in stages/ (0.1.0)");
	if ((await names(deck, "boards")).some((p) => p.endsWith(".html"))) found.push("boards at the deck's root, not in their canvases (0.2.0)");
	for (const dir of await names(deck, "canvases")) {
		const pen = `${dir}/canvas.pen`;
		if (!(await exists(deck, pen))) continue;
		const text = new TextDecoder().decode(await deck.read(toDeckPath(pen)));
		if (/"type"\s*:\s*"decks\.board"/.test(text)) found.push(`${pen} still places boards (0.5.0)`);
	}
	return found;
}

/** Whether the folder holds a deck yet: a new one starts at LATEST with nothing to run. */
export async function holdsADeck(deck: Deck): Promise<boolean> {
	for (const name of ["deck.json", "boards", "stages", "canvases"]) if ((await names(deck, name)).length || (await exists(deck, name))) return true;
	return false;
}

const exists = async (deck: Deck, path: string) => {
	try {
		await deck.read(toDeckPath(path));
		return true;
	} catch {
		return false;
	}
};

const names = async (deck: Deck, dir: string): Promise<DeckPath[]> => (await deck.list(toDeckPath(dir)).catch(() => [])).map((e) => e.path);
