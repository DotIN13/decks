import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";
import { placeBy, toItem } from "./canvas.ts";

/**
 * The calls of the SDK redesign, end to end over `/api/v1`: a board as a canvas item, beside and
 * below, batch's all or nothing, `here()`, the old names' notes, and
 * `send` against `queue`.
 */

const board = (title: string, w = 900, h = 400) =>
	`<!doctype html><html><head><title>${title}</title><meta name="board" content='{"w":${w},"h":${h},"bg":"grid"}' /></head><body class="board"></body></html>`;

async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-redesign-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(join(deck, "boards", "a.html"), board("Revenue is up"));
	writeFileSync(join(deck, "boards", "b.html"), board("Costs are flat", 600, 300));
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
	const agent = app.agents.focused();
	// Who is calling is a token (`auth/guard.ts`): the agent's own, as its shell has it.
	const as = (id: string) => ({ authorization: `Bearer ${app.bridge.issue(id)}` });
	type Answer = { ok: boolean; value?: any; error?: string; notes: string[] };
	const call = async (verb: string, args: unknown[] = [], headers: Record<string, string> = as(agent.id)): Promise<Answer> => {
		const response = await fetch(`${base}/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
		return (await response.json()) as Answer;
	};
	const must = async (verb: string, args: unknown[] = [], headers?: Record<string, string>) => {
		const answer = await call(verb, args, headers);
		assert.ok(answer.ok, `${verb}: ${answer.error}`);
		return answer;
	};
	return {
		app,
		deck,
		agent,
		as,
		call,
		must,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("beside and below sit 160 px clear, tops or lefts aligned", () => {
	assert.deepEqual(placeBy({ x: 100, y: 50, w: 900, h: 400 }, "beside"), { x1: 1160, y1: 50 });
	assert.deepEqual(placeBy({ x: 100, y: 50, w: 900, h: 400 }, "below"), { x1: 100, y1: 610 });
});

test("a pen browser item tagged decks.board reads as a board item, and other items as they are", () => {
	const item = toItem({ type: "browser", id: "a", name: "Revenue is up", url: "../../boards/a.html", width: 900, height: 400, metadata: { type: "decks.board", path: "boards/a.html" }, box: { x1: 0, y1: 0, x2: 900, y2: 400 } });
	assert.deepEqual(item, { type: "board", id: "a", width: 900, height: 400, box: { x1: 0, y1: 0, x2: 900, y2: 400 }, board: "boards/a.html", title: "Revenue is up" });
	assert.deepEqual(toItem({ type: "note", id: "n", content: "hi" }), { type: "note", id: "n", content: "hi" });
	// A browser item that is not a deck board stays pen's own.
	assert.equal(toItem({ type: "browser", id: "w", url: "https://example.com" }).type, "browser");
});

test("a board goes on a canvas as an item, is written as pen's browser item, and is named by its path", async () => {
	const { app, deck, must, call, cleanup } = await open();
	try {
		const here = (await must("here")).value;
		assert.ok(here.name, "an agent always has a canvas here");
		const put = (await must("canvas.insert", [{ type: "board", board: "boards/a.html" }, { at: { x1: 0, y1: 0 } }])).value;
		assert.equal(put.type, "card");
		// A board from the library is copied into the canvas as a card, and is the canvas's copy from then on (`stage/copy-in.ts`).
		const a = `canvases/${here.name}/cards/a/index.html`;
		const b = `canvases/${here.name}/cards/b/index.html`;
		assert.equal(put.card, a);
		assert.ok(app.deck.board("boards/a.html"), "the library keeps its own");
		assert.deepEqual(put.box, { x1: 0, y1: 0, x2: 900, y2: 400 });
		const file = JSON.parse(readFileSync(join(deck, "canvases", here.name, "canvas.pen"), "utf8"));
		const node = file.children.find((one: { id: string }) => one.id === put.id);
		assert.equal(node.type, "browser");
		assert.deepEqual(node.metadata, { type: "decks.card", path: "cards/a/index.html" });

		const next = (await must("canvas.insert", [{ type: "board", board: "boards/b.html" }, { beside: "boards/a.html" }])).value;
		assert.deepEqual(next.box, { x1: 1060, y1: 0, x2: 1660, y2: 300 }, "beside a board named by its path");
		const note = (await must("canvas.insert", [{ type: "note", id: "n1", content: "Why?" }, { below: "boards/a.html" }])).value;
		assert.equal(note.box.x1, 0);
		assert.equal(note.box.y1, 560, "below works for a note too");

		const moved = (await must("canvas.move", ["boards/b.html", { below: "n1" }])).value;
		assert.equal(moved.box.x1, 0, "and a board below a note");
		const sized = (await must("canvas.update", ["boards/a.html", { size: { w: 1000 } }])).value;
		assert.equal(sized.box.x2 - sized.box.x1, 1000);

		const again = await call("canvas.insert", [{ type: "board", board: "boards/a.html" }]);
		assert.equal(again.ok, false);
		assert.match(again.error!, /already on this canvas/);
		const missing = await call("canvas.insert", [{ type: "board", board: "boards/nope.html" }]);
		assert.match(missing.error!, /no board boards\/nope\.html/);

		const read = (await must("canvas.read")).value;
		assert.equal(read.canvas, here.name);
		assert.deepEqual(read.items.filter((one: { type: string }) => one.type === "card").map((one: { card: string }) => one.card).sort(), [a, b]);

		const gone = (await must("canvas.delete", [b])).value;
		assert.equal(gone.deleted, b);
		assert.ok(app.deck.board(b), "a board's file stays in the deck");
		assert.deepEqual((await must("board.canvases", [a])).value.map((one: { canvas: string }) => one.canvas), [here.name], "a canvas's board is on that canvas, and only there");
		assert.deepEqual((await must("board.canvases", ["boards/a.html"])).value.map((one: { board: string }) => one.board), [a], "the library's board says where it was copied");
		assert.deepEqual((await must("board.canvases", [b])).value, []);
	} finally {
		cleanup();
	}
});

test("a batch is all or nothing, and a later op can be beside what an earlier one made", async () => {
	const { must, call, cleanup } = await open();
	try {
		const made = (await must("canvas.batch", [[
			{ op: "insert", item: { type: "board", board: "boards/a.html" }, at: { x1: 0, y1: 0 } },
			{ op: "insert", item: { type: "note", id: "why", content: "Why?" }, beside: "boards/a.html" },
		]])).value;
		assert.equal(made.length, 2);
		assert.equal(made[1].box.x1, 1060);
		const before = (await must("canvas.read")).value.items.length;
		const failed = await call("canvas.batch", [[{ op: "insert", item: { type: "note", id: "n2", content: "x" }, at: { x1: 0, y1: 900 } }, { op: "delete", id: "nothing-here" }]]);
		assert.equal(failed.ok, false);
		assert.match(failed.error!, /Op 2 \(delete\)/);
		assert.match(failed.error!, /Nothing was changed/);
		assert.equal((await must("canvas.read")).value.items.length, before, "the first op did not land either");
	} finally {
		cleanup();
	}
});

test("calls are stateless: a canvas named is acted on, and nobody moves to it", async () => {
	const { app, agent, must, call, cleanup } = await open();
	try {
		const home = (await must("here")).value.name;
		const other = (await must("canvas.create", ["Launch plan"])).value;
		assert.equal(other.title, "Launch plan");
		assert.notEqual(other.name, home);
		await must("canvas.insert", [{ type: "board", board: "boards/a.html" }, { canvas: "Launch plan", at: { x1: 0, y1: 0 } }]);
		assert.equal((await must("here")).value.name, home, "making and writing a canvas does not move you to it");
		assert.deepEqual((await must("canvas.read", [{ canvas: other.name }])).value.items.map((one: { card?: string }) => one.card), [`canvases/${other.name}/cards/a/index.html`]);
		assert.deepEqual((await must("canvas.read")).value.items, [], "your own canvas is untouched");
		const unknown = await call("canvas.read", [{ canvas: "no such canvas" }]);
		assert.match(unknown.error!, /No canvas is called "no such canvas"/);

		// The home canvas moves only when asked.
		const updated = (await must("agent.update", [{ canvas: other.name }])).value;
		assert.equal(updated.canvas, other.name);
		assert.equal((await must("here")).value.name, other.name);
		assert.equal(agent.stageName(), other.name);
		// The person's here is the canvas on screen they name.
		const person = { authorization: `Bearer ${app.tokens.issue({ kind: "person" }).token}`, "x-decks-agent": agent.id, "x-decks-stage": home };
		assert.equal((await must("here", [], person)).value.name, home);
	} finally {
		cleanup();
	}
});

test("board.create, an alias of card.create, writes a card and places nothing", async () => {
	const { must, cleanup } = await open();
	try {
		const made = (await must("board.create", [{ title: "Churn halved" }])).value;
		const home = (await must("here")).value.name;
		assert.equal(made.path, `canvases/${home}/cards/churn-halved/index.html`, "a card is made in the caller's canvas's own folder");
		const named = (await must("canvas.create", ["Elsewhere"])).value.name;
		assert.match((await must("board.create", [{ title: "Over there", canvas: named }])).value.path, new RegExp(`^canvases/${named}/cards/over-there/index\\.html$`), "or in the canvas it names");
		assert.equal(made.title, "Churn halved");
		assert.deepEqual((await must("board.canvases", [made.path])).value, []);
		assert.ok((await must("board.list")).value.some((one: { path: string }) => one.path === made.path));
		assert.equal((await must("board.get", [made.path])).value.title, "Churn halved");
	} finally {
		cleanup();
	}
});

test("an old name still answers as it did, and says its new call", async () => {
	const { must, cleanup } = await open();
	try {
		const listed = await must("boards");
		assert.ok(Array.isArray(listed.value));
		assert.ok(listed.notes.some((note) => /boards is an old name, removed on 2026-11-30: use decks\.canvas\.read/.test(note)), listed.notes.join("\n"));
		const read = await must("pen.read");
		assert.ok(Array.isArray(read.value.children), "pen.read keeps its old shape");
		assert.ok(read.notes.some((note) => /decks\.canvas\.read/.test(note)));
		const fresh = await must("canvas.read");
		assert.ok(!fresh.notes.some((note) => /old name/.test(note)), "a new call carries no such note");
		// A canvas says its cards, and its boards (the old name) beside them, until 2026-11-30.
		const here = (await must("here")).value;
		assert.equal(typeof here.cards, "number");
		assert.equal(here.boards, here.cards);
	} finally {
		cleanup();
	}
});

test("queue waits for the turn; send to an idle agent starts one; inbox lists the hand-offs", async () => {
	const { app, agent, as, must, cleanup } = await open();
	try {
		const other = app.agents.create({ name: "Rune" });
		const queued = (await must("agent.queue", ["Rune", { task: "Read the plan", boards: ["boards/a.html"] }])).value;
		assert.deepEqual(queued, { queued: true, position: 1 });
		const theirs = (await must("agent.inbox", [], as(other.id))).value;
		assert.equal(theirs.length, 1);
		assert.equal(theirs[0].task, "Read the plan");
		assert.equal(theirs[0].from, agent.name);
		assert.deepEqual(theirs[0].cards, ["boards/a.html"]);
		assert.deepEqual(theirs[0].boards, ["boards/a.html"], "the old field, until 2026-11-30");
		// `cards` is the hand-off's name for what it names; `boards` is still taken.
		await must("agent.queue", ["Rune", { task: "And this one", cards: ["boards/b.html"] }]);
		assert.deepEqual((await must("agent.inbox", [], as(other.id))).value[1].cards, ["boards/b.html"]);

		const seen: string[] = [];
		(other as unknown as { prompt: (text: string) => Promise<void> }).prompt = async (text: string) => {
			seen.push(text);
		};
		const sent = (await must("agent.send", ["Rune", { task: "Stop and look at a.html" }])).value;
		assert.deepEqual([sent.delivered, sent.turn], [true, "new"], "an idle agent starts a turn on it");
		assert.equal(seen.length, 1);
		assert.match(seen[0]!, /Stop and look at a\.html/);

		const got = (await must("agent.get", ["Rune"])).value;
		assert.equal(got.name, "Rune");
		assert.equal(got.kind, "pi");
		assert.ok((await must("agent.list")).value.some((one: { name: string }) => one.name === "Rune"));
	} finally {
		cleanup();
	}
});

test("work the person sends or queues is theirs: not signed by the agent in focus, and no report owed", async () => {
	const { app, agent, as, must, cleanup } = await open();
	try {
		const other = app.agents.create({ name: "Rune" });
		app.agents.focus(agent.id);
		const person = { authorization: `Bearer ${app.tokens.issue({ kind: "person" }).token}`, "x-decks-agent": agent.id };
		const seen: string[] = [];
		(other as unknown as { prompt: (text: string) => Promise<void> }).prompt = async (text: string) => {
			seen.push(text);
		};
		const sent = (await must("agent.send", ["Rune", { task: "Draw the coffee canvas" }], person)).value;
		assert.equal(sent.delivered, true);
		assert.match(seen[0]!, /^Draw the coffee canvas/, "it reads as the person's own message");
		assert.doesNotMatch(seen[0]!, new RegExp(`${agent.name} sent you|parent agent`));

		await must("agent.queue", ["Rune", { task: "Then the tea one", reply: true }], person);
		const theirs = (await must("agent.inbox", [], as(other.id))).value;
		assert.equal(theirs[0].from, "You");
		assert.equal(theirs[0].reply, undefined, "nobody waits on a report");
	} finally {
		cleanup();
	}
});

test("clearing your tags at the end of a turn is answered without a request to set them", async () => {
	const { must, cleanup } = await open();
	try {
		await must("agent.update", [{ name: "Linnet", avatar: { emoji: "🐦" }, workspace: "decks", tags: ["drawing"] }]);
		const cleared = await must("agent.update", [{ tags: [] }]);
		assert.deepEqual(cleared.value.tags, []);
		assert.ok(!cleared.notes.some((note) => /tags are empty/.test(note)), cleared.notes.join(" | "));
	} finally {
		cleanup();
	}
});

test("an arrow joined at both ends goes between them, with no note to say where", async () => {
	const { must, cleanup } = await open();
	try {
		// A placed board is copied into the canvas and has an id there; an arrow joins those ids.
		const a = (await must("canvas.insert", [{ type: "board", board: "boards/a.html" }, { at: { x1: 0, y1: 0 } }])).value.id;
		const b = (await must("canvas.insert", [{ type: "board", board: "boards/b.html" }, { beside: a }])).value.id;
		const arrow = await must("canvas.insert", [{ type: "path", id: "a-to-b", stroke: "#888", strokeWidth: 4, metadata: { type: "decks.arrow", from: { item: a, side: "right" }, to: { item: b, side: "left" } } }]);
		assert.ok(!arrow.notes.some((note) => /say where/.test(note)), arrow.notes.join(" | "));
		assert.ok(arrow.value.box.x1 >= 880 && arrow.value.box.x2 <= 1080, `between the boards: ${JSON.stringify(arrow.value.box)}`);
		const note = await must("canvas.insert", [{ type: "note", content: "Loose" }]);
		assert.ok(note.notes.some((one) => /say where/.test(one)), "an item with no place still hears it");
	} finally {
		cleanup();
	}
});

test("the old names map onto the new calls: open moves the home canvas, report claims, url and resolve are the new addresses", async () => {
	const { agent, must, cleanup } = await open();
	try {
		const other = (await must("canvas.create", ["Elsewhere"])).value.name;
		const opened = await must("open", [other]);
		assert.equal(opened.value.stage, other);
		assert.equal((await must("here")).value.name, other, "open is agent.update({ canvas })");
		assert.ok(opened.notes.some((note) => /agent\.update\(\{ canvas \}\), then decks\.view\.goto/.test(note)));
		const reported = await must("report", ["boards/a.html"]);
		assert.deepEqual(reported.value, { reported: ["boards/a.html"] });
		assert.ok(reported.notes.some((note) => /decks\.agent\.claim/.test(note)));
		assert.equal((await must("url", ["boards/a.html"])).value, (await must("board.url", ["boards/a.html"])).value);
		const made = await must("newStage", ["Third"]);
		assert.equal((await must("here")).value.name, made.value.stage, "newStage still moves you, as it always did");
		assert.ok(made.notes.some((note) => /decks\.canvas\.create/.test(note)));
		void agent;
	} finally {
		cleanup();
	}
});

test("the item calls take a frame file instead of a canvas, and its change shows on the canvas placing it", async () => {
	const { deck, must, call, cleanup } = await open();
	try {
		const made = (await must("frame.create", ["frames/card", { type: "frame", width: 200, height: "fit_content", layout: "vertical", children: [] }])).value;
		const home = (await must("here")).value.name;
		// Made in the caller's canvas's own frames/, and placed there by its ref.
		assert.deepEqual([made.file, made.ref], [`canvases/${home}/frames/card.pen`, "frames/card"]);
		await must("canvas.insert", [{ type: "ref", id: "c", ref: "frames/card" }, { canvas: home, at: { x1: 0, y1: 0 } }]);
		const rev = async () => (await must("canvas.read", [{ canvas: home }])).value.rev as number;
		const before = await rev();

		const read = (await must("canvas.read", [{ frame: "frames/card" }])).value;
		assert.equal(read.frame, `canvases/${home}/frames/card.pen`, "frames/card is the caller's canvas's own");
		assert.deepEqual(read.items.map((one: { id: string }) => one.id), [made.id]);
		// The same item shapes and answers as on a canvas.
		const note = (await must("canvas.insert", [{ type: "text", id: "t1", content: "Hello" }, { frame: "frames/card", parent: made.id }])).value;
		assert.equal(note.id, "t1");
		assert.ok(note.box, "an inserted item answers with its box");
		await must("canvas.update", ["t1", { set: { content: "Hello there" } }, { frame: "frames/card" }]);
		const batch = (await must("canvas.batch", [[{ op: "insert", item: { type: "text", id: "t2", content: "Two" }, parent: made.id }, { op: "delete", id: "t1" }], { frame: "frames/card" }])).value;
		assert.deepEqual(batch.map((one: { id: string; type: string }) => [one.id, one.type]), [["t2", "text"], ["t1", "deleted"]]);
		await must("canvas.variables", [{ ink: { type: "color", value: "#123456" } }, { frame: "frames/card" }]);
		const file = JSON.parse(readFileSync(join(deck, "canvases", home, "frames", "card.pen"), "utf8"));
		assert.deepEqual(file.children[0].children.map((one: { id: string }) => one.id), ["t2"], "the frame's own file is what changed");
		assert.equal(file.variables.ink.value, "#123456");
		assert.ok((await rev()) > before, "the canvas placing the frame is sent it again");
		// Nothing on the canvas was written: it still holds only the ref.
		assert.deepEqual((await must("canvas.read", [{ canvas: home }])).value.items.map((one: { type: string }) => one.type), ["ref"]);

		const both = await call("canvas.read", [{ canvas: home, frame: "frames/card" }]);
		assert.ok(!both.ok && /canvas or a frame, not both/.test(both.error ?? ""), both.error);
		const board = await call("canvas.insert", [{ type: "board", board: "boards/a.html" }, { frame: "frames/card" }]);
		assert.ok(!board.ok && /not boards/.test(board.error ?? ""), board.error);
		const notFrame = await call("canvas.read", [{ frame: `canvases/${home}/canvas.pen` }]);
		assert.ok(!notFrame.ok && /not a frame/.test(notFrame.error ?? ""), notFrame.error);
		const missing = await call("canvas.read", [{ frame: "frames/nope" }]);
		assert.ok(!missing.ok && /There is no frames\/nope/.test(missing.error ?? ""), missing.error);
	} finally {
		cleanup();
	}
});
