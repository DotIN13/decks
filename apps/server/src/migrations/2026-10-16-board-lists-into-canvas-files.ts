/**
 * 2026-10-16: which boards are on a canvas is the canvas file's alone (`stage/canvas-ops.ts`).
 *
 * Before, each agent's record kept its own list (`inPlay` in `.decks/agents/<id>/meta.json`). A
 * restored record still carrying one has it written into its canvas file, once, and only when that
 * file holds no boards yet: a canvas file with boards in it is the truth, and another agent's list
 * must not be laid over it. The record stops saving the list on its next write (`agents/session.ts`).
 *
 * Runs on read, as each agent is restored (`DeckAgent.adoptStage`). Returns the boards to put on the
 * canvas, or nothing.
 */
export function recordedBoardsToAdopt(onCanvas: number, recorded: readonly string[] | undefined): string[] {
	if (onCanvas > 0 || !recorded?.length) return [];
	return [...recorded];
}
