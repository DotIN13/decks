import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "@decks/protocol";
import type { PenDocument } from "@decks/pen";
import type { FramePage } from "../protocol.ts";
import { createCardPlacer } from "./boot.ts";

const card = (name: string, x = 0) => ({ type: "browser", id: name, x, y: 0, width: 400, height: 300, metadata: { type: "decks.card", path: `cards/${name}/index.html` } });
const drawing = (...cards: ReturnType<typeof card>[]) => ({ version: "2.6", children: cards }) as unknown as PenDocument;
const record = (name: string): Page => ({ path: `cards/${name}/index.html`, title: name, x: 0, y: 0, w: 400, h: 300, rev: 1, inContext: [] }) as Page;
const paths = (list: FramePage[]) => list.map((page) => page.path.split("/")[1]).sort();

/** A frame's card list and drawing, and a host whose reads answer when the test says. */
function frame(doc: PenDocument, list: Page[]) {
	let drawn = doc;
	let pages: FramePage[] = list.map((one) => ({ ...one, trust: "own" }));
	const answers: Array<(cards: Page[]) => void> = [];
	const placer = createCardPlacer({
		drawn: () => drawn,
		pages: () => pages,
		setPages: (next) => (pages = next),
		own: () => "own",
		read: () => new Promise((resolve) => answers.push((cards) => resolve({ cards }))),
	});
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	return { placer, answers, settle, pages: () => pages, draw: (next: PenDocument) => (drawn = next) };
}

test("a card the drawing no longer has leaves the list at once, with no read", () => {
	const f = frame(drawing(card("deep"), card("notes")), [record("deep"), record("notes")]);
	f.draw(drawing(card("notes")));
	f.placer.place();
	assert.deepEqual(paths(f.pages()), ["notes"]);
	assert.equal(f.placer.reads(), 0);
});

test("a card the drawing has that the list lacks is read again from the host", async () => {
	const f = frame(drawing(card("notes")), [record("notes")]);
	f.draw(drawing(card("notes"), card("new", 500)));
	f.placer.place();
	assert.equal(f.placer.reads(), 1);
	f.answers.shift()!([record("notes"), record("new")]);
	await f.settle();
	assert.deepEqual(paths(f.pages()), ["new", "notes"]);
	assert.equal(f.pages().find((page) => page.path.includes("new"))!.x, 500, "placed where the drawing has it");
});

test("a read that crossed a removal does not bring the removed card back", async () => {
	const f = frame(drawing(card("deep")), [record("deep")]);
	f.draw(drawing(card("deep"), card("new")));
	f.placer.place();
	f.draw(drawing(card("new")));
	f.placer.place();
	assert.deepEqual(paths(f.pages()), [], "deep left at once");
	f.answers.shift()!([record("deep"), record("new")]);
	await f.settle();
	assert.deepEqual(paths(f.pages()), ["new"]);
});

test("while a read is out, a change waits, and is read once more when that read settles", async () => {
	const f = frame(drawing(), []);
	f.draw(drawing(card("a")));
	f.placer.place();
	f.draw(drawing(card("a"), card("b")));
	f.placer.place();
	f.placer.place();
	assert.equal(f.placer.reads(), 1, "one read at a time");
	f.answers.shift()!([record("a")]);
	await f.settle();
	assert.equal(f.placer.reads(), 2, "read once more for what changed meanwhile");
	f.answers.shift()!([record("a"), record("b")]);
	await f.settle();
	assert.deepEqual(paths(f.pages()), ["a", "b"]);
	assert.equal(f.placer.reads(), 2, "and then no more");
});

test("a card that only moved is placed from the drawing, with no read", () => {
	const f = frame(drawing(card("notes")), [record("notes")]);
	f.draw(drawing(card("notes", 900)));
	f.placer.place();
	assert.equal(f.pages()[0]!.x, 900);
	assert.equal(f.placer.reads(), 0);
});
