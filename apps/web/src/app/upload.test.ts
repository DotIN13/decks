import assert from "node:assert/strict";
import { test } from "node:test";
import { embedPath } from "./upload.ts";

/**
 * Where an uploaded file goes is the server's decision; how a board *refers* to it
 * is this one, and it is the difference between an embed and a broken embed.
 */
test("an asset is addressed the way a document addresses a sibling directory", () => {
	assert.equal(embedPath("boards/plan.html", "assets/photo.png"), "../assets/photo.png");
	assert.equal(embedPath("boards/deep/plan.html", "assets/photo.png"), "../../assets/photo.png");
	// A board at the top of the deck, which nothing stops a person from writing.
	assert.equal(embedPath("plan.html", "assets/photo.png"), "assets/photo.png");
	// Same directory: no `../` at all.
	assert.equal(embedPath("assets/plan.html", "assets/photo.png"), "photo.png");
});
