import assert from "node:assert/strict";
import { test } from "node:test";
import { centredOp, mediaItem, pictureItem, rowOps, wordsCard } from "./file-drop.ts";

test("a picture lands at its own proportions, at most 640 wide", () => {
	const item = pictureItem("a.png", "assets/a.png", { width: 1280, height: 720 });
	assert.equal(item.w, 640);
	assert.equal(item.h, 360);
	assert.deepEqual(centredOp(item, { x: 0, y: 0 }, "p").box, { x1: -320, y1: -180, x2: 320, y2: 180 });
});

test("a sound is a strip, a film its poster's shape", () => {
	assert.deepEqual([mediaItem("s.mp3", "s.mp3", { kind: "audio" }, (p) => p).w, mediaItem("s.mp3", "s.mp3", { kind: "audio" }, (p) => p).h], [420, 72]);
	const film = mediaItem("f.mp4", "f.mp4", { kind: "video", poster: "f.jpg", w: 1920, h: 1080 }, (p) => `/${p}`);
	assert.equal(film.h, 360);
	assert.deepEqual((film.node as { fill: { url: string } }).fill.url, "/f.jpg");
});

test("items dropped together lie in a row centred on the drop, tops level", () => {
	const ops = rowOps([wordsCard("n.md", "# Hi"), pictureItem("a.png", "a.png", { width: 200, height: 100 })], { x: 0, y: 0 }, (i) => `d${i}`);
	const boxes = ops.map((op) => op.box as { x1: number; y1: number; x2: number });
	assert.equal(boxes[0]!.x1, -(480 + 32 + 200) / 2);
	assert.equal(boxes[1]!.x1, boxes[0]!.x2 + 32);
	assert.equal(boxes[0]!.y1, boxes[1]!.y1);
	assert.equal((ops[0]!.node as { id: string }).id, "d0");
});
