import assert from "node:assert/strict";
import { test } from "node:test";
import { todaysCall } from "./view-call.ts";

// A view call another caller made reaches this screen as today's call, in today's names.

const box = { x: 1, y: 2, w: 3, h: 4 };
const boxOf = (id: string) => (id === "note-1" ? box : undefined);

test("view.focus shows cards by path and drawn items by their box, on the canvas named", () => {
	const call = todaysCall({ call: "view.focus", by: "a1", canvas: "plan", args: { target: ["canvases/plan/cards/x/index.html", "note-1", "gone"], animate: true } }, boxOf);
	assert.equal(call?.op, "show");
	assert.equal(call?.agentId, "a1");
	assert.deepEqual(call?.args, { paths: ["canvases/plan/cards/x/index.html"], items: [{ id: "note-1", box }], stage: "plan", animate: true });
});

test("move, goto, reload and cursor keep their arguments in today's names; anything else is not a view call", () => {
	assert.deepEqual(todaysCall({ call: "view.move", args: { x: 1, y: 2, zoom: 1 } }, boxOf)?.args, { x: 1, y: 2, zoom: 1 });
	assert.deepEqual(todaysCall({ call: "view.goto", args: { canvas: "b" } }, boxOf)?.args, { stage: "b" });
	assert.deepEqual(todaysCall({ call: "view.reload", args: { card: "c" } }, boxOf)?.args, { path: "c" });
	assert.equal(todaysCall({ call: "view.cursor", args: { card: "c", at: { x: 1, y: 2 }, label: "Ada" } }, boxOf)?.op, "cursor");
	assert.equal(todaysCall({ call: "item.move" }, boxOf), undefined);
});

test("the person's own call is nobody's to defer", () => {
	assert.equal(todaysCall({ call: "view.move", by: "person", args: {} }, boxOf)?.agentId, "");
});

test("a card the page's list does not hold yet is framed by its box, read fresh", () => {
	const card = { x: 0, y: -3000, w: 480, h: 260 };
	const call = todaysCall({ call: "view.focus", args: { target: "canvases/a/cards/new/index.html" } }, boxOf, (path) => (path.endsWith("new/index.html") ? card : undefined));
	assert.deepEqual(call?.args, { paths: [], items: [{ id: "canvases/a/cards/new/index.html", box: card }] });
});
