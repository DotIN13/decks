import { Refused, calls, type Caller } from "../../protocol/index.ts";
import type { Heard } from "../kernel/events.ts";
import { testServer } from "../kernel/testing.ts";
import { defineFeature, handle, type CanvasDoc, type Change, type Client, type Feature, type Item, type ItemOp } from "../kernel/types.ts";
import { peopleFeature } from "./feature.ts";

// What the people tests share: a stand-in canvas feature, a fake connection,
// and a server with both. The stand-in records who made each change.

export class FakeDoc implements CanvasDoc {
	items: Item[] = [];
	changes: Change[] = [];
	read(): Item[] {
		return this.items;
	}
	apply(ops: ItemOp[], by: Caller): { items: Item[]; rev: number } {
		const made: Item[] = [];
		for (const op of ops) if (op.op === "insert") made.push({ ...op.item, id: op.item.id ?? `i${this.items.length + 1}`, by: by.name });
		this.items.push(...made);
		const rev = this.changes.length + 1;
		this.changes.push({ rev, ops: ops.map((op, i) => (op.op === "insert" ? { ...op, item: made[i]! } : op)), by: by.id });
		return { items: made, rev };
	}
	since(rev: number): Change[] {
		return this.changes.filter((c) => c.rev > rev);
	}
}

export function standInCanvas(names: string[]): { feature: Feature; docs: Map<string, FakeDoc> } {
	const docs = new Map(names.map((n) => [n, new FakeDoc()]));
	const feature = defineFeature({
		name: "stand-in",
		calls: [handle(calls.item.insert, (ctx, { item, canvas }) => ctx.canvas(canvas).apply([{ op: "insert", item }], ctx.caller).items[0]!)],
		canvases: () => ({
			name: (n) => {
				if (!docs.has(n)) throw new Refused("not_found", `No canvas ${n}.`, "canvas.list");
				return n;
			},
			doc: (n) => docs.get(n)!,
		}),
	});
	return { feature, docs };
}

export function fakeClient(id: string): Client & { close(): void } {
	const ons = new Set<() => void>();
	return { id, closed: (on) => (ons.add(on), () => void ons.delete(on)), close: () => ons.forEach((on) => on()) };
}

export async function peopleServer(canvases: string[] = ["a", "b"]) {
	const stand = standInCanvas(canvases);
	const s = await testServer({ features: [peopleFeature(), stand.feature] });
	/** A call made on a connection. */
	const on = async (client: Client, name: string, args: Record<string, unknown>, as: Caller) => {
		const answer = await s.router.call(name, args, as, client);
		if (!answer.ok) throw Object.assign(new Error(`${name}: ${answer.error.code}: ${answer.error.message}`), { code: answer.error.code });
		return answer.value as never;
	};
	/** Every event one connection hears, as a person's connection. */
	const listen = (client: string, caller: Caller = { kind: "person", id: "person", name: "you" }) => {
		const heard: Heard[] = [];
		s.events.subscribe({ caller, client }, (one) => void heard.push(one));
		return heard;
	};
	return { s, docs: stand.docs, on, listen };
}
