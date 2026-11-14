import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import type { Item } from "../kernel/types.ts";
import { PenCanvas } from "./doc.ts";
import { Kinds } from "./kinds.ts";

// The six drawings in tools/fixtures read in, and every item's box matches
// its expected layout (to within the 0.1 px a read rounds to).

const DIR = new URL("../../tools/fixtures/drawings/", import.meta.url).pathname;
type Expected = { items: Record<string, { box: { x: number; y: number; w: number; h: number } }> };

function boxesOf(items: Item[], out = new Map<string, Item["box"]>()): Map<string, Item["box"]> {
	for (const item of items) {
		out.set(item.id!, item.box);
		for (const inner of ((item as { inside?: Item[] }).inside ?? [])) out.set(inner.id!, inner.box);
		if (Array.isArray(item.children)) boxesOf(item.children as Item[], out);
	}
	return out;
}

const names = readdirSync(DIR).filter((f) => f.endsWith(".pen")).map((f) => f.slice(0, -4)).sort();

test("there are six fixture drawings", () => assert.equal(names.length, 6));

for (const name of names) {
	test(`${name} reads in and lays out as its expected layout says`, () => {
		const doc = new PenCanvas(name, readFileSync(`${DIR}${name}.pen`, "utf8"), new Kinds(), () => undefined);
		const got = boxesOf(doc.read());
		const expected = (JSON.parse(readFileSync(`${DIR}${name}.layout.json`, "utf8")) as Expected).items;
		for (const [id, { box }] of Object.entries(expected)) {
			const b = got.get(id);
			assert.ok(b, `${name}: ${id} is read`);
			const near = (a: number, e: number) => Math.abs(a - e) <= 0.06;
			assert.ok(near(b.x1, box.x) && near(b.y1, box.y) && near(b.x2, box.x + box.w) && near(b.y2, box.y + box.h), `${name}: ${id} is at ${JSON.stringify(b)}, expected ${JSON.stringify(box)}`);
		}
	});
}
