import type { ClaudeAccount } from "@decks/protocol";

/**
 * The first row a conversation would land on: signed in, and not spent.
 *
 * Two questions with one answer, which is why it is one function. A conversation with no
 * account of its own starts here, and a conversation that runs out moves down the list to
 * the next row matching the same rule — the server walks it from the top and takes the first
 * that qualifies (`pick` in `claude/accounts.ts`). This is that rule, here so the panel can
 * *say* which row it is: an order you can change and cannot see the effect of is a pair of
 * arrows that appear to do nothing.
 *
 * It used to take the account in force and skip it, back when a machine-wide switch existed.
 * It does not any more — switching is per conversation, in the model picker — so the top of
 * the list is simply the top of the list.
 *
 * Deliberately a second implementation rather than a field on the wire. Everything it needs
 * is already in the frame, and a server that had to compute and send "who is next" would be
 * sending a fact that goes stale the moment a limit lands.
 *
 * `now` is a parameter so a test does not have to wait for a limit to lift.
 */
export function firstUsable(accounts: ClaudeAccount[], now: number = Date.now()): string | undefined {
	return accounts.find((account) => account.signedIn && !(account.limitedUntil && account.limitedUntil > now))?.id;
}

/** Whether a row can go further in that direction — what greys the arrow out. */
export function canMove(accounts: ClaudeAccount[], id: string, direction: "up" | "down"): boolean {
	const at = accounts.findIndex((account) => account.id === id);
	if (at === -1) return false;
	return direction === "up" ? at > 0 : at < accounts.length - 1;
}
