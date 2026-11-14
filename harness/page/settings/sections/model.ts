import type { PairedRow } from "../../state/types/index.ts";

// Who reaches this deck, as Settings lists it: how long ago, and one row per
// name and site. Pure: no store, no DOM.

/** How long ago, in the row's words. */
export const ago = (at: number) => {
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 2) return "just now";
	if (minutes < 120) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

/** The paired front ends, one row per name and site: 44 sessions from one Studio are one row. */
export function foldPaired(rows: PairedRow[]): { label: string; origin: string; ids: string[]; last: number }[] {
	const out = new Map<string, { label: string; origin: string; ids: string[]; last: number }>();
	for (const row of rows) {
		const key = `${row.label}\u0000${row.origin}`;
		const one = out.get(key) ?? { label: row.label, origin: row.origin, ids: [], last: 0 };
		one.ids.push(row.id);
		one.last = Math.max(one.last, row.last ?? row.at);
		out.set(key, one);
	}
	return [...out.values()].sort((a, b) => b.last - a.last);
}
