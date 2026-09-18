/**
 * The CLI saying the conversation it was told to resume is not in the store it can see.
 *
 * `--resume <id>` is looked up **inside the config directory the process is given**, so the
 * same id resolves or does not depending on that directory alone. A stored id can outlive the
 * directory it was written into: this install had an account whose `projects/` was its own
 * private copy instead of the shared store, and the session a scheduled task wanted to resume
 * was in the 53 transcripts that copy did not have. Nothing was wrong with the session, the
 * account or the task. Only the pair was wrong.
 *
 * ### Why this matches on prose
 *
 * For the reason `transient.ts` gives at length, and with the same price written down: the
 * SDK reports this as a turn whose content is the sentence, with no `is_error` and no failing
 * `subtype` to key off. A CLI release that rewords it turns the recovery off, and the symptom
 * is the old behaviour rather than a new one. `stale-session.test.ts` holds the exact strings,
 * so a reword is a failing test rather than a silence.
 *
 * Deliberately one sentence, and deliberately not "any error the CLI reports about a
 * conversation": the recovery below starts a fresh session, and that must not happen because
 * a turn mentioned the word.
 */

/** The whole of what is matched, so a reword is one place to look. */
const STALE = [/no conversation found with session id/i];

/**
 * Whether this reply is the CLI saying it cannot find the session it was asked to resume.
 *
 * The length guard is `transient.ts`'s: these are one-line errors, and a long answer that
 * happens to quote one is an answer.
 */
export function isStaleSession(text: string | undefined): boolean {
	if (!text) return false;
	const said = text.trim();
	if (!said || said.length > 2000) return false;
	return STALE.some((pattern) => pattern.test(said));
}
