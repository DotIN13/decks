import type { CanvasRow } from "../../state/types/index.ts";

// The canvas manager's rules, with no store and no DOM: the order of the
// wall, a card's line of facts, and how long ago it changed.

export const FADE_MS = 120;

export type Row = { canvas: CanvasRow; hit: boolean };

/** The canvases a search leaves, in order: by name, or the one you are on first, then the latest changed. */
export function orderRows(rows: readonly Row[], sort: "recent" | "az", here: string | undefined): Row[] {
	const list = rows.filter((one) => one.hit);
	if (sort === "az") return list.sort((a, b) => a.canvas.title.localeCompare(b.canvas.title));
	const at = (one: CanvasRow) => (one.name === here ? Number.POSITIVE_INFINITY : (one.changedAt ?? 0));
	return list.sort((a, b) => at(b.canvas) - at(a.canvas) || a.canvas.title.localeCompare(b.canvas.title));
}

/** How long ago, in a few words; a date after a week. */
export function since(at: number | undefined, now = Date.now()): string | undefined {
	if (!at) return undefined;
	const minutes = Math.floor((now - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "yesterday";
	if (days < 7) return `${days} days ago`;
	return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Who shared it, how many cards, and when it changed, joined by dots. */
export function cardMeta(canvas: CanvasRow, now = Date.now()): string {
	const sharedBy = canvas.shared ? `Shared by ${canvas.shared.owner}${canvas.shared.role === "view" ? ", to view" : ""}` : undefined;
	const cards = canvas.cards === 0 ? "Empty" : `${canvas.cards} card${canvas.cards === 1 ? "" : "s"}`;
	return [sharedBy, cards, since(canvas.changedAt, now)].filter(Boolean).join(" · ");
}
