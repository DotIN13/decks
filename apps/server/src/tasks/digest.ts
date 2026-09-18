/**
 * The digest, the first concrete cron use: a board summarising what each workspace
 * did, written each morning by whoever the schedule's workspace says.
 *
 * Pure on purpose: the text is part of the schedule's contract, so a test can pin
 * both the board path and every word the agent will be handed. The agent reads
 * board modification times off `stage.boards()`, which is the whole reason
 * `modifiedAt` is on the wire — this task is the consumer it was published for. Who wrote
 * a board is beside it as `lastWrittenBy`, which an agent sets by naming the board
 * (`stage.fit`, a one-board `stage.show`, `stage.report`), never by a file event.
 */

/** The board the digest for a given day is written to, so the schedule can say so in the task text. */
export function digestBoardPath(now: number): string {
	const at = new Date(now);
	const stamp = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
	return `boards/digest-${stamp}.html`;
}

/** The title the digest board should carry, derived from the same date as its path. */
export function digestTitle(now: number): string {
	const at = new Date(now);
	const stamp = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
	return `Digest for ${stamp}`;
}

/**
 * Every word the assigned agent is given, once the schedule says "digest".
 *
 * One board, one job: read what was written since the last digest, group it by
 * workspace, and say it plainly. The last line is not decoration — the digest is
 * the morning's first thing to read, and an agent that made the board and then
 * walked away without putting it in front of the reader made a file, not a digest.
 */
export function digestTask(now: number): string {
	const path = digestBoardPath(now);
	const title = digestTitle(now);
	const yesterday = now - 24 * 60 * 60 * 1000;
	const at = new Date(yesterday);
	const since = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
	return [
		`Write the daily digest board ${path} and title it \`${title}\`.`,
		`Look at every board in this deck modified since ${since}: \`stage.boards()\` now carries each board's last-modified time, so sort by it and take the boards newer than that date.`,
		"Group them by workspace: a board belongs to the workspace of its writer, which is `lastWrittenBy` on the board (an agent id from `stage.agents()`, or \"you\" for the person), and failing that to the workspace of an agent holding it. For each workspace with new boards name its latest board and give each new board one line, saying who wrote it.",
		"Keep it to one board, plain language, short sentences, and no em dashes.",
		"When the board is written, stage.show it so the reader sees it first thing.",
	].join(" ");
}