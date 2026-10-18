import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene, type FakeItem } from "./fake-scene.ts";
import { blockAt, marqueePick, marqueeRect, pickAt, pictureAt } from "./pick.ts";

const mark = (type: string) => ({ metadata: { type } });

/** A group of a frame holding a rectangle, a shape, a file chip, a card of markdown and a picture, and a loose line. */
const stage = (): FakeItem[] => [
	{ id: "g", type: "group", box: { x: 0, y: 0, w: 400, h: 400 } },
	{ id: "f", type: "frame", parent: "g", box: { x: 0, y: 0, w: 200, h: 200 } },
	{ id: "r", parent: "f", box: { x: 10, y: 10, w: 50, h: 50 } },
	{ id: "sh", type: "frame", box: { x: 500, y: 0, w: 100, h: 100 }, extra: mark("decks.shape") },
	{ id: "sh-line", type: "path", parent: "sh", box: { x: 500, y: 0, w: 100, h: 100 }, line: true },
	{ id: "sh-words", type: "text", parent: "sh", box: { x: 520, y: 40, w: 60, h: 20 } },
	{ id: "file", type: "frame", box: { x: 700, y: 0, w: 120, h: 32 }, extra: mark("decks.file") },
	{ id: "file-name", type: "text", parent: "file", box: { x: 730, y: 8, w: 80, h: 16 } },
	{ id: "live", type: "frame", box: { x: 900, y: 0, w: 100, h: 100 }, extra: mark("decks.live-file") },
	{ id: "live-pic", parent: "live", box: { x: 900, y: 0, w: 100, h: 100 } },
	{ id: "card", type: "frame", box: { x: 0, y: 500, w: 300, h: 200 }, extra: mark("decks.card") },
	{ id: "h1", type: "text", parent: "card", box: { x: 16, y: 516, w: 268, h: 30 }, extra: mark("decks.markdown") },
	{ id: "p1", type: "text", parent: "card", box: { x: 16, y: 556, w: 268, h: 40 }, extra: mark("decks.markdown") },
	{ id: "pic", parent: "card", box: { x: 16, y: 606, w: 100, h: 80 } },
	{ id: "line", type: "path", box: { x: 400, y: 800, w: 200, h: 2 }, line: false },
	{ id: "line2", type: "path", box: { x: 400, y: 900, w: 200, h: 2 }, line: true },
	{ id: "ref/inside", box: { x: 1100, y: 0, w: 50, h: 50 } },
	{ id: "board", type: "browser", box: { x: 1200, y: 0, w: 50, h: 50 }, extra: mark("decks.board") },
];

test("a press climbs to the outermost group; deep finds the item itself", () => {
	const scene = fakeScene(stage());
	assert.equal(pickAt(scene, { x: 20, y: 20 })?.id, "g");
	assert.equal(pickAt(scene, { x: 20, y: 20 }, { policy: "outermost" })?.id, "g");
	assert.equal(pickAt(scene, { x: 20, y: 20 }, { deep: true })?.id, "r");
	// Deep on the frame's own paper is the frame.
	assert.equal(pickAt(scene, { x: 150, y: 150 }, { deep: true })?.id, "f");
	// A group is never hit itself, only climbed to: its empty corner is nothing.
	assert.equal(pickAt(scene, { x: 300, y: 300 }), undefined);
});

test("a shape, a file and a live file are picked whole", () => {
	const scene = fakeScene(stage());
	assert.equal(pickAt(scene, { x: 550, y: 50 })?.id, "sh");
	assert.equal(pickAt(scene, { x: 550, y: 50 }, { deep: true })?.id, "sh-words");
	assert.equal(pickAt(scene, { x: 750, y: 16 })?.id, "file");
	assert.equal(pickAt(scene, { x: 950, y: 50 })?.id, "live");
	assert.equal(pickAt(scene, { x: 950, y: 50 }, { deep: true })?.id, "live-pic");
});

test("a card is climbed to from its markdown, not from a picture in it", () => {
	const scene = fakeScene(stage());
	assert.equal(pickAt(scene, { x: 50, y: 570 })?.id, "card");
	assert.equal(pickAt(scene, { x: 50, y: 570 }, { deep: true })?.id, "p1");
	assert.equal(pickAt(scene, { x: 50, y: 650 })?.id, "pic");
	assert.equal(pickAt(scene, { x: 250, y: 650 })?.id, "card");
});

