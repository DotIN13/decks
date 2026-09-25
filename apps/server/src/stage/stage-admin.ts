import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slug } from "../agents/slug.ts";
import type { DeckAgent } from "../agents/session.ts";
import type { Deck } from "../deck/loader.ts";
import { stageBoardsDir } from "../deck/stage-boards.ts";
import type { StagePens } from "./pens.ts";

/**
 * Renaming and deleting stages, from the stage manager.
 *
 * A stage's name is its folder, and the boards a stage keeps in its own folder carry that name in
 * their paths (`deck/stage-boards.ts`). So both change more than a label: the deck's list of boards,
 * the stage file's board items, and every agent on the stage follow. Neither is allowed while an
 * agent on that stage is in the middle of a turn, because its tools would be holding paths that
 * are about to stop existing.
 */

interface Context {
	deck: Deck;
	pens: StagePens;
	agents: readonly DeckAgent[];
}

function refuseIfBusy(context: Context, name: string, verb: string): void {
	const busy = context.agents.find((agent) => agent.stageName(false) === name && agent.running);
	if (busy) throw new Error(`${busy.name} is working on "${name}" right now; ${verb} it when that turn ends.`);
}

/**
 * Rename a stage. The new name is made folder-safe the way a new stage's is (lowercase, dashes),
 * refused when empty or taken. Returns the name it got.
 */
export function renameStage(context: Context, from: string, title: string): string {
	const to = slug(title, 40);
	if (!to) throw new Error("A stage needs a name with a letter or a number in it.");
	if (to === from) return from;
	if (context.pens.names().includes(to)) throw new Error(`A stage called "${to}" already exists.`);
	refuseIfBusy(context, from, "rename");
	const before = `${stageBoardsDir(from)}/`;
	const after = `${stageBoardsDir(to)}/`;
	const repoint = (path: string) => (path.startsWith(before) ? after + path.slice(before.length) : path);
	context.pens.rename(from, to, repoint);
	context.deck.reload();
	// An isolated stage names the stage it was copied from; that name moved.
	for (const name of context.pens.names()) {
		const mark = join(context.pens.dir, name, "isolated.json");
		if (!existsSync(mark)) continue;
		try {
			const parsed = JSON.parse(readFileSync(mark, "utf8")) as { from?: string };
			if (parsed.from === from) writeFileSync(mark, `${JSON.stringify({ ...parsed, from: to })}\n`);
		} catch {
			// An unreadable mark stays as it was.
		}
	}
	for (const agent of context.agents) agent.stageRenamed(from, to, repoint);
	return to;
}

/** Delete a stage, with its drawing and any boards kept in its own folder. The deck's own boards are untouched. */
export function deleteStage(context: Context, name: string): { boards: number } {
	refuseIfBusy(context, name, "delete");
	const folder = join(context.deck.path, stageBoardsDir(name));
	const boards = existsSync(folder) ? readdirSync(folder).length : 0;
	context.pens.remove(name);
	context.deck.reload();
	for (const agent of context.agents) agent.stageDeleted(name);
	return { boards };
}
