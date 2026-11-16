import assert from "node:assert/strict";
import { test } from "node:test";
import { cardMeta, orderRows, since } from "./model.ts";

// The canvas manager's rules: the wall's order, a card's facts, how long ago.

const row = (name: string, title: string, changedAt?: number) => ({ canvas: { name, title, cards: 1, rev: 0, agents: [], words: "", ...(changedAt ? { changedAt } : {}) }, hit: true });

test("recent puts the canvas you are on first, then the latest changed; A-Z sorts by name", () => {
	const rows = [row("a", "Alpha", 10), row("b", "Beta", 30), row("c", "Gamma", 20)];
	assert.deepEqual(orderRows(rows, "recent", "a").map((one) => one.canvas.name), ["a", "b", "c"]);
	assert.deepEqual(orderRows(rows, "az", undefined).map((one) => one.canvas.title), ["Alpha", "Beta", "Gamma"]);
	assert.deepEqual(orderRows([{ ...row("x", "X"), hit: false }], "az", undefined), []);
});

test("how long ago reads in minutes, hours, yesterday and days", () => {
	const now = 10 * 86_400_000;
	assert.equal(since(undefined), undefined);
	assert.equal(since(now - 30_000, now), "just now");
	assert.equal(since(now - 5 * 60_000, now), "5 min ago");
	assert.equal(since(now - 3 * 3_600_000, now), "3 h ago");
	assert.equal(since(now - 86_400_000, now), "yesterday");
	assert.equal(since(now - 3 * 86_400_000, now), "3 days ago");
});

test("a card's facts say who shared it and how many cards it has", () => {
	const canvas = { ...row("s", "S").canvas, cards: 0, shared: { owner: "Ada", role: "view" as const } };
	assert.equal(cardMeta(canvas), "Shared by Ada, to view · Empty");
	assert.equal(cardMeta({ ...row("t", "T").canvas, cards: 2 }), "2 cards");
});
