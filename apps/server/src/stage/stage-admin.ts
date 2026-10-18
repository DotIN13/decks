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
	if (!to) throw new Error("A canvas needs a name with a letter or a number in it.");
	if (to === from) return from;
	if (context.pens.names().includes(to)) throw new Error(`A canvas called "${to}" already exists.`);
	refuseIfBusy(context, from, "rename");
	return moveCanvas(context, from, to);
}

/** Move a canvas to a new folder; its kept boards, the isolated copies of it and its agents follow. */
function moveCanvas(context: Context, from: string, to: string): string {
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

/**
 * Name a canvas. A canvas nobody has named yet is in a placeholder folder (`untitled-canvas`, or an
 * agent's name from before canvases were the deck's), so the first name chosen for it names its
 * folder as well; after that the folder stays and only the name changes. The folder is not moved
 * while an agent on it is mid-turn with boards kept in it, since its tools hold their paths.
 * Returns the folder the canvas is in afterwards.
 */
export function titleCanvas(context: Context, name: string, title: string): string {
	const unchosen = context.pens.naming(name).provisional;
	const clean = context.pens.setTitle(name, title);
	if (!unchosen) return name;
	if (slug(clean, 40) === name || !slug(clean, 40)) return name;
	const keepsBoards = existsSync(join(context.deck.path, stageBoardsDir(name)));
	if (keepsBoards && context.agents.some((agent) => agent.stageName(false) === name && agent.running)) return name;
	return moveCanvas(context, name, context.pens.freshName(clean));
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
