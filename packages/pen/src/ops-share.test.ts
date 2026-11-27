import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, type Op, type PenDocument, type PenNode } from "./index.ts";
import { makeShape, shapeKind } from "./shapes.ts";

/*
 * `share` copies only what the ops change: the drawing it makes is the one a whole copy makes, the
 * drawing it was made from is left exactly as it was, and an item no op touched is the same object
 * in both, so the diff can skip it.
 */
test("shared apply: the same drawing as a whole copy, the old one untouched, untouched items shared", () => {
	let seed = 11;
	const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
	const make = (count: number): PenDocument => {
		const children: PenNode[] = [];
		for (let i = 0; i < count; i++) {
			const pick = rand(6);
			if (pick === 0) children.push({ id: `f${i}`, type: "frame", layout: "none", x: i, y: 0, width: 200, height: 200, children: [{ id: `f${i}a`, type: "rectangle", x: 1, y: 1, width: 10, height: 10 }, { id: `f${i}b`, type: "text", x: 2, y: 2, content: "hi" }] });
			else if (pick === 1) children.push({ id: `c${i}`, type: "frame", layout: "vertical", x: i, y: 300, width: 100, children: [{ id: `c${i}a`, type: "rectangle", width: 10, height: 10 }] });
			else if (pick === 2) {
				// A shape, sometimes with an outline not yet fitted to it, as a file written by hand can have.
				const shape = makeShape(shapeKind("Rounded")!, { frame: `s${i}`, outline: `s${i}-o` }, { w: 50, h: 30 }) as PenNode;
				if (rand(2)) (shape.children as PenNode[])[0]!.width = 7;
				children.push(shape);
			} else children.push({ id: `n${i}`, type: "rectangle", x: i, y: rand(100), width: 20, height: 20, fill: "#ff0000" });
		}
		return { version: "2.11", children, variables: { ink: { type: "color", value: "#000000" } } };
	};
	const ids = (doc: PenDocument): string[] => {
		const out: string[] = [];
		const visit = (nodes: PenNode[]) => nodes.forEach((n) => (out.push(n.id), Array.isArray(n.children) && visit(n.children as PenNode[])));
		visit(doc.children as PenNode[]);
		return out;
	};
	const frames = (doc: PenDocument) => ids(doc).filter((id) => /^[fc]\d+$/.test(id));
	for (let round = 0; round < 400; round++) {
		const prev = make(4 + rand(20));
		const before = JSON.stringify(prev);
		const ops: Op[] = [];
		for (let k = 0, many = 1 + rand(4); k < many; k++) {
			const all = ids(prev);
			const any = all[rand(all.length)]!;
			const frame = frames(prev)[0];
			const pick = rand(8);
			if (pick === 0) ops.push({ op: "insert", node: { type: "ellipse", width: 5, height: 5 }, ...(frame && rand(2) ? { parent: frame } : {}) });
			else if (pick === 1) ops.push({ op: "update", id: any, set: { x: rand(500), name: `r${round}` } });
			else if (pick === 2) ops.push({ op: "update", id: any, set: {}, box: { x1: rand(400), y1: rand(400), x2: 500, y2: 500 } });
			else if (pick === 3) ops.push({ op: "delete", id: any });
			else if (pick === 4 && frame && !any.startsWith(frame)) ops.push({ op: "move", id: any, parent: frame, index: 0 });
			else if (pick === 5) ops.push({ op: "move", id: any, index: 0 });
			else if (pick === 6) ops.push({ op: "copy", id: any });
			else ops.push({ op: "variables", set: { ink: { type: "color", value: "#123456" }, paper: null } });
		}
		let whole: PenDocument | undefined;
		let error: string | undefined;
		try {
			whole = apply(prev, ops, { theme: {} }).doc;
		} catch (e) {
			error = String(e);
		}
		let shared: PenDocument | undefined;
		try {
			shared = apply(prev, ops, { theme: {}, share: true }).doc;
		} catch (e) {
			assert.equal(String(e), error, `round ${round}: refused the same way`);
		}
		assert.equal(JSON.stringify(prev), before, `round ${round}: the old drawing is untouched`);
		if (error) {
			assert.equal(shared, undefined, `round ${round}: refused by both`);
			continue;
		}
		// New items get random ids: named in order of appearance before comparing.
		const known = new Set(ids(prev));
		const named = (doc: PenDocument) => {
			let n = 0;
			const fresh = new Map<string, string>();
			return JSON.parse(JSON.stringify(doc), (key, value) => (key === "id" && typeof value === "string" && !known.has(value) ? (fresh.get(value) ?? (fresh.set(value, `new${n++}`), fresh.get(value))) : value));
		};
		assert.deepEqual(named(shared!), named(whole!), `round ${round}: the same drawing`);
	}
});

test("shared apply: an item no op touched is the same object", () => {
	const prev: PenDocument = { version: "2.11", children: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 1, height: 1 }, { id: "b", type: "frame", layout: "none", x: 0, y: 0, width: 9, height: 9, children: [{ id: "b1", type: "rectangle", x: 0, y: 0, width: 1, height: 1 }, { id: "b2", type: "rectangle", x: 0, y: 0, width: 1, height: 1 }] }] };
	const next = apply(prev, [{ op: "update", id: "b1", set: { x: 5 } }], { theme: {}, share: true }).doc;
	const [a, b] = next.children as PenNode[];
	assert.equal(a, prev.children[0], "a sibling of the changed item's frame is shared");
	assert.notEqual(b, prev.children[1], "the frame above the changed item is copied");
	assert.equal((b!.children as PenNode[])[1], (prev.children[1]!.children as PenNode[])[1], "the changed item's sibling is shared");
	assert.equal(((prev.children[1]!.children as PenNode[])[0] as PenNode).x, 0, "the old item keeps its x");
});
