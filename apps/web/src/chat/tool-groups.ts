import type { ToolItem } from "./float-rows.ts";

/**
 * Which of a turn's tool calls may hide behind a count, and which may not.
 *
 * A turn that read nine files is nine 24px rows in a 320px column, which is a card whose
 * subject is the file system rather than the answer. So a run of calls collapses to one
 * header — a chevron, the count, the distinct names — and opens when asked.
 *
 * The three rules are the whole file, and each one is a way of *not* grouping:
 *
 * - **The call still running is never inside the collapsed part.** It stays a row of its own
 *   with its live dot while the finished ones sit above it behind a count. A group that hid
 *   the running call would be a progress indicator that stops indicating at the exact moment
 *   there is progress to report.
 * - **An errored call never collapses either.** The point of grouping is to hide what went
 *   as expected; a failure is the one line in the turn worth the vertical space.
 * - **One call is just a row.** A header over a single thing spends 24px to say "1", and it
 *   costs a click to see what a row would already have shown.
 *
 * Consecutive, not merely same-turn: order carries meaning here. `read · read · write(running)`
 * is "two done, one going", and a grouping that swept up the two `read`s from either side of
 * the live call would report a sequence that never happened.
 *
 * Pure, and separate from `ToolGroup.tsx`, because these three rules are the part worth
 * asserting and a component is a poor place to assert anything.
 */

/**
 * One thing the group renders: either a header over finished calls, or a bare call.
 *
 * `id` is the first call's id in both cases, which is what a keyed list wants — stable while
 * the run grows at its end, and never shared between two slots.
 */
export type ToolSlot =
	| { kind: "group"; id: string; calls: ToolItem[] }
	| { kind: "call"; id: string; call: ToolItem };

/** How many distinct names a header shows before it starts counting them instead. */
const NAMES = 3;

/** A call that has finished and finished cleanly — the only kind that may be hidden. */
const collapsible = (call: ToolItem) => call.state === "done";

/** Split a turn's calls into what may hide behind a count and what may not. */
export function toolSlots(calls: readonly ToolItem[]): ToolSlot[] {
	const slots: ToolSlot[] = [];
	let run: ToolItem[] = [];

	const flush = () => {
		// A run of one is a row: see the third rule.
		if (run.length === 1 && run[0]) slots.push({ kind: "call", id: run[0].id, call: run[0] });
		else if (run.length > 1 && run[0]) slots.push({ kind: "group", id: run[0].id, calls: run });
		run = [];
	};

	for (const call of calls) {
		if (collapsible(call)) {
			run.push(call);
			continue;
		}
		// Running or errored: it interrupts the run rather than joining it, and everything
		// gathered so far keeps its place *above* it.
		flush();
		slots.push({ kind: "call", id: call.id, call });
	}
	flush();
	return slots;
}

/**
 * The names in a header: distinct, in the order they first ran, and truncated.
 *
 * Deduped because "read · read · read · read" says less than "read" does — the count beside
 * it already carries how many. Truncated because the names share a 320px row with the count
 * and an ellipsis of names is a header that has stopped being a summary; `more` is what is
 * left over, so the caller can say "+2" rather than losing them silently.
 */
export function distinctNames(calls: readonly ToolItem[], limit: number = NAMES): { names: string[]; more: number } {
	const seen: string[] = [];
	for (const call of calls) {
		const name = call.name.trim();
		if (!name || seen.includes(name)) continue;
		seen.push(name);
	}
	return { names: seen.slice(0, limit), more: Math.max(0, seen.length - limit) };
}
