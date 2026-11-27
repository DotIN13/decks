import assert from "node:assert/strict";
import { test } from "node:test";
import { isCardPath, servedAs } from "../src/layout.ts";

const path = (resolved: ReturnType<typeof servedAs>) => ("path" in resolved ? resolved.path : resolved.refused);

test("a canvas's lib/ is the deck's", () => {
	assert.equal(path(servedAs("canvases/plan/lib/card.css")), "lib/card.css");
	assert.equal(path(servedAs("shared/canvases/ada/plan/lib/card.js")), "lib/card.js");
	assert.equal(path(servedAs("lib/card.css")), "lib/card.css");
	assert.equal(path(servedAs("lib/fonts/a.woff2")), "lib/fonts/a.woff2");
});

test("a page is a card, and a card file from before cards is not one", () => {
	assert.ok(isCardPath("canvases/plan/cards/a/index.html"));
	assert.ok(!isCardPath("cards/old/index.html"));
	assert.ok(!isCardPath("canvases/plan/boards/old.html"));
	assert.ok(!isCardPath("canvases/plan/files/a.html"));
});
