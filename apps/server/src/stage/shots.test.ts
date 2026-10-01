import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { StagePens } from "./pens.ts";
import { shotBox } from "./shots.ts";

test("a picture frames what it names with a margin: an item, a board, several, everything, or a box", () => {
	const dir = mkdtempSync(join(tmpdir(), "shots-"));
	const pens = new StagePens(dir, () => {});
	try {
		const name = pens.claim("s");
		pens.edit(name, [
			{ op: "insert", node: { type: "rectangle", id: "a", width: 100, height: 50 }, box: { x1: 0, y1: 0 } },
			{ op: "insert", node: { type: "rectangle", id: "b", width: 20, height: 20 }, box: { x1: 300, y1: 200 } },
			{ op: "insert", node: { type: "browser", id: "doc", url: "../../boards/doc.html", width: 400, height: 300, metadata: { type: "decks.board", path: "boards/doc.html" } }, box: { x1: -500, y1: 0 } },
		]);
		assert.deepEqual(shotBox(pens, name, "a"), { x1: -24, y1: -24, x2: 124, y2: 74 });
		assert.deepEqual(shotBox(pens, name, ["a", "b"]), { x1: -24, y1: -24, x2: 344, y2: 244 });
		assert.deepEqual(shotBox(pens, name, "boards/doc.html"), { x1: -524, y1: -24, x2: -76, y2: 324 });
		assert.deepEqual(shotBox(pens, name, undefined), { x1: -524, y1: -24, x2: 344, y2: 324 });
		assert.deepEqual(shotBox(pens, name, { x1: 1, y1: 2, x2: 3, y2: 4 }), { x1: 1, y1: 2, x2: 3, y2: 4 });
		assert.throws(() => shotBox(pens, name, "nope"), /not an item or a board/);
		assert.throws(() => shotBox(pens, name, { x1: 5, y1: 0, x2: 1, y2: 9 }), /x2 right of x1/);
	} finally {
		pens.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a PNG's and a JPEG's size are read from their headers", async () => {
	const { imageSize } = await import("./shots.ts");
	const png = Buffer.alloc(33);
	png.writeUInt32BE(0x89504e47, 0);
	png.writeUInt32BE(1100, 16);
	png.writeUInt32BE(758, 20);
	assert.deepEqual(imageSize(png), { width: 1100, height: 758 });
	// SOI, an APP0 of 16 bytes, then SOF0: length, precision, height 576, width 880.
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x40, 0x03, 0x70, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual(imageSize(jpeg), { width: 880, height: 576 });
	assert.deepEqual(imageSize(Buffer.from("not a picture")), { width: 0, height: 0 });
});
