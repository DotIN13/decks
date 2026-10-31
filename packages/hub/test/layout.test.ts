import assert from "node:assert/strict";
import { test } from "node:test";
import { isPagePath, libName, servedAs } from "../src/layout.ts";

const path = (resolved: ReturnType<typeof servedAs>) => ("path" in resolved ? resolved.path : resolved.refused);

test("a canvas's lib/ is the deck's, and a page from before cards finds card.css and card.js by their old names", () => {
	assert.equal(path(servedAs("canvases/plan/lib/card.css")), "lib/card.css");
	assert.equal(path(servedAs("canvases/plan/lib/board.css")), "lib/card.css");
	assert.equal(path(servedAs("shared/canvases/ada/plan/lib/board.js")), "lib/card.js");
	assert.equal(path(servedAs("lib/board.css")), "lib/card.css", "the library's boards ask the deck's lib/ itself");
	assert.equal(path(servedAs("lib/fonts/a.woff2")), "lib/fonts/a.woff2");
	assert.equal(libName("~ab12/board.js"), "~ab12/card.js");
	assert.equal(path(servedAs("canvases/plan/boards/board.css")), "canvases/plan/boards/board.css", "only lib/ is renamed");
});

test("a page is a card or an old board", () => {
	assert.ok(isPagePath("canvases/plan/cards/a/index.html"));
	assert.ok(isPagePath("boards/old.html"));
	assert.ok(!isPagePath("canvases/plan/files/a.html"));
});
