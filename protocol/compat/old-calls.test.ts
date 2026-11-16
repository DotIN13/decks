import { test } from "node:test";
import assert from "node:assert/strict";
import { CALL_BY_NAME } from "../calls/index.ts";
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
