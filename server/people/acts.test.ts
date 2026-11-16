import { test } from "node:test";
import assert from "node:assert/strict";
import { actOf, type Done } from "./acts.ts";

// Rule 16: an agent's change that worked is an act, on the cards by path and the items by id.

const done = (over: Partial<Done>): Done => ({ name: "item.insert", effect: "change", args: {}, who: "agent", ok: true, ...over });
const card = "canvases/plan/cards/q3/index.html";

test("only an agent's change that worked is an act", () => {
	assert.equal(actOf(done({ who: "person", args: { card } })), undefined);
	assert.equal(actOf(done({ effect: "read", args: { card } })), undefined);
	assert.equal(actOf(done({ ok: false, args: { card } })), undefined);
});

test("a card is named by its path, or by a file of it; its canvas comes with it", () => {
	assert.deepEqual(actOf(done({ name: "card.fit", args: { card } })), { what: "fit", canvas: "plan", ids: [card] });
	assert.deepEqual(actOf(done({ name: "file.write", args: { path: "canvases/plan/cards/q3/chart.js" } })), { what: "write", canvas: "plan", ids: [card] });
	assert.equal(actOf(done({ name: "file.write", args: { path: "assets/logo.png" } })), undefined);
});

test("items are named by id, from the answer and the ops; an inserted card by its path", () => {
	const inserted = actOf(done({ value: { type: "card", id: "c1", card } }), "plan");
	assert.deepEqual(inserted, { what: "insert", canvas: "plan", ids: [card] });
	const batch = actOf(done({ name: "item.batch", args: { canvas: "plan", ops: [{ op: "delete", id: "n1" }, { op: "update", id: "n2" }] }, value: [] }));
	assert.deepEqual(batch, { what: "batch", canvas: "plan", ids: ["n1", "n2"] });
});
