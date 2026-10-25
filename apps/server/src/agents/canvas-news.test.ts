import { test } from "node:test";
import assert from "node:assert/strict";
import type { PenDocument, PenNode } from "@decks/pen";
import { canvasNews, type ChangeRecord } from "./canvas-news.ts";

const doc = (children: PenNode[]): PenDocument => ({ version: "2.6", children }) as PenDocument;
const note = (id: string, content: string, x = 0, y = 0): PenNode => ({ id, type: "note", content, x, y }) as PenNode;
const ink = (id: string, x: number, y: number): PenNode => ({ id, type: "path", name: "Ink", x, y, width: 10, height: 10, metadata: { type: "decks.ink" } }) as PenNode;
const names = (id: string) => ({ loom: "Loom" })[id] ?? "another agent";
const news = (before: PenDocument, after: PenDocument, records: ChangeRecord[], self = "me") => canvasNews("Plan", "plan", before, after, records, self, names);

test("a person's edit between two messages is told, with who made it and the canvas", () => {
	const lines = news(doc([note("a", "Ship it")]), doc([note("a", "Ship it on Friday")]), [{ rev: 2, by: { kind: "person" }, ids: ["a"] }]);
	assert.equal(lines[0], '[Since your last message, on "Plan" (plan):');
	assert.match(lines[1]!, /^ you rewrote the note "Ship it on Friday" \(a\)$/);
	assert.match(lines.at(-1)!, /decks canvas read --canvas plan --of <id>/);
});

test("the agent's own edits are left out, another agent's are named", () => {
	const before = doc([note("a", "one")]);
	const after = doc([note("a", "one", 50, 0), note("b", "two")]);
	assert.deepEqual(news(before, after, [{ rev: 2, by: { kind: "agent", id: "me" }, ids: ["a", "b"] }]), []);
	const lines = news(before, after, [{ rev: 2, by: { kind: "agent", id: "me" }, ids: ["a"] }, { rev: 3, by: { kind: "agent", id: "loom" }, ids: ["b"] }]);
	assert.deepEqual(lines.slice(1, -1), [' Loom added the note "two" (b)']);
});

test("strokes are counted, not listed, and a file edit says so", () => {
	const strokes = Array.from({ length: 14 }, (_, i) => ink(`s${i}`, 100 + i * 10, 200));
	const lines = news(doc([]), doc(strokes), [{ rev: 2, by: { kind: "file" }, ids: strokes.map((s) => s.id) }]);
	assert.equal(lines.length, 3);
	assert.match(lines[1]!, /^ a file edit added 14 ink strokes around \(170, 205\)$/);
});

test("what is inside something added or deleted is not told again", () => {
	const frame = { id: "f", type: "frame", name: "Sketches", x: 0, y: 0, children: [note("n1", "inside")] } as PenNode;
	const lines = news(doc([frame]), doc([]), [{ rev: 2, by: { kind: "person" }, ids: ["f", "n1"] }]);
	assert.deepEqual(lines.slice(1, -1), [' you deleted the frame "Sketches" (f)']);
});

test("moves and resizes say by how much", () => {
	const board = (x: number, w: number) => ({ id: "b", type: "browser", x, y: 0, width: w, height: 400, metadata: { type: "decks.board", path: "boards/plan.html" } }) as PenNode;
	const lines = news(doc([board(0, 800)]), doc([board(380, 1000)]), [{ rev: 2, by: { kind: "person" }, ids: ["b"] }]);
	assert.deepEqual(lines.slice(1, -1), [" you moved the board plan by (380, 0)", " you resized the board plan to 1000 × 400"]);
});

test("a long list stops at eight lines and says how many more", () => {
	const notes = Array.from({ length: 12 }, (_, i) => note(`n${i}`, `note ${i}`));
	const lines = news(doc([]), doc(notes), [{ rev: 2, by: { kind: "person" }, ids: notes.map((n) => n.id) }]);
	assert.equal(lines.length, 1 + 8 + 1 + 1);
	assert.equal(lines[9], " and 4 more changes");
});

test("nothing changed by anyone is nothing to say", () => {
	assert.deepEqual(news(doc([note("a", "x")]), doc([note("a", "x")]), []), []);
});
