import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { StagePens, type PenEntry } from "./pens.ts";

const deck = () => mkdtempSync(join(tmpdir(), "pens-"));

test("an edit writes a native .pen file, answers with results, and announces the change", () => {
	const dir = deck();
	const heard: Array<[string, PenEntry]> = [];
	const pens = new StagePens(dir, (name, entry) => heard.push([name, entry]));
	try {
		const name = pens.claim("Wren");
		assert.equal(name, "wren");
		assert.equal(pens.claim("Wren"), "wren-2");
		const { entry, results } = pens.edit(name, [{ op: "insert", node: { type: "note", id: "n", content: "hi" }, box: { x1: 10, y1: 20 } }]);
		assert.deepEqual(results, [{ op: "insert", id: "n" }]);
		const saved = JSON.parse(readFileSync(join(dir, "stages", "wren", "stage.pen"), "utf8"));
		assert.equal(saved.version, "2.14");
		assert.deepEqual(saved.children, [{ type: "note", id: "n", content: "hi", x: 10, y: 20 }]);
		assert.equal(heard.length, 1);
		assert.equal(heard[0]![1].rev, entry.rev);
		const view = pens.read(name);
		assert.equal(view.children[0]!.box.x1, 10);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a failed edit writes nothing; a hand edit is read back; a broken file keeps the last good document", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("s");
		pens.edit(name, [{ op: "insert", node: { type: "note", id: "a" } }]);
		assert.throws(() => pens.edit(name, [{ op: "insert", node: { type: "note", id: "b" } }, { op: "delete", id: "zzz" }]), /Edit 2 \(delete\) failed/);
		assert.deepEqual(pens.get(name).doc.children.map((n) => n.id), ["a"]);

		const file = pens.fileOf(name);
		writeFileSync(file, JSON.stringify({ version: "2.14", children: [{ type: "text", id: "t", content: "by hand" }] }));
		assert.equal(pens.get(name).doc.children[0]!.content, "by hand");

		writeFileSync(file, "{ not json");
		const broken = pens.get(name);
		assert.match(broken.error ?? "", /does not parse/);
		assert.equal(broken.doc.children[0]!.content, "by hand");
		assert.throws(() => pens.edit(name, [{ op: "delete", id: "t" }]), /Fix the file/);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an arrow to a board is drawn on edit, and follows the board when it moves", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("s");
		let board = { x: 400, y: 0, w: 200, h: 100 };
		pens.edit(
			name,
			[
				{ op: "insert", node: { type: "note", id: "n", width: 100, height: 100 }, box: { x1: 0, y1: 0 } },
				{ op: "insert", node: { type: "path", id: "a", metadata: { type: "decks.arrow", from: "n", to: "boards/b.html" } } },
			],
			(path) => (path === "boards/b.html" ? board : undefined),
		);
		const first = pens.get(name).doc.children[1]!;
		assert.ok(typeof first.geometry === "string" && (first.x as number) >= 100 - 3 && (first.x as number) + (first.width as number) <= 400 + 3);
		board = { x: 800, y: 0, w: 200, h: 100 };
		pens.follow(name, (path) => (path === "boards/b.html" ? board : undefined));
		const moved = pens.get(name).doc.children[1]!;
		assert.ok((moved.x as number) + (moved.width as number) > 790);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
