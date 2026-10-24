import type { Board, Identity, StageRow } from "@decks/protocol";

/**
 * The Canvases tab's tree: workspace, then canvas, then the boards in that canvas's folder.
 *
 * A canvas has no workspace of its own. It is filed under the workspace its agents declare, the
 * one most of them share, so the tree reads the way the Agents tab does; a canvas nobody is on goes
 * under "Other canvases", and a friend's under "Shared with you". The workspace holding the canvas
 * you are on comes first, so where you are is the top of the list.
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

export type TreeFolder = { id: string; label: string; canvases: TreeCanvas[] };

export const OTHER = "Other canvases";
export const SHARED = "Shared with you";
export const LIBRARY = "Not on a canvas";

/** The folder a canvas's own files are in, with a trailing slash. */
export function folderOf(stage: Pick<StageRow, "name">): string {
	return stage.name.startsWith("shared/") ? `shared/canvases/${stage.name.slice("shared/".length)}/` : `canvases/${stage.name}/`;
}

/** The workspace most of a canvas's agents declare, or where else it is filed. */
export function workspaceOf(stage: StageRow, identities: Record<string, Identity>): string {
	if (stage.shared) return SHARED;
	const count = new Map<string, number>();
	for (const agent of stage.agents) {
		const workspace = identities[agent.id]?.workspace?.trim();
		if (workspace) count.set(workspace, (count.get(workspace) ?? 0) + 1);
	}
	let best: string | undefined;
	for (const [name, n] of count) if (!best || n > (count.get(best) ?? 0) || (n === count.get(best) && name < best)) best = name;
	return best ?? OTHER;
}

export function canvasTree(input: { stages: StageRow[]; boards: Board[]; identities: Record<string, Identity>; here?: string; query: string }): { folders: TreeFolder[]; library: Board[] } {
	const q = input.query.trim().toLowerCase();
	const has = (text: string | undefined) => !q || (text ?? "").toLowerCase().includes(q);
	const byTitle = (a: Board, b: Board) => a.title.localeCompare(b.title);

	const folders = new Map<string, TreeFolder>();
	const claimed = new Set<string>();
	for (const stage of input.stages) {
		const prefix = folderOf(stage);
		const own = input.boards.filter((board) => board.path.startsWith(prefix));
		for (const board of own) claimed.add(board.path);
		const workspace = workspaceOf(stage, input.identities);
		const canvasHit = has(stage.title) || has(stage.name) || has(workspace) || stage.agents.some((agent) => has(agent.name));
		const boards = (canvasHit ? own : own.filter((board) => has(board.title) || has(board.path))).sort(byTitle);
		if (!canvasHit && boards.length === 0) continue;
		const folder = folders.get(workspace) ?? { id: `canvases:${workspace}`, label: workspace, canvases: [] };
		folder.canvases.push({ stage, boards, here: stage.name === input.here, hit: canvasHit });
		folders.set(workspace, folder);
	}

	const rank = (folder: TreeFolder) => (folder.canvases.some((one) => one.here) ? 0 : folder.label === OTHER ? 2 : folder.label === SHARED ? 3 : 1);
	const list = [...folders.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
	for (const folder of list)
		folder.canvases.sort((a, b) => Number(b.here) - Number(a.here) || (b.stage.changedAt ?? 0) - (a.stage.changedAt ?? 0) || a.stage.title.localeCompare(b.stage.title));

	const library = input.boards.filter((board) => !claimed.has(board.path) && !board.path.startsWith("canvases/") && !board.path.startsWith("shared/") && (has(board.title) || has(board.path))).sort(byTitle);
	return { folders: list, library };
}
