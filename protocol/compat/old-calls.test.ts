import { test } from "node:test";
import assert from "node:assert/strict";
import { CALL_BY_NAME, callsFor } from "../calls/index.ts";
import { answerBack, cardCall, DROPPED, isOld, keyed, OLD_CALLS, turn, withEdit } from "./old-calls.ts";

// An old call becomes its new one; a card's call is old or new by its arguments' shape, and a card
// reaches only what a card may, on its own canvas.

const ok = (answer: ReturnType<typeof cardCall>) => {
	assert.ok(!("refusal" in answer), JSON.stringify(answer));
	return answer as { name: string; args: Record<string, unknown> };
};

test("every old name turns into a declared call, or is dropped with why", () => {
	for (const [old, , now] of OLD_CALLS) assert.ok(CALL_BY_NAME.has(now), `${old} -> ${now}`);
	for (const [old] of DROPPED) assert.ok("refusal" in turn(old, []));
	assert.ok(isOld("canvas.insert") && !isOld("item.insert"));
});

test("a list in the old order, options spread", () => {
	assert.deepEqual(keyed(["id", "..."], ["n1", { canvas: "a" }]), { id: "n1", canvas: "a" });
	const insert = ok(cardCall("canvas.insert", [{ type: "note" }, { beside: "n1" }]));
	assert.equal(insert.name, "item.insert");
	assert.deepEqual(insert.args, { item: { type: "note" }, beside: "n1" });
});

test("a name in both with another meaning is decided by shape, and an old one acts on an item", () => {
	const both = OLD_CALLS.filter(([old, , now]) => old !== now && CALL_BY_NAME.has(old)).map(([old]) => old);
	assert.deepEqual(both.sort(), ["canvas.copy", "canvas.delete", "canvas.update"]);
	assert.deepEqual(ok(cardCall("canvas.delete", ["n1"])).name, "item.delete");
	assert.deepEqual(ok(cardCall("canvas.delete", ["n1"])).args, { id: "n1" });
	assert.equal(ok(cardCall("canvas.copy", ["n1", { as: "n2" }])).name, "item.copy");
	assert.equal(ok(cardCall("canvas.update", ["n1", { set: { fill: "red" } }])).name, "item.update");
	assert.deepEqual(ok(cardCall("canvas.update", ["n1", { set: { fill: "red" } }])).args, { id: "n1", set: { fill: "red" } });
});

test("a card cannot delete a canvas, make an agent, or reach another canvas, by either shape", () => {
	assert.ok("refusal" in cardCall("canvas.delete", { canvas: "a" }));
	assert.ok("refusal" in cardCall("agent.create", { name: "x" }));
	assert.ok("refusal" in cardCall("canvas.remove", ["a"]));
	assert.ok("refusal" in cardCall("canvas.insert", [{ type: "note" }, { canvas: "other" }], "mine"));
	assert.ok("refusal" in cardCall("item.insert", { item: { type: "note" }, canvas: "other" }, "mine"));
	assert.equal(ok(cardCall("item.insert", { item: { type: "note" } }, "mine")).name, "item.insert");
});

test("the new shape passes as it is; an old answer comes back in the old shape", () => {
	const fresh = cardCall("item.move", { id: "n1", at: { x: 1, y: 2 } }) as { args: unknown; back: (v: unknown) => unknown };
	assert.deepEqual(fresh.args, { id: "n1", at: { x: 1, y: 2 } });
	assert.deepEqual(fresh.back([1]), [1]);
	const old = cardCall("canvas.read", []) as { name: string; back: (v: unknown) => unknown };
	assert.equal(old.name, "item.list");
	assert.deepEqual(old.back([{ id: "a" }]), { items: [{ id: "a" }] });
	assert.deepEqual(answerBack("canvas.space", { x: 1, y: 2 }), { x1: 1, y1: 2 });
});

test("old card shapes carry no date; a program's call stops on the day it is given", () => {
	assert.ok(!("refusal" in turn("canvas.insert", [{ type: "note" }])));
	assert.ok("refusal" in turn("canvas.insert", [{ type: "note" }], { day: "2027-05-14", now: Date.parse("2027-06-01") }));
	assert.deepEqual(withEdit({ name: "item.batch", args: { ops: [] } }, "e1").args, { ops: [], edit: "e1" });
});

