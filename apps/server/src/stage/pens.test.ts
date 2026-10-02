import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("a stage's boards are browser items: synced in, read back in order, moved, resized and removed", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("s");
		const a = { path: "boards/a.html", x: 0, y: 0, w: 1000, h: 700, title: "A" };
		const b = { path: "boards/b.html", x: 1200, y: 0, w: 800, h: 600, title: "B" };
		assert.equal(pens.syncBoards(name, [a, b]), true);
		assert.equal(pens.syncBoards(name, [a, b]), false, "nothing changed, nothing written");
		const item = pens.get(name).doc.children[0]!;
		assert.deepEqual([item.type, item.id, item.url, item.width, item.metadata], ["browser", "a", "../../boards/a.html", 1000, { type: "decks.board", path: "boards/a.html" }]);
		assert.deepEqual(pens.boards(name).map((one) => [one.path, one.x, one.y]), [["boards/a.html", 0, 0], ["boards/b.html", 1200, 0]]);
		pens.syncBoards(name, [{ ...a, x: 50, h: 900 }]);
		assert.deepEqual(pens.boards(name), [{ path: "boards/a.html", id: "a", x: 50, y: 0, w: 1000, h: 900 }]);
		assert.equal(pens.get(name).doc.children[0]!.height, 900);
		// A board put inside a column by an edit is placed by the column, and read back there.
		pens.edit(name, [{ op: "insert", node: { type: "frame", id: "col", layout: "vertical", gap: 40, x: 0, y: 2000, children: [] } }, { op: "move", id: "a", parent: "col" }]);
		assert.deepEqual(pens.boards(name), [{ path: "boards/a.html", id: "a", x: 0, y: 2000, w: 1000, h: 900 }]);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the person's edits undo and redo, and a step is refused once an agent has drawn since", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("u");
		const ids = () => pens.get(name).doc.children.map((n) => n.id);
		pens.edit(name, [{ op: "insert", node: { type: "note", id: "a" } }], undefined, { undoable: true });
		pens.edit(name, [{ op: "insert", node: { type: "note", id: "b" } }], undefined, { undoable: true });
		assert.deepEqual(pens.steps(name), { undo: true, redo: false });
		pens.step(name, "undo");
		assert.deepEqual(ids(), ["a"]);
		pens.step(name, "redo");
		assert.deepEqual(ids(), ["a", "b"]);
		pens.step(name, "undo");
		// An agent's edit is not the person's, and undoing past it would take it back too.
		pens.edit(name, [{ op: "insert", node: { type: "note", id: "agent" } }]);
		assert.throws(() => pens.step(name, "undo"), /changed since/);
		assert.deepEqual(ids(), ["a", "agent"]);
		assert.throws(() => pens.step(name, "redo"), /Nothing to redo/);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("what is drawn on a stage, for placement: top-level items, not boards, not arrows", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("s");
		pens.edit(name, [
			{ op: "insert", node: { type: "browser", id: "b", url: "../../boards/one.html", width: 1000, height: 600, metadata: { type: "decks.board", path: "boards/one.html" } }, box: { x1: 0, y1: 0 } },
			{ op: "insert", node: { type: "note", id: "n", content: "beside it", width: 200, height: 120 }, box: { x1: 1100, y1: 0 } },
			{ op: "insert", node: { type: "frame", id: "f", width: 400, height: 300, children: [{ type: "rectangle", id: "inside", width: 50, height: 50 }] }, box: { x1: 0, y1: 800 } },
			{ op: "insert", node: { type: "path", id: "a", metadata: { type: "decks.arrow", from: "n", to: "boards/one.html" } } },
		]);
		const drawn = pens.drawn(name);
		assert.deepEqual(drawn.map((box) => [box.x, box.y]).sort(), [[0, 800], [1100, 0]], "the note and the frame, and nothing inside the frame");
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a stage's name is its own: kept as written, changed freely, and the folder never moves", () => {
	const root = mkdtempSync(join(tmpdir(), "decks-titles-"));
	try {
		const pens = new StagePens(root, () => {});
		const folder = pens.claim("Launch plan: Q4 (draft)");
		assert.equal(folder, "launch-plan-q4-draft");
		assert.equal(pens.titleOf(folder), "Launch plan: Q4 (draft)", "the title is kept exactly as given");
		assert.equal(pens.setTitle(folder, "  Café  launch —  final "), "Café launch — final");
		assert.equal(pens.titleOf(folder), "Café launch — final");
		assert.deepEqual(pens.names(), [folder], "renaming moved no folder");
		assert.throws(() => pens.setTitle(folder, "   "), /empty/);
		mkdirSync(join(root, "old-one"));
		assert.equal(pens.titleOf("old-one"), "old-one", "a stage from before titles is called by its folder");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a stage's imports are read from inside the deck, used for its boxes and its frame, and never saved", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		writeFileSync(join(dir, "components.pen"), JSON.stringify({ version: "2.14", children: [{ id: "card", type: "rectangle", reusable: true, width: 120, height: 40 }] }));
		const outside = mkdtempSync(join(tmpdir(), "outside-"));
		writeFileSync(join(outside, "x.pen"), JSON.stringify({ version: "2.14", children: [{ id: "card", type: "rectangle", reusable: true, width: 5, height: 5 }] }));
		const name = pens.claim("Wren");
		pens.replace(
			name,
			JSON.stringify({
				version: "2.14",
				imports: { deck: "../../components.pen", far: join(outside, "x.pen") },
				children: [
					{ id: "a", type: "ref", ref: "deck:card", x: 10, y: 20 },
					{ id: "b", type: "ref", ref: "far:card", x: 0, y: 0, width: 30, height: 30 },
				],
			}),
		);
		const view = pens.read(name);
		assert.deepEqual(view.children[0]!.box, { x1: 10, y1: 20, x2: 130, y2: 60 }, "the imported card's own size");
		const frame = pens.frame("agent", name) as unknown as { doc: Record<string, unknown> };
		assert.deepEqual(Object.keys((frame.doc["decks.imported"] ?? {}) as object), ["deck", "far"], "a file outside the deck is read too");
		const saved = readFileSync(join(dir, "stages", name, "stage.pen"), "utf8");
		assert.equal(saved.includes("decks.imported"), false);
		rmSync(outside, { recursive: true, force: true });
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an item saved as a frame goes to frames/, any stage places it by frames/<name>, and a change to the file reaches every stage using it", async () => {
	const dir = deck();
	const heard: string[] = [];
	const pens = new StagePens(dir, (name) => heard.push(name));
	try {
		const one = pens.claim("One");
		const two = pens.claim("Two");
		pens.edit(one, [{ op: "insert", node: { type: "frame", id: "card", layout: "vertical", width: 200, height: 80, fill: "#ffffff", children: [{ type: "text", id: "title", content: "Wren" }] }, box: { x1: 40, y1: 50 } }]);
		const saved = pens.saveFrame(one, "card", "frames/agent-card");
		assert.deepEqual(saved, { frame: "frames/agent-card.pen", ref: "frames/agent-card", replaced: true, overwrote: false });
		const file = JSON.parse(readFileSync(join(dir, "frames", "agent-card.pen"), "utf8"));
		assert.equal(file.children[0].id, "agent-card");
		assert.equal(file.children[0].reusable, true);
		assert.equal(file.children[0].x, undefined, "where it sat on the stage is not part of the frame");
		const onStage = JSON.parse(readFileSync(join(dir, "stages", one, "stage.pen"), "utf8")).children[0];
		assert.deepEqual(onStage, { type: "ref", id: "card", ref: "frames/agent-card", x: 40, y: 50 });
		assert.deepEqual(pens.read(one).children[0]!.box, { x1: 40, y1: 50, x2: 240, y2: 130 });

		pens.edit(two, [{ op: "insert", node: { type: "ref", id: "c2", ref: "frames/agent-card", descendants: { title: { content: "Ada" } } }, box: { x1: 0, y1: 0 } }]);
		assert.deepEqual(pens.read(two).children[0]!.box, { x1: 0, y1: 0, x2: 200, y2: 80 });
		assert.equal(pens.read(two).children[0]!.inside?.find((item: { id: string }) => item.id === "c2/title")?.content, "Ada");

		heard.length = 0;
		file.children[0].width = 300;
		writeFileSync(join(dir, "frames", "agent-card.pen"), JSON.stringify(file));
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.deepEqual([...new Set(heard)].sort(), [one, two].sort(), "both stages are sent again");
		assert.equal(pens.read(two).children[0]!.box.x2, 300);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("any .pen file by path: create one in frames/, read and edit it by path, and place it by its ref", () => {
	const dir = deck();
	const heard: string[] = [];
	const pens = new StagePens(dir, (name) => heard.push(name));
	try {
		const stage = pens.claim("One");
		const made = pens.createFile("frames/ui/button", { type: "frame", layout: "horizontal", padding: 8, fill: "#3b5cf6", children: [{ type: "text", id: "label", content: "Go" }] });
		assert.deepEqual(made, { file: "frames/ui/button.pen", ref: "frames/ui/button", id: "button" });
		assert.throws(() => pens.createFile("frames/ui/button.pen"), /already there/);
		assert.throws(() => pens.createFile("frames/Bad Name"), /letters, digits/);

		const view = pens.readFile("frames/ui/button");
		assert.equal((view as { ref?: string }).ref, "frames/ui/button");
		assert.equal(view.children[0]!.id, "button");

		pens.edit(stage, [{ op: "insert", node: { type: "ref", id: "b1", ref: "frames/ui/button" }, box: { x1: 100, y1: 100 } }]);
		heard.length = 0;
		const edited = pens.editFile("frames/ui/button.pen", [{ op: "update", id: "label", set: { content: "Stop" } }]);
		assert.equal(edited.file, "frames/ui/button.pen");
		assert.deepEqual(heard, [stage], "the stage that uses it is sent again at once");
		const inside = pens.read(stage).children[0]!.inside as Array<{ id: string; content?: string }>;
		assert.equal(inside.find((item) => item.id === "b1/label")?.content, "Stop");

		// A stage's own file, by its path in the deck or absolutely, is the stage.
		assert.equal(pens.readFile(`stages/${stage}/stage.pen`).children[0]!.id, "b1");
		const absolute = join(dir, "stages", stage, "stage.pen");
		assert.equal(pens.readFile(absolute).children[0]!.id, "b1");
		pens.editFile(absolute, [{ op: "update", id: "b1", box: { x1: 300, y1: 100 } }]);
		assert.equal(pens.read(stage).children[0]!.box.x1, 300);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a .pen file outside the deck is read and edited by its absolute path", () => {
	const dir = deck();
	const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
	const pens = new StagePens(dir, () => {});
	try {
		const file = join(elsewhere, "kit.pen");
		const made = pens.createFile(file, { type: "rectangle", width: 10, height: 10 });
		assert.equal(made.file, file);
		assert.equal(made.ref, undefined, "only a file in frames/ has a frames ref");
		pens.editFile(file, [{ op: "update", id: "kit", set: { width: 40 } }]);
		assert.equal(pens.readFile(file).children[0]!.box.x2, 40);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
		rmSync(elsewhere, { recursive: true, force: true });
	}
});
