import type { Infer, shapes } from "../../protocol/index.ts";
import type { CanvasDoc, Change, ItemOp, Store } from "../kernel/types.ts";

// How far each agent has read each canvas, kept under marks/<agent id>, and
// what changed since: others' changes only, never the agent's own.

export type NewsChange = Infer<typeof shapes.News>["changes"][number];
const KEY = "marks/";
const enc = new TextEncoder();
const dec = new TextDecoder();

/** The ids an op touches. */
export function idsOf(op: ItemOp): string[] {
	if (op.op === "insert") return op.item.id ? [op.item.id] : [];
	if (op.op === "copy") return op.as ? [op.id, op.as] : [op.id];
	return "id" in op && typeof op.id === "string" ? [op.id] : [];
}

/** Others' changes after a mark, each as one line of news. */
export function changesSince(doc: CanvasDoc, canvas: string, mark: number, self: string): { changes: NewsChange[]; rev: number } {
	const all: Change[] = doc.since(mark);
	const rev = all.reduce((top, c) => Math.max(top, c.rev), mark);
	const changes = all
		.filter((c) => c.by !== self)
		.map((c) => ({ canvas, ids: [...new Set(c.ops.flatMap(idsOf))], by: c.by, rev: c.rev, event: "item.changed" }));
	return { changes, rev };
}

export class Marks {
	private byAgent = new Map<string, Record<string, number>>();
	constructor(private store: Store) {}

	async load(): Promise<void> {
		for (const key of await this.store.keys(KEY)) {
			const bytes = await this.store.get(key);
			if (bytes) this.byAgent.set(key.slice(KEY.length), JSON.parse(dec.decode(bytes)) as Record<string, number>);
		}
	}

	mark(agent: string, canvas: string): number {
		return this.byAgent.get(agent)?.[canvas] ?? 0;
	}

	async move(agent: string, canvas: string, rev: number): Promise<void> {
		const marks = { ...this.byAgent.get(agent), [canvas]: rev };
		this.byAgent.set(agent, marks);
		await this.store.put(KEY + agent, enc.encode(JSON.stringify(marks)));
	}

	async drop(agent: string): Promise<void> {
		this.byAgent.delete(agent);
		await this.store.delete(KEY + agent);
	}
}
