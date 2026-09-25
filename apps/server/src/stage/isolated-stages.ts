import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Deck } from "../deck/loader.ts";
import { relink, stageBoardsDir } from "../deck/stage-boards.ts";
import type { BoardSpot, StagePens } from "./pens.ts";

/**
 * Isolated stages: the stages an isolated agent works on (`agents/isolation.ts`).
 *
 * Turning isolation on makes an isolated copy of the agent's stage and moves it there, so the
 * stage it came from is never touched. While isolated it can move only between isolated stages,
 * and a stage it makes is isolated too. Turning isolation off copies each isolated stage it used
 * back as an ordinary stage, `<name>-1` (or `-2`, …), and moves it onto the copy of the one it was
 * on. A stage is isolated when its folder holds `isolated.json`, which also names the stage it was
 * copied from.
 */

const MARK = "isolated.json";
/** Beside a stage copied back from an isolated one: which stage it came back from. */
const BACK = "from-isolation.json";

/** True when this stage was copied back from an isolated one, when isolation ended. */
export function fromIsolation(pens: StagePens, name: string): boolean {
	return existsSync(join(pens.dir, name, BACK));
}

/** True when this stage is an isolated one. */
export function isIsolatedStage(pens: StagePens, name: string): boolean {
	return existsSync(join(pens.dir, name, MARK));
}

/** The stage an isolated stage was copied from, when it was copied from one. */
export function originOf(pens: StagePens, name: string): string | undefined {
	try {
		const mark = JSON.parse(readFileSync(join(pens.dir, name, MARK), "utf8")) as { from?: unknown };
		return typeof mark.from === "string" && mark.from ? mark.from : undefined;
	} catch {
		return undefined;
	}
}

/** Make a stage an isolated one, saying where it came from. */
export function markIsolated(pens: StagePens, name: string, from?: string): void {
	mkdirSync(join(pens.dir, name), { recursive: true });
	writeFileSync(join(pens.dir, name, MARK), `${JSON.stringify(from ? { from } : {})}\n`);
}

/** The first free `<base>-1`, `<base>-2`, …: the name a copied-back stage takes. */
export function numberedName(pens: StagePens, base: string): string {
	const taken = new Set(pens.names());
	for (let n = 1; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Copy a stage to a new one: its drawing, and each of its boards into the new stage's own board
 * folder (relative links re-pointed), with the new stage's board items at the same places. The
 * original stage and its boards are only read. Returns the new stage's board paths.
 */
export function copyStage(deck: Deck, pens: StagePens, from: string, to: string, options: { isolated: boolean; origin?: string; back?: boolean }): string[] {
	if (pens.names().includes(to)) throw new Error(`A stage called ${to} already exists.`);
	const folder = stageBoardsDir(to);
	mkdirSync(join(deck.path, folder), { recursive: true });
	if (existsSync(pens.fileOf(from))) writeFileSync(pens.fileOf(to), readFileSync(pens.fileOf(from)));
	const spots: BoardSpot[] = [];
	for (const board of pens.boards(from)) {
		const source = join(deck.path, board.path);
		if (!existsSync(source)) continue;
		const file = basename(board.path);
		const dot = file.lastIndexOf(".");
		const [stem, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ""];
		let path = `${folder}/${file}`;
		for (let n = 2; existsSync(join(deck.path, path)); n++) path = `${folder}/${stem}-${n}${ext}`;
		writeFileSync(join(deck.path, path), relink(readFileSync(source, "utf8"), dirname(board.path), folder));
		const described = deck.refresh(path);
		spots.push({ path, x: board.x, y: board.y, w: board.w, h: board.h, title: described?.title ?? stem });
	}
	// The copied drawing still names the old boards; this swaps them for the copies, in place.
	if (spots.length > 0 || existsSync(pens.fileOf(to))) pens.syncBoards(to, spots);
	if (options.isolated) markIsolated(pens, to, options.origin);
	else rmSync(join(pens.dir, to, MARK), { force: true });
	// Copied back when isolation ended: said, so the manager can badge it (and a copy of a copy is not).
	if (options.back) writeFileSync(join(pens.dir, to, BACK), `${JSON.stringify({ from })}\n`);
	else rmSync(join(pens.dir, to, BACK), { force: true });
	return spots.map((spot) => spot.path);
}
