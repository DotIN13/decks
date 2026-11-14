import assert from "node:assert/strict";
import { test } from "node:test";
import { agentsHere, pagesInPlay, penOnScreen } from "./model.ts";

// The shell's rules: who shares the canvas on screen, and which cards are on it.

const chat = (id: string) => ({ id }) as never;

test("the agents here share the focused one's canvas; with no canvas, only the focused one", () => {
	const canvas: Record<string, string> = { a: "plan", b: "plan", c: "other" };
	assert.deepEqual(agentsHere([chat("a"), chat("b"), chat("c")], (id) => canvas[id], "a").map((one: { id: string }) => one.id), ["a", "b"]);
	assert.deepEqual(agentsHere([chat("a"), chat("d")], () => undefined, "d").map((one: { id: string }) => one.id), ["d"]);
});

test("the pages in play are copies of the store's, in the store's order", () => {
	const pages = [{ path: "x", title: "X" }, { path: "y", title: "Y" }] as never[];
	const shown = pagesInPlay(pages, ["y"]);
	assert.deepEqual(shown.map((one: { path: string }) => one.path), ["y"]);
	assert.notEqual(shown[0], pages[1]);
});

test("the pen on screen names its last writer when it is known", () => {
	const pen = { doc: {}, base: "/b", stage: "plan", by: "a" };
	assert.deepEqual(penOnScreen(pen, () => ({ name: "Ada", color: "#f00" }))?.writer, { name: "Ada", color: "#f00" });
	assert.equal(penOnScreen(undefined, () => undefined), undefined);
});
