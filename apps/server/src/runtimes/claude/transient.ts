/**
 * A turn that failed for a reason worth waiting out, rather than an answer.
 *
 * Several Claude Code processes on one machine share one credentials file, and a token is
 * refreshed about once every eight hours. When it is due, every session wants it refreshed
 * at the same moment; the CLI serialises that with a lock and tells the losers to come back.
 * With six agents open that is five turns lost to a message the CLI itself describes as
 * transient — and it arrives as **the assistant's answer**, so the person watching has to
 * read it, understand it, and press send again.
 *
 * They should not have to. The instruction in the text — *"retry in a minute"* — is
 * something a program can follow.
 *
 * ### Why this matches on prose
 *
 * Because there is nothing else to match on. The SDK reports the turn as a *success* whose
 * content happens to be an error sentence: no `is_error`, no failing `subtype`, nothing
 * structural to key off. So this reads the sentence, and the price of that is written down
 * here rather than discovered later: a CLI release that rewords the message turns the retry
 * off, and the symptom is the old behaviour rather than a new one. That is the safe
 * direction to fail in, and `transient.test.ts` holds the exact strings so a reword is a
 * failing test rather than a silence.
 *
 * Deliberately narrow. Only failures that (a) say the cause is another process or a lock,
 * and (b) the CLI itself calls transient. "Login expired", "OAuth token revoked" and
 * "Please run /login" are none of Decks' business to retry: they need a person.
 */

/** The whole of what is matched, so a reword is one place to look. */
const TRANSIENT = [
	/another Claude Code process is refreshing it/i,
	/exited mid-refresh/i,
	/this is usually transient[,.;]? retry/i,
];

/** Refusals that look similar and must never be retried: they need somebody to sign in. */
const PERMANENT = [/please run \/login/i, /token revoked/i, /login expired/i, /disabled API key authentication/i];

/**
 * Whether this reply is the CLI saying "not now, try again".
 *
 * Both halves are required. A message that mentions a lock *and* asks for `/login` is asking
 * for a person — the CLI appends that sentence to the transient message as a last resort
 * ("if it persists … sign in again"), so a bare "mentions login" test would refuse to retry
 * exactly the case this exists for. Hence: a permanent phrase only wins when no transient
 * phrase is there.
 */
export function isTransientAuthFailure(text: string | undefined): boolean {
	if (!text) return false;
	const said = text.trim();
	if (!said || said.length > 2000) return false;
	const transient = TRANSIENT.some((pattern) => pattern.test(said));
	if (!transient) return false;
	// "…if it persists close other Claude Code processes or sign in again" is part of the
	// transient message, so only a permanent phrase *without* one of those wins.
	return !PERMANENT.some((pattern) => pattern.test(said) && !/persist/i.test(said));
}

/**
 * How long to wait before the nth retry, in milliseconds.
 *
 * The CLI says "a minute" and it is being pessimistic about the worst case: what is actually
 * being waited for is one HTTP round trip by whichever process took the lock. So the first
 * wait is short enough that a person may not notice the turn was slow, and the second is
 * long enough to cover a refresh that is genuinely stuck behind a timeout.
 */
export function retryDelayMs(attempt: number): number {
	return attempt <= 1 ? 4000 : 20_000;
}

/** How many times to try again before letting the message stand as the answer. */
export const MAX_TRANSIENT_RETRIES = 2;
