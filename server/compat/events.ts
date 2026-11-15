import { OLD_EVENTS } from "./table.ts";

// A new event told as the old one today's line expects. Rule 4: a change to a drawing is told
// whole, as today's canvas.changed with the drawing and its revision.

/** The old name each new event is told as: the first old row that named it, never an alias. */
const OLD_OF = new Map<string, string>();
for (const [old, now] of OLD_EVENTS) if (!OLD_OF.has(now)) OLD_OF.set(now, old);

/** The new events an old line listens to. */
export const HEARD = [...OLD_OF.keys()];


/** What the line says for one heard event; drawing() reads a canvas's drawing when it changed. */
export async function told(
	name: string,
	payload: Record<string, unknown>,
	drawing: (canvas: string) => Promise<{ doc: unknown; base: string } | undefined>,
): Promise<Record<string, unknown> | undefined> {
	if (name === "item.changed") {
		const canvas = String(payload.canvas ?? "");
		const read = await drawing(canvas);
		if (!read) return undefined;
		const made = Array.isArray(payload.made) ? { made: payload.made } : {};
		return { type: "canvas.changed", canvas, rev: payload.rev, doc: read.doc, base: read.base, by: payload.by, ...made };
	}
	if (name === "view.changed") return { type: "presence.changed", ...payload };
	// A screen asked for a card's picture: today's frame shoots it on view.called "shot".
	if (name === "view.requested") {
		if (payload.call !== "view.screenshot" || typeof payload.id !== "string") return undefined;
		const card = (payload.args as { card?: unknown } | undefined)?.card;
		return { type: "view.called", call: { op: "shot", id: payload.id, args: { path: card } } };
	}
	const old = OLD_OF.get(name);
	return old ? { type: old, ...payload } : undefined;
}
