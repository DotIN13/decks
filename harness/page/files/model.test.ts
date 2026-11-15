import assert from "node:assert/strict";
import { test } from "node:test";
import { folderOf, fromCanvas, isPlayable, isRaster, isWords, onStage, sizeLabel } from "./model.ts";

// A dropped file shows on the canvas as itself when it is a picture, short words or a player.

const file = (name: string, type = "", size = 10) => ({ name, type, size });

test("pictures, short words and players show as themselves; an SVG and long words do not", () => {
	assert.ok(isRaster(file("a.PNG")));
	assert.ok(!isRaster(file("a.svg", "image/svg+xml")));
	assert.ok(isWords(file("n.md")));
	assert.ok(!isWords(file("n.md", "", 300 * 1024)));
	assert.ok(isPlayable(file("v.bin", "video/mp4")));
	assert.ok(!onStage(file("x.zip")));
});

test("a deck path is reached from the canvas's folder", () => {
	assert.equal(folderOf("shared/ada/notes"), "shared/canvases/ada/notes");
	assert.equal(fromCanvas("canvases/plan/files/a.png", "plan"), "files/a.png");
	assert.equal(fromCanvas("assets/a.png", "plan"), "../../assets/a.png");
	assert.equal(fromCanvas("assets/a.png", undefined), "../../assets/a.png");
});

test("sizes read in bytes, kB and MB", () => {
	assert.equal(sizeLabel(512), "512 B");
	assert.equal(sizeLabel(2048), "2 kB");
	assert.equal(sizeLabel(3 * 1024 * 1024), "3.0 MB");
});
