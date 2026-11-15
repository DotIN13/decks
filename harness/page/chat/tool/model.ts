import type { ToolItem } from "../turn/rows.ts";

// Which of a turn's tool calls may fold behind a count, and the names its header shows.

/** One thing the group renders: either a header over finished calls, or a bare call. */
export type ToolSlot =
	| { kind: "group"; id: string; calls: ToolItem[]; names: string[]; more: number }
	| { kind: "call"; id: string; call: ToolItem };

/** Split a turn's calls into what may hide behind a count and what may not. */
export function toolSlots(calls: readonly ToolItem[]): ToolSlot[] {
	const slots: ToolSlot[] = [];
	let run: ToolItem[] = [];

	const flush = () => {
		// A run of one is a row: see the third rule.
		if (run.length === 1 && run[0]) slots.push({ kind: "call", id: run[0].id, call: run[0] });
		else if (run.length > 1 && run[0]) slots.push({ kind: "group", id: run[0].id, calls: run, ...distinctNames(run) });
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

/** A call that has finished and finished cleanly, the only kind that may be hidden. */
const collapsible = (call: ToolItem) => call.state === "done";

/** How many distinct names a header shows before it starts counting them instead. */
const NAMES = 3;

/** The names in a header: distinct, in the order they first ran, and truncated. */
export function distinctNames(calls: readonly ToolItem[], limit: number = NAMES): { names: string[]; more: number } {
	const seen: string[] = [];
	for (const call of calls) {
		const name = call.name.trim();
		if (!name || seen.includes(name)) continue;
		seen.push(name);
	}
	return { names: seen.slice(0, limit), more: Math.max(0, seen.length - limit) };
}
