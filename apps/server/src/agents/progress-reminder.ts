/**
 * The line that asks an agent to start its progress card before it starts the work.
 *
 * Taught in AGENTS.md and card-authoring/progress.md, and still skipped: the first real agent given
 * a sieve to write and a benchmark to run did all of it, then wrote a tidy progress card at the end,
 * after the person had watched nothing move for minutes. Like the identity request
 * (`identity-reminder.ts`), the rule travels at the moment it is cheap to act on, put before the
 * words of a message that starts a turn (`agents/session.ts`). A message sent into a running turn
 * gets none: the agent is already working and has heard it.
 *
 * The second real agent made its card first, then left it at "step 1, writing" for twelve minutes
 * while it wrote the tests and sat on a corpus script that never finished: hence the line about
 * long runs and their time limits.
 */
export const PROGRESS_REMINDER =
	"[Decks] If this is work of three steps or more, or anything long or in the background: make your progress card in your row of Working before you run anything (card-authoring skill, progress.md). Write each step (goal or hypothesis, method, expect) as you reach it, put each command on the card before it runs (with a time limit on anything long), and its result, failure or finding as it ends. A small job goes straight to its answer.";

/** The line, for a message that starts a turn; nothing for one that lands in a turn under way. */
export function progressReminder(startsTurn: boolean): string | undefined {
	return startsTurn ? PROGRESS_REMINDER : undefined;
}
