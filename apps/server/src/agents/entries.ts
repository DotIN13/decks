import type { ConversationPoint } from "./backend.ts";
import { sentAs } from "./sent-as.ts";
import type { Translator } from "./translator.ts";

/**
 * The transcript's user messages, paired with the session entries they became.
 *
 * Every runtime keeps its own list of what the person said (pi's branch, Claude's session
 * file, an opencode session's messages), and the ids in it are what a rewind, a fork and a
 * card restore are addressed to. Each runtime used to walk its list against the transcript
 * with its own copy of the loop below; now each fetches its entries and hands them here.
 */

/** One user message as the runtime's session holds it: its id, and what the model was sent. */
interface SessionEntry {
	id: string;
	/** A string, or a list of parts with `text` (`sent-as.ts`). */
	content: unknown;
}

/**
 * Tag each user message in the transcript with the session entry it became.
 *
 * Walked from the end: the transcript in memory is a capped tail (`KEEP` in
 * `agents/translator.ts`), so the two sequences share a *suffix*, not a prefix, and pairing from
 * the start would line the oldest entry up against a message from the middle of the
 * conversation. Checked as it goes, and stopping at the first disagreement: a missing id costs
 * one message its rewind, which is the right way to be wrong. (The algorithm is Picone's, at
 * `picone/apps/server/src/pi/backend.ts:503`.)
 *
 * `entries` are the session's user messages, oldest first, and only the ones a person typed.
 */
export function pairUserEntries(translator: Translator, entries: readonly SessionEntry[]): void {
	const items = translator.userMessages();
	for (let offset = 1; offset <= Math.min(entries.length, items.length); offset += 1) {
		const entry = entries[entries.length - offset];
		const item = items[items.length - offset];
		if (!entry || !item) break;
		if (item.entryId === entry.id) continue;
		// The entry holds the model-facing text: reminders before it, more after (`sent-as.ts`).
		if (!sentAs(entry.content, item.text)) break;
		translator.tagUser(item.id, entry.id);
	}
}

/**
 * The points worth returning to, dated from the transcript: the user's messages that
 * `pairUserEntries` paired.
 *
 * For a runtime whose session carries no time of its own: the transcript already knows when
 * each message was sent, and the pairing gave each its session id, so this is the same list read
 * from the side that has both halves.
 */
export function translatorTimeline(translator: Translator): ConversationPoint[] {
	return translator
		.userMessages()
		.filter((item) => item.entryId)
		.map((item) => ({ id: item.entryId as string, at: item.at }));
}
