import assert from "node:assert/strict";
import { test } from "node:test";
import { wholeFolder } from "./whole-folder.ts";

test("a canvas folder sent as a path becomes a whole address, so an image fill can be read against it", () => {
	const page = "http://127.0.0.1:4440/";
	const folder = wholeFolder("/api/f/Users/me/decks/canvases/bean-to-cup/", page);
	assert.equal(folder, "http://127.0.0.1:4440/api/f/Users/me/decks/canvases/bean-to-cup/");
	assert.equal(new URL("../../work/ep2-covers/bg-s19-lightning.png", folder).href, "http://127.0.0.1:4440/api/f/Users/me/decks/work/ep2-covers/bg-s19-lightning.png");
	// What the path alone did, and why the stage froze.
	assert.throws(() => new URL("../../work/x.png", "/api/f/Users/me/decks/canvases/bean-to-cup/"), /Invalid URL/);
});

test("a whole address stays as it is, and nothing stays nothing", () => {
	assert.equal(wholeFolder("https://deck.example/node/4440/api/f/c/", "http://127.0.0.1:4440/"), "https://deck.example/node/4440/api/f/c/");
	assert.equal(wholeFolder("", "http://127.0.0.1:4440/"), "");
	assert.equal(wholeFolder("/x/", "not a page"), "");
});
