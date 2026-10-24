import type { Board, StageRow } from "@decks/protocol";

/**
 * The Canvases tab's tree: every canvas, one level, each opening onto the boards in its folder.
 *
 * No grouping above the canvas: the canvas you are on comes first, then the rest by when they
 * last changed, so the one you were just in is near the top.
 *
 * Boards are found by path, not asked for: a canvas's boards live in its own folder
 * (`canvases/<name>/boards/…`, `shared/canvases/<owner>/<name>/…`). Boards in the old library
 * (`boards/…`) are on no canvas and get a last folder of their own.
 */

export type TreeCanvas = {
	stage: StageRow;
	/** The boards in its folder that the query lets through, by title. */
	boards: Board[];
	/** The canvas the panel is showing: marked "Here", open unless folded. */
	here: boolean;
	/** The query matched the canvas itself, or nothing was asked. */
	hit: boolean;
};

export const LIBRARY = "Not on a canvas";

/** The folder a canvas's own files are in, with a trailing slash. */
export function folderOf(stage: Pick<StageRow, "name">): string {
	return stage.name.startsWith("shared/") ? `shared/canvases/${stage.name.slice("shared/".length)}/` : `canvases/${stage.name}/`;
}

export function canvasTree(input: { stages: StageRow[]; boards: Board[]; here?: string; query: string }): { canvases: TreeCanvas[]; library: Board[] } {
	const q = input.query.trim().toLowerCase();
	const has = (text: string | undefined) => !q || (text ?? "").toLowerCase().includes(q);
	const byTitle = (a: Board, b: Board) => a.title.localeCompare(b.title);

	const canvases: TreeCanvas[] = [];
	const claimed = new Set<string>();
	for (const stage of input.stages) {
		const prefix = folderOf(stage);
		const own = input.boards.filter((board) => board.path.startsWith(prefix));
		for (const board of own) claimed.add(board.path);
		const canvasHit = has(stage.title) || has(stage.name) || stage.agents.some((agent) => has(agent.name));
		const boards = (canvasHit ? own : own.filter((board) => has(board.title) || has(board.path))).sort(byTitle);
		if (!canvasHit && boards.length === 0) continue;
		canvases.push({ stage, boards, here: stage.name === input.here, hit: canvasHit });
	}
	canvases.sort((a, b) => Number(b.here) - Number(a.here) || (b.stage.changedAt ?? 0) - (a.stage.changedAt ?? 0) || a.stage.title.localeCompare(b.stage.title));

	const library = input.boards.filter((board) => !claimed.has(board.path) && !board.path.startsWith("canvases/") && !board.path.startsWith("shared/") && (has(board.title) || has(board.path))).sort(byTitle);
	return { canvases, library };
}
