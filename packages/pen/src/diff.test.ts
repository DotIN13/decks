import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { applyEdits, diff } from "./diff.ts";
import { parse, type PenDocument, type PenNode } from "./index.ts";

/** Field order inside an item does not matter to anyone reading it; compare as sorted JSON. */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const check = (a: PenDocument, b: PenDocument) => assert.deepEqual(canon(applyEdits(a, diff(a, b))), canon(b));

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
