import assert from "node:assert/strict";
import { test } from "node:test";
import { pictureUrl } from "./picture-url.ts";

test("an image fill's address is read against the canvas's folder, given as a path or whole", () => {
	const page = "http://127.0.0.1:4440/";
	const base = "/api/f/Users/me/decks/canvases/bean-to-cup/";
	assert.equal(pictureUrl("../../work/ep2-covers/bg-s19-lightning.png", base, page), "http://127.0.0.1:4440/api/f/Users/me/decks/work/ep2-covers/bg-s19-lightning.png");
	assert.equal(pictureUrl("pic.png", "https://deck.example/api/f/c/", page), "https://deck.example/api/f/c/pic.png");
	assert.equal(pictureUrl("pic.png", "", page), "http://127.0.0.1:4440/pic.png");
});

test("an address that cannot be made is nothing, not a throw in the frame", () => {
	assert.equal(pictureUrl("pic.png", "/x/", "not a page"), undefined);
});
