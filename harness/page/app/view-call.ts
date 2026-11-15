import type { StageCall } from "../state/types/index.ts";

// A view.requested event as today's call (show, camera, goto, reload, cursor)
// in today's argument names, which the canvas library's runner reads. Pure.

export type Requested = { call?: string; args?: Record<string, unknown>; by?: string; canvas?: string };
const OPS: Record<string, StageCall["op"]> = { "view.focus": "show", "view.move": "camera", "view.goto": "goto", "view.reload": "reload", "view.cursor": "cursor" };

/** A view.requested event as today's call: its op, and its arguments in today's names. */
export function stageCallOf(event: Requested, boxOf: (id: string) => { x: number; y: number; w: number; h: number } | undefined): StageCall | undefined {
	const op = event.call ? OPS[event.call] : undefined;
	if (!op) return undefined;
	const args = event.args ?? {};
	// The person's own call moves this screen; an agent's may wait for its chat.
	const base = { id: `v${Date.now()}`, agentId: event.by && event.by !== "person" ? event.by : "", op };
	if (op === "show") {
		const targets = ([] as unknown[]).concat(args.target ?? []).map(String);
		const paths = targets.filter((one) => one.endsWith(".html"));
		const items = targets.filter((one) => !one.endsWith(".html")).flatMap((id) => (boxOf(id) ? [{ id, box: boxOf(id)! }] : []));
		return { ...base, args: { paths, items, ...(event.canvas ? { stage: event.canvas } : {}), ...(args.highlight ? { highlight: args.highlight } : {}), ...(args.animate ? { animate: true } : {}) } };
	}
	if (op === "goto") return { ...base, args: { stage: args.canvas ?? event.canvas } };
	if (op === "reload") return { ...base, args: { path: args.card, ...(args.canvas ? { stage: args.canvas, count: true } : {}) } };
	if (op === "cursor") return { ...base, args: { path: args.card, at: args.at ?? null, label: args.label, color: args.color } };
	return { ...base, args };
}