test("a line is hit on its stroke only; anything else only inside its box, not in the reach", () => {
	const scene = fakeScene(stage());
	assert.equal(pickAt(scene, { x: 500, y: 801 }), undefined);
	assert.equal(pickAt(scene, { x: 500, y: 903 })?.id, "line2");
	// 2 px off the rectangle: in the engine's reach, outside what it draws, so the frame under it.
	assert.equal(pickAt(scene, { x: 62, y: 20 }, { deep: true })?.id, "f");
	assert.equal(pickAt(scene, { x: 1300, y: 1300 }), undefined);
});

test("never an instance's inside or a board; skip looks through an item; the box is a copy", () => {
	const scene = fakeScene(stage());
	assert.equal(pickAt(scene, { x: 1120, y: 20 }), undefined);
	assert.equal(pickAt(scene, { x: 1220, y: 20 }), undefined);
	assert.equal(pickAt(scene, { x: 20, y: 20 }, { deep: true, skip: (node) => node.id === "r" })?.id, "f");
	const hit = pickAt(scene, { x: 20, y: 20 }, { deep: true })!;
	assert.deepEqual(hit.box, { x: 10, y: 10, w: 50, h: 50 });
	assert.notEqual(hit.box, scene.box("r"));
});

test("the item as drawn is what is hit, not where it is placed", () => {
	const scene = fakeScene([{ id: "t", type: "text", box: { x: 0, y: 0, w: 10, h: 10 }, drawn: { x: 0, y: 0, w: 80, h: 20 } }]);
	assert.deepEqual(pickAt(scene, { x: 60, y: 15 }), { id: "t", node: scene.node("t"), box: { x: 0, y: 0, w: 80, h: 20 } });
});

test("a card's block: the one under the point, or the one level with it in the margin", () => {
	const scene = fakeScene(stage());
	assert.equal(blockAt(scene, { x: 50, y: 570 }), "p1");
	// The card's margin, level with the heading, and 4 px above it.
	assert.equal(blockAt(scene, { x: 4, y: 530 }), "h1");
	assert.equal(blockAt(scene, { x: 4, y: 513 }), "h1");
	assert.equal(blockAt(scene, { x: 4, y: 510 }), undefined);
	// A picture is not a block of words; nor is anything outside a card.
	assert.equal(blockAt(scene, { x: 50, y: 650 }), undefined);
	assert.equal(blockAt(scene, { x: 20, y: 20 }), undefined);
	// Not in the card open for typing.
	assert.equal(blockAt(scene, { x: 50, y: 570 }, "card"), undefined);
});

test("a board's picture: the last in file order, never one drawn as a page or in focus", () => {
	const boards = [
		{ path: "a", x: 0, y: 0, w: 100, h: 100 },
		{ path: "b", x: 50, y: 50, w: 100, h: 100 },
	];
	assert.equal(pictureAt(boards, { x: 75, y: 75 }, new Set()), "b");
	assert.equal(pictureAt(boards, { x: 75, y: 75 }, new Set(["b"])), "a");
	assert.equal(pictureAt(boards, { x: 75, y: 75 }, new Set(), "b"), "a");
	assert.equal(pictureAt(boards, { x: 100, y: 100 }, new Set(["a", "b"])), undefined);
	assert.equal(pictureAt(boards, { x: 150, y: 150 }, new Set()), "b");
	assert.equal(pictureAt(boards, { x: 151, y: 150 }, new Set()), undefined);
});

test("a marquee picks what is wholly inside it, leaving children of a picked parent to it", () => {
	const scene = fakeScene(stage(), [{ path: "boards/x.html", x: 0, y: 1000, w: 100, h: 100 }]);
	assert.deepEqual(marqueeRect({ x1: 100, y1: 50, x2: 10, y2: 80 }), { x: 10, y: 50, w: 90, h: 30 });
	// Just the rectangle: its frame and group are not wholly inside.
	assert.deepEqual(marqueePick(scene, { x: 5, y: 5, w: 60, h: 60 }), { items: ["r"], boards: [] });
	// Edges count as inside.
	assert.deepEqual(marqueePick(scene, { x: 10, y: 10, w: 50, h: 50 }).items, ["r"]);
	// The whole group: only the group, its frame and rectangle go with it.
	assert.deepEqual(marqueePick(scene, { x: -1, y: -1, w: 402, h: 402 }).items, ["g"]);
	// A shape's parts are never picked by themselves, even with the shape outside.
	assert.deepEqual(marqueePick(scene, { x: 510, y: 30, w: 80, h: 40 }).items, []);
	// A card takes its blocks; an instance's inside and a board's node are left out; boards wholly inside are picked.
	assert.deepEqual(marqueePick(scene, { x: -10, y: 490, w: 2000, h: 700 }), { items: ["card", "line", "line2"], boards: ["boards/x.html"] });
	assert.deepEqual(marqueePick(scene, { x: 1090, y: -10, w: 200, h: 100 }).items, []);
});
