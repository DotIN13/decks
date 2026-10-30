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
		const saved = JSON.parse(readFileSync(join(dir, "canvases", "wren", "canvas.pen"), "utf8"));
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
		const a = { path: "canvases/s/boards/a.html", x: 0, y: 0, w: 1000, h: 700, title: "A" };
		const b = { path: "canvases/s/boards/b.html", x: 1200, y: 0, w: 800, h: 600, title: "B" };
		assert.equal(pens.syncBoards(name, [a, b]), true);
		assert.equal(pens.syncBoards(name, [a, b]), false, "nothing changed, nothing written");
		const item = pens.get(name).doc.children[0]!;
		// Held by its deck path; written from the canvas's own folder.
		assert.deepEqual([item.type, item.id, item.url, item.width, item.metadata], ["browser", "a", "boards/a.html", 1000, { type: "decks.board", path: "canvases/s/boards/a.html" }]);
		const saved = JSON.parse(readFileSync(join(dir, "canvases", "s", "canvas.pen"), "utf8")).children[0];
		assert.deepEqual([saved.url, saved.metadata.path], ["boards/a.html", "boards/a.html"]);
		assert.deepEqual(pens.boards(name).map((one) => [one.path, one.x, one.y]), [["canvases/s/boards/a.html", 0, 0], ["canvases/s/boards/b.html", 1200, 0]]);
		pens.syncBoards(name, [{ ...a, x: 50, h: 900 }]);
		assert.deepEqual(pens.boards(name), [{ path: "canvases/s/boards/a.html", id: "a", x: 50, y: 0, w: 1000, h: 900 }]);
		assert.equal(pens.get(name).doc.children[0]!.height, 900);
		// A board put inside a column by an edit is placed by the column, and read back there.
		pens.edit(name, [{ op: "insert", node: { type: "frame", id: "col", layout: "vertical", gap: 40, x: 0, y: 2000, children: [] } }, { op: "move", id: "a", parent: "col" }]);
		assert.deepEqual(pens.boards(name), [{ path: "canvases/s/boards/a.html", id: "a", x: 0, y: 2000, w: 1000, h: 900 }]);
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
			{ op: "insert", node: { type: "browser", id: "b", url: "boards/one.html", width: 1000, height: 600, metadata: { type: "decks.board", path: "canvases/s/boards/one.html" } }, box: { x1: 0, y1: 0 } },
			{ op: "insert", node: { type: "note", id: "n", content: "beside it", width: 200, height: 120 }, box: { x1: 1100, y1: 0 } },
			{ op: "insert", node: { type: "frame", id: "f", width: 400, height: 300, children: [{ type: "rectangle", id: "inside", width: 50, height: 50 }] }, box: { x1: 0, y1: 800 } },
			{ op: "insert", node: { type: "path", id: "a", metadata: { type: "decks.arrow", from: "n", to: "canvases/s/boards/one.html" } } },
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
	const pens = new StagePens(root, () => {});
	try {
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
		pens.close();
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
		const saved = readFileSync(join(dir, "canvases", name, "canvas.pen"), "utf8");
		assert.equal(saved.includes("decks.imported"), false);
		rmSync(outside, { recursive: true, force: true });
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an item saved as a frame goes to its canvas's own frames/, placed there by frames/<name>, and a change to the file reaches that canvas", async () => {
	const dir = deck();
	const heard: string[] = [];
	const pens = new StagePens(dir, (name) => heard.push(name));
	try {
		const one = pens.claim("One");
		pens.edit(one, [{ op: "insert", node: { type: "frame", id: "card", layout: "vertical", width: 200, height: 80, fill: "#ffffff", children: [{ type: "text", id: "title", content: "Wren" }] }, box: { x1: 40, y1: 50 } }]);
		const saved = pens.saveFrame(one, "card", "frames/agent-card");
		assert.deepEqual(saved, { frame: "canvases/one/frames/agent-card.pen", ref: "frames/agent-card", replaced: true, overwrote: false });
		const path = join(dir, "canvases", one, "frames", "agent-card.pen");
		const file = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(file.children[0].id, "agent-card");
		assert.equal(file.children[0].reusable, true);
		assert.equal(file.children[0].x, undefined, "where it sat on the stage is not part of the frame");
		const onStage = JSON.parse(readFileSync(join(dir, "canvases", one, "canvas.pen"), "utf8")).children[0];
		assert.deepEqual(onStage, { type: "ref", id: "card", ref: "frames/agent-card", x: 40, y: 50 });
		assert.deepEqual(pens.read(one).children[0]!.box, { x1: 40, y1: 50, x2: 240, y2: 130 });
		pens.edit(one, [{ op: "insert", node: { type: "ref", id: "c2", ref: "frames/agent-card", descendants: { title: { content: "Ada" } } }, box: { x1: 0, y1: 300 } }]);
		assert.equal(pens.read(one).children[1]!.inside?.find((item: { id: string }) => item.id === "c2/title")?.content, "Ada");

		// fs.watch on macOS (FSEvents) goes live a moment after it starts, with no ready signal, so one
		// write can land before it listens. Write again until the canvas is heard.
		heard.length = 0;
		file.children[0].width = 300;
		for (let tries = 0; tries < 10 && !heard.includes(one); tries++) {
			writeFileSync(path, JSON.stringify(file));
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		assert.ok(heard.includes(one), "the canvas is sent again");
		assert.equal(pens.read(one).children[0]!.box.x2, 340);
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

		// Placed on a canvas, a frame from the deck's own frames/ is copied into the canvas's, and is the canvas's from then on.
		pens.edit(stage, [{ op: "insert", node: { type: "ref", id: "b1", ref: "frames/ui/button" }, box: { x1: 100, y1: 100 } }]);
		const copy = `canvases/${stage}/frames/ui/button.pen`;
		assert.equal(JSON.parse(readFileSync(join(dir, copy), "utf8")).children[0].id, "button");
		heard.length = 0;
		const edited = pens.editFile(copy, [{ op: "update", id: "label", set: { content: "Stop" } }]);
		assert.equal(edited.file, copy);
		assert.deepEqual(heard, [stage], "the canvas that uses it is sent again at once");
		const inside = pens.read(stage).children[0]!.inside as Array<{ id: string; content?: string }>;
		assert.equal(inside.find((item) => item.id === "b1/label")?.content, "Stop");
		pens.editFile("frames/ui/button.pen", [{ op: "update", id: "label", set: { content: "Library" } }]);
		assert.equal((pens.read(stage).children[0]!.inside as Array<{ id: string; content?: string }>).find((item) => item.id === "b1/label")?.content, "Stop", "the library's change does not reach the copy");

		// A stage's own file, by its path in the deck or absolutely, is the stage.
		assert.equal(pens.readFile(`canvases/${stage}/canvas.pen`).children[0]!.id, "b1");
		const absolute = join(dir, "canvases", stage, "canvas.pen");
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

test("a canvas stands alone: a board placed from the library is copied in, and a picture filled from the deck's assets/ too", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		mkdirSync(join(dir, "boards"), { recursive: true });
		mkdirSync(join(dir, "assets"), { recursive: true });
		writeFileSync(join(dir, "boards", "plan.html"), '<link rel="stylesheet" href="../lib/board.css"><img src="../assets/a.png">');
		writeFileSync(join(dir, "assets", "a.png"), "png");
		const name = pens.claim("s");
		pens.edit(name, [
			{ op: "insert", node: { type: "browser", id: "b", url: "../../boards/plan.html", width: 600, height: 400, metadata: { type: "decks.board", path: "boards/plan.html" } }, box: { x1: 0, y1: 0 } },
			{ op: "insert", node: { type: "rectangle", id: "pic", width: 100, height: 100, fill: { type: "image", url: "../../assets/a.png", mode: "fill" } }, box: { x1: 700, y1: 0 } },
		]);
		const saved = JSON.parse(readFileSync(join(dir, "canvases", "s", "canvas.pen"), "utf8"));
		assert.deepEqual(saved.children[0].metadata, { type: "decks.board", path: "boards/plan.html" }, "named from the canvas's own folder");
		assert.equal(readFileSync(join(dir, "canvases", "s", "boards", "plan.html"), "utf8"), '<link rel="stylesheet" href="../lib/board.css"><img src="../assets/a.png">', "lib/ and assets/ are served beside a canvas's boards, so the copy needs no rewrite");
		assert.equal(saved.children[1].fill.url, "files/a.png");
		assert.equal(readFileSync(join(dir, "canvases", "s", "files", "a.png"), "utf8"), "png");
		assert.equal(pens.copyOf("s", "boards/plan.html"), "canvases/s/boards/plan.html");
		assert.equal(pens.ownPath("s", "boards/plan.html"), "canvases/s/boards/plan.html", "asked for again, the same copy");
		// A reference the rules refuse, written by hand, is not drawn as a board and is written back as it was.
		writeFileSync(join(dir, "canvases", "s", "canvas.pen"), JSON.stringify({ version: "2.14", children: [{ type: "browser", id: "x", url: "../other/boards/a.html", width: 10, height: 10, metadata: { type: "decks.board", path: "../other/boards/a.html" } }] }));
		assert.deepEqual(pens.boards("s"), []);
		pens.edit("s", [{ op: "insert", node: { type: "note", id: "n" } }]);
		assert.equal(JSON.parse(readFileSync(join(dir, "canvases", "s", "canvas.pen"), "utf8")).children[0].metadata.path, "../other/boards/a.html");
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

/** A file card as `fileCard` (`@decks/canvas` card-frame.ts) makes one: its paper, edge and words in Decks colours. */
const fileCardNode = (id: string) => ({
	type: "frame", id, name: "notes.pdf", layout: "vertical", width: 320, fill: "$decks-surface", stroke: "$decks-line-subtle", strokeWidth: 1,
	metadata: { type: "decks.file", path: "files/notes.pdf" },
	children: [{ type: "frame", id: `${id}-label`, layout: "horizontal", width: "fill_container", children: [
		{ type: "text", id: `${id}-name`, content: "notes.pdf", fill: "$decks-text" },
		{ type: "text", id: `${id}-kind`, content: "PDF", fill: "$decks-text-muted" },
	] }],
});

test("an edit sent with no variables op (a file card dropped with no canvas showing it) has its Decks colours defined; one that has them adds nothing", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("drop");
		const { results } = pens.edit(name, [{ op: "insert", node: fileCardNode("card") as never, box: { x1: 0, y1: 0 } }]);
		assert.deepEqual(results, [{ op: "insert", id: "card" }], "the results answer the caller's ops, not the variables op");
		const doc = pens.get(name).doc;
		assert.deepEqual(Object.keys(doc.variables ?? {}).sort(), ["decks-line-subtle", "decks-surface", "decks-text", "decks-text-muted"]);
		assert.deepEqual(doc.themes, { mode: ["light", "dark"] });
		// A second card: the drawing has them, so nothing new.
		const before = JSON.stringify({ variables: doc.variables, themes: doc.themes });
		pens.edit(name, [{ op: "insert", node: fileCardNode("card-2") as never, box: { x1: 400, y1: 0 } }]);
		const again = pens.get(name).doc;
		assert.equal(JSON.stringify({ variables: again.variables, themes: again.themes }), before);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an edit whose own variables op already defines them (as the canvas sends one) is taken as it is", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("both");
		const own = { op: "variables", set: { "decks-fill-slate": { type: "color", value: [{ value: "#123456" }, { value: "#654321", theme: { mode: "dark" } }] } }, themes: { mode: ["light", "dark"] } };
		const { results } = pens.edit(name, [own as never, { op: "insert", node: { type: "rectangle", id: "r", fill: "$decks-fill-slate", width: 10, height: 10 } as never }]);
		assert.equal(results.length, 2);
		const doc = pens.get(name).doc;
		assert.deepEqual(doc.variables, { "decks-fill-slate": own.set["decks-fill-slate"] }, "the caller's own values, nothing added beside them");
		assert.deepEqual(doc.themes, { mode: ["light", "dark"] });
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a card grows to what its frame measured at its own width, follows it back down to the height it had before, and not when its height is the person's; the person's undo still works", () => {
	const dir = deck();
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("s");
		const path = `canvases/${name}/cards/c/index.html`;
		mkdirSync(join(dir, "canvases", name, "cards", "c"), { recursive: true });
		writeFileSync(join(dir, path), "<h1>Hi</h1>");
		pens.edit(name, [{ op: "insert", node: { type: "browser", id: "c", url: "cards/c/index.html", width: 1040, height: 240, metadata: { type: "decks.card", path } }, box: { x1: 0, y1: 0 } }]);
		pens.edit(name, [{ op: "insert", node: { type: "note", id: "n", content: "hi" }, box: { x1: 2000, y1: 0 } }], undefined, { undoable: true });
		const height = () => pens.get(name).doc.children.find((one) => one.id === "c")?.height;
		assert.equal(pens.raiseCard(name, path, { w: 1040, h: 599.2 }), true);
		assert.equal(height(), 600);
		assert.equal(pens.get(name).doc.children.find((one) => one.id === "c")?.metadata?.grownFrom, 240, "the height it had is kept as its floor");
		assert.equal(pens.raiseCard(name, path, { w: 1040, h: 597 }), false, "a pixel or two less is left: two browsers do not answer each other");
		assert.equal(pens.raiseCard(name, path, { w: 1040, h: 3000 }), true);
		assert.equal(pens.raiseCard(name, path, { w: 1040, h: 580 }), true, "a height read while it settled does not stay");
		assert.equal(height(), 580);
		assert.equal(pens.raiseCard(name, path, { w: 1040, h: 100 }), true);
		assert.equal(height(), 240, "and it goes no lower than it was before it grew");
		assert.equal(pens.get(name).doc.children.find((one) => one.id === "c")?.metadata?.grownFrom, undefined);
		pens.raiseCard(name, path, { w: 1040, h: 600 });
		assert.equal(pens.raiseCard(name, path, { w: 900, h: 900 }), false, "a reading at another width is not this card's");
		assert.equal(height(), 600);
		pens.step(name, "undo");
		assert.equal(pens.get(name).doc.children.some((one) => one.id === "n"), false, "the person's step is still theirs to undo");
		pens.edit(name, [{ op: "update", id: "c", set: { height: 300, metadata: { type: "decks.card", path, fixedHeight: true } } }]);
		assert.equal(pens.raiseCard(name, path, { w: 1040, h: 900 }), false, "a height the person chose is kept");
		assert.equal(height(), 300);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
