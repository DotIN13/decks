import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { applyEdits, diff, editDocument } from "./diff.ts";
import { parse, type PenDocument, type PenNode } from "./index.ts";

/** Field order inside an item does not matter to anyone reading it; compare as sorted JSON. */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const check = (a: PenDocument, b: PenDocument) => {
	const edits = diff(a, b);
	assert.deepEqual(canon(applyEdits(a, edits)), canon(b));
	// The sharing copy gives the same drawing, and leaves the one it was given as it was.
	const before = JSON.stringify(a);
	assert.deepEqual(canon(editDocument(a, edits)), canon(b));
	assert.equal(JSON.stringify(a), before);
};

test("fields, inserts, removals, moves and order", () => {
	const a = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "frame", id: "f", children: [{ type: "text", id: "t", content: "x" }, { type: "rectangle", id: "r" }] },
		{ type: "ellipse", id: "e" }, { type: "rectangle", id: "gone", children: [{ type: "text", id: "under" }] },
	] }));
	const b = parse(JSON.stringify({ version: "2.14", variables: {}, children: [
		{ type: "ellipse", id: "e", fill: "#f00" },
		{ type: "frame", id: "f", children: [{ type: "rectangle", id: "r" }, { type: "group", id: "new", children: [{ type: "text", id: "t", content: "y" }] }] },
		{ type: "note", id: "n" },
	] }));
	check(a, b);
	check(b, a);
	assert.equal(diff(a, a).length, 0);
});

test("random shuffles and edits", () => {
	let seed = 7;
	const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
	const make = (n: number): PenDocument => {
		const nodes: PenNode[] = [];
		const all: PenNode[] = [];
		for (let i = 0; i < n; i++) {
			const node: PenNode = { type: rand() < 0.3 ? "frame" : "rectangle", id: `i${i}`, x: Math.floor(rand() * 9) };
			if (node.type === "frame") node.children = [];
			const parents = all.filter((p) => p.children);
			const parent = rand() < 0.5 && parents.length ? parents[Math.floor(rand() * parents.length)]! : undefined;
			(parent ? parent.children! : nodes).splice(Math.floor(rand() * ((parent ? parent.children!.length : nodes.length) + 1)), 0, node);
			all.push(node);
		}
		return { version: "2.14", children: nodes };
	};
	for (let round = 0; round < 200; round++) check(make(3 + Math.floor(rand() * 12)), make(3 + Math.floor(rand() * 12)));
});

test("every saved stage against every other version of itself", () => {
	const root = process.env.STAGE_FIXTURES;
	if (!root || !existsSync(root)) return;
	const docs = readdirSync(root).flatMap((name) => {
		const file = join(root, name, "stage.pen");
		try {
			return existsSync(file) ? [parse(readFileSync(file, "utf8"))] : [];
		} catch {
			return [];
		}
	});
	for (let i = 0; i + 1 < docs.length; i++) check(docs[i]!, docs[i + 1]!);
});

test("an edit shares every item it does not reach", () => {
	const a = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "frame", id: "f", children: [{ type: "text", id: "t", content: "x" }, { type: "rectangle", id: "r" }] },
		{ type: "ellipse", id: "e" },
	] }));
	const b = editDocument(a, [{ op: "set", id: "t", key: "content", value: "y" }]);
	assert.equal(b.children[1], a.children[1]);
	assert.notEqual(b.children[0], a.children[0]);
	assert.equal(b.children[0]!.children![1], a.children[0]!.children![1]);
	assert.equal(b.children[0]!.children![0]!.content, "y");
	assert.equal(a.children[0]!.children![0]!.content, "x");
});

/*
 * Exact under any change: random drawings changed at random (moves, inserts, removals, items taken
 * into or out of a frame, fields), and the edits applied to the old drawing give the new one. And few:
 * bringing one old item to the front is one move, not one per item above it.
 */
test("random changes: the edits rebuild the new drawing exactly", () => {
	let seed = 7;
	const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
	const make = (count: number): PenDocument => {
		const children: PenNode[] = [];
		for (let i = 0; i < count; i++) {
			if (rand(5) === 0) children.push({ id: `f${i}`, type: "frame", x: i, children: [{ id: `f${i}a`, type: "rectangle", x: 1 }, { id: `f${i}b`, type: "text", x: 2 }] });
			else children.push({ id: `n${i}`, type: "rectangle", x: i, y: rand(100) });
		}
		return { version: "2.11", children };
	};
	for (let round = 0; round < 300; round++) {
		const prev = make(5 + rand(25));
		const next = structuredClone(prev);
		const top = next.children as PenNode[];
		for (let change = 0, many = 1 + rand(6); change < many; change++) {
			const pick = rand(6);
			if (!top.length) break;
			if (pick === 0) top.push(top.splice(rand(top.length), 1)[0]!); // to the front
			else if (pick === 1) top.unshift(top.splice(rand(top.length), 1)[0]!); // to the back
			else if (pick === 2) top.splice(rand(top.length + 1), 0, { id: `new${round}-${change}`, type: "ellipse", x: 0 });
			else if (pick === 3) top.splice(rand(top.length), 1);
			else if (pick === 4) {
				const frame = top.find((n) => Array.isArray(n.children));
				const i = rand(top.length);
				if (frame && top[i] !== frame) (frame.children as PenNode[]).push(top.splice(i, 1)[0]!);
			} else top[rand(top.length)]!.x = rand(1000);
		}
		const edits = diff(prev, next);
		assert.deepEqual(editDocument(prev, edits), next, `round ${round}`);
		assert.deepEqual(canon(applyEdits(prev, edits)), canon(next), `round ${round}, applyEdits`);
	}
});

test("bringing one old item to the front of many is one move", () => {
	const children: PenNode[] = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, type: "rectangle", x: i }));
	const prev: PenDocument = { version: "2.11", children };
	const next: PenDocument = { version: "2.11", children: [...children.slice(0, 10), ...children.slice(11), children[10]!] };
	const edits = diff(prev, next);
	assert.deepEqual(edits, [{ op: "place", id: "n10", parent: null, after: "n499" }]);
	assert.deepEqual(editDocument(prev, edits), next);
});
