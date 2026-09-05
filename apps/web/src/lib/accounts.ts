import type { ClaudeAccount } from "@decks/protocol";

/**
 * Which account a limit would move to, given the list as it stands.
 *
 * The list is the priority: the server walks it from the top and takes the first row that is
 * signed in, not spent, and not the one that just refused (`pick` in `claude/accounts.ts`).
 * This is the same rule, and it is here so the panel can *say* which row that is — an order
 * you can change and cannot see the effect of is a pair of arrows that appear to do nothing.
 *
 * It is deliberately a second implementation rather than a field on the wire. Everything it
 * needs is already in the frame, and a server that had to compute and send "who is next"
 * would be sending a fact that goes stale the moment a limit lands — the browser recomputes
 * on every repaint for free.
 *
 * `now` is a parameter so a test does not have to wait for a limit to lift.
 */
export function nextUp(accounts: ClaudeAccount[], active: string, now: number = Date.now()): string | undefined {
	return accounts.find((account) => account.id !== active && account.signedIn && !(account.limitedUntil && account.limitedUntil > now))?.id;
}

/** Whether a row can go further in that direction — what greys the arrow out. */
export function canMove(accounts: ClaudeAccount[], id: string, direction: "up" | "down"): boolean {
	const at = accounts.findIndex((account) => account.id === id);
	if (at === -1) return false;
	return direction === "up" ? at > 0 : at < accounts.length - 1;
}