test("an old card's agent.send and agent.queue name the agent and spread the message; boards are cards", () => {
	const send = ok(cardCall("agent.send", ["Mason", { task: "Option A", cards: ["c/index.html"] }]));
	assert.deepEqual(send, { ...send, name: "agent.send" });
	assert.deepEqual(send.args, { agent: "Mason", task: "Option A", cards: ["c/index.html"] });
	assert.deepEqual(turn("agent.queue", ["Mason", { task: "go", boards: ["b.html"] }]), { name: "agent.queue", args: { agent: "Mason", task: "go", cards: ["b.html"] }, old: ["agent.queue", "agents", "agent.queue", ["name", "work"]] });
	assert.deepEqual(turn("agent.get", ["Mason"]), { name: "agent.get", args: { agent: "Mason" }, old: ["agent.get", "agents", "agent.get", ["name"]] });
});

test("a card may queue, read its agent and inbox, and send the person's screen to another canvas; not make an agent", () => {
	assert.equal(ok(cardCall("agent.queue", ["Mason", { task: "go", boards: ["b.html"] }], "mine")).name, "agent.queue");
	assert.equal(ok(cardCall("agent.me", [], "mine")).name, "agent.me");
	assert.equal(ok(cardCall("agent.inbox", [], "mine")).name, "agent.inbox");
	assert.equal(ok(cardCall("view.goto", ["other"], "mine")).name, "view.goto");
	assert.ok("refusal" in cardCall("agent.create", ["x"], "mine"));
});

/** Every call a card could make before the rewrite: packages/api/src/verbs.ts at rewrite-stop-3, its card column. */
const CARD_CALLS_BEFORE = [
	"canvas.read", "canvas.space", "canvas.insert", "canvas.update", "canvas.replace", "canvas.delete", "canvas.move", "canvas.copy",
	"canvas.clip", "canvas.paste", "canvas.variables", "canvas.batch", "canvas.step", "canvas.fit", "canvas.save", "canvas.screenshot",
	"canvas.export", "canvas.rename", "card.create", "card.get", "card.canvases", "card.url", "frame.create", "file.url", "agent.me",
	"here", "agent.inbox", "agent.list", "agent.get", "agent.send", "agent.queue", "agent.create", "view.goto", "view.focus",
	"view.camera", "view.move", "view.viewport", "view.cursor", "view.reload", "now",
];

test("a card may make exactly the calls it could before, by their new names, but agent.create", () => {
	const now = new Map(OLD_CALLS.map(([old, , name]) => [old, name]));
	const before = new Set(CARD_CALLS_BEFORE.map((old) => now.get(old) ?? old));
	before.add("item.get"); // canvas.read with of, one item and what is in it
	const card = callsFor("card");
	assert.deepEqual([...before].filter((name) => !card.has(name)), ["agent.create"]);
	assert.deepEqual([...card].filter((name) => !before.has(name)), []);
});

test("the shape the card called in decides, not its arguments, and an old card gets its old answer", () => {
	const move = cardCall("view.move", [{ x: 1, y: 2, zoom: 1 }], "mine", "old") as { name: string; back: (v: unknown) => Record<string, unknown> };
	const view = { canvas: "mine", camera: { x: 1, y: 2, zoom: 1 }, moved: true };
	assert.deepEqual(move.back(view), { ...view, x: 1, y: 2, zoom: 1 });
	const focus = cardCall("view.focus", ["n1"], "mine", "old") as { back: (v: unknown) => Record<string, unknown> };
	assert.equal(focus.back({ canvas: "mine" }).target, "n1");
	const reload = cardCall("view.reload", [{}], "mine", "old") as { back: (v: unknown) => unknown };
	assert.deepEqual(reload.back(1), { reloaded: 1 });
	const fresh = cardCall("view.reload", {}, "mine", "new") as { back: (v: unknown) => unknown };
	assert.equal(fresh.back(1), 1);
});

