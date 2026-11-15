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
	// A view call for the frame's canvas, told as today's view.called: a card's picture, an agent's cursor, a reload.
	if (name === "view.requested") return viewCalled(payload);
	const old = OLD_OF.get(name);
	return old ? { type: old, ...payload } : undefined;
}

/** Today's view.called for a view.requested the frame acts on, or undefined for one it does not. */
function viewCalled(payload: Record<string, unknown>): Record<string, unknown> | undefined {
	const args = (payload.args ?? {}) as { card?: unknown; at?: unknown; label?: unknown; color?: unknown };
	const id = typeof payload.id === "string" ? payload.id : `v${Math.random().toString(36).slice(2, 10)}`;
	const agentId = String(payload.by ?? "");
	const call = (op: string, more: Record<string, unknown>) => ({ type: "view.called", call: { op, id, agentId, args: more } });
	if (payload.call === "view.screenshot" && typeof payload.id === "string") return call("shot", { path: args.card });
	if (payload.call === "view.cursor") return call("cursor", { path: args.card, at: args.at, label: args.label, ...(args.color ? { color: args.color } : {}) });
	if (payload.call === "view.reload" && typeof args.card === "string") return call("reload", { path: args.card });
	return undefined;
}
