import { migrateStages } from "./2026-10-16-stages-to-canvases.ts";

/**
 * Every change to how a deck is kept on disk, oldest first, and when each one runs.
 *
 * A migration lives here, one file per change, named by the day it shipped; the code that reads the
 * new shape lives where it always did and calls in. Two kinds:
 *
 * - **at open**: run by `runAtOpen` before the deck, its canvases or its agents are read, and only when
 *   the old shape is on disk, so running one again does nothing.
 * - **on read**: called from the reader of one record, as that record is read, and written back in the
 *   new shape so it is not read the old way again.
 *
 * | file                                       | runs    | called from                     |
 * | ------------------------------------------ | ------- | ------------------------------- |
 * | 2026-09-16-deck-json-places.ts             | on read | `deck/schema.ts`                |
 * | 2026-09-22-shared-canvases-to-agents.ts    | on read | `agents/registry.ts`            |
 * | 2026-10-16-board-lists-into-canvas-files.ts| on read | `agents/session.ts` (adoptStage) |
 * | 2026-10-16-stages-to-canvases.ts           | at open | `runAtOpen`, below              |
 */

/** The at-open migrations, in order. Returns a line for the log per migration that changed anything. */
export function runAtOpen(deck: string): string[] {
	const said: string[] = [];
	const moved = migrateStages(deck);
	if (moved.size) said.push(`moved ${moved.size} canvases from stages/ to canvases/`);
	return said;
}
