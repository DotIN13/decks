// A new event told as the old one today's line expects. Rule 4: a change to a drawing is told
// whole, as today's canvas.changed with the drawing and its revision.
import { OLD_EVENTS } from "./table.ts";

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
	cardPage: (path: string) => Promise<Record<string, unknown> | undefined> = async () => undefined,
): Promise<Record<string, unknown> | undefined> {
	// A card changed: today's card.changed carried its page, news included, which the frame keeps.
	if (name === "card.changed" && Array.isArray(payload.ids) && typeof payload.ids[0] === "string") {
		const path = payload.ids[0];
		const card = payload.removed ? undefined : await cardPage(path);
		return { type: "card.changed", path, rev: payload.rev ?? 0, ...(card ? { card } : {}), ...(payload.removed ? { removed: true } : {}), ...(payload.sized ? { sized: true } : {}) };
	}
	if (name === "item.changed") {
		const canvas = String(payload.canvas ?? "");
		const read = await drawing(canvas);
		if (!read) return undefined;
		const made = Array.isArray(payload.made) ? { made: payload.made } : {};
		return { type: "canvas.changed", canvas, rev: payload.rev, doc: read.doc, base: read.base, by: payload.by, ...made };
	}
	if (name === "view.changed") return presence(payload);
	// A view call for the frame's canvas, told as today's view.called: a card's picture, an agent's cursor, a reload.
	if (name === "view.requested") return viewCalled(payload);
	if (name === "app.changed") return appChanged(payload);
	if (name === "agent.acted") return agentAct(payload);
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

/** view.changed as today's presence.changed: who, and only what they said. */
function presence(payload: Record<string, unknown>): Record<string, unknown> {
	const by = { kind: payload.kind ?? "person", id: String(payload.by ?? ""), ...(payload.name ? { name: payload.name } : {}), ...(payload.color ? { color: payload.color } : {}) };
	const said = Object.fromEntries(["pointer", "selection", "camera", "gone"].filter((k) => k in payload).map((k) => [k, payload[k]]));
	return { type: "presence.changed", canvas: payload.canvas, by, ...said };
}

/** Today's app.changed: the app by name, which its windows on a canvas listen by, and its state. */
export function appChanged(payload: Record<string, unknown>): Record<string, unknown> | undefined {
	const name = Array.isArray(payload.ids) ? payload.ids[0] : undefined;
	if (typeof name !== "string") return undefined;
	return { type: "app.changed", name, status: payload.status, ...(typeof payload.title === "string" ? { title: payload.title } : {}) };
}

/**
 * Today's agent.act: an agent's edit on a card, by the card's path and the agent, for its cursor and glow.
 * An act with no card path is not told: the frame finds the card by its path.
 */
export function agentAct(payload: Record<string, unknown>): Record<string, unknown> | undefined {
	const path = Array.isArray(payload.ids) ? payload.ids.find((id) => typeof id === "string" && id.includes("/")) : undefined;
	if (typeof path !== "string") return undefined;
	return {
		type: "agent.act",
		agentId: payload.by,
		path,
		phase: payload.phase,
		what: payload.what,
		label: payload.label,
		color: payload.color,
		...(Array.isArray(payload.boxes) ? { boxes: payload.boxes } : {}),
		at: typeof payload.at === "number" ? payload.at : Date.now(),
	};
}
