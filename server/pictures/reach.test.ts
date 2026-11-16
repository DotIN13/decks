import { test } from "node:test";
import assert from "node:assert/strict";
import { reachesCanvas, reachesPath } from "./reach.ts";

// Rule 18: a pass pictures only its own canvas.

const pass = { canvas: "a", calls: [], until: Date.now() + 60_000 };

test("rule 18: a pass reaches its canvas and nothing else", () => {
	assert.equal(reachesCanvas(pass, "a"), true);
	assert.equal(reachesCanvas(pass, "b"), false);
	assert.equal(reachesCanvas(pass, null), false);
	assert.equal(reachesCanvas({ until: 1 }, "a"), false, "a scope with no canvas reaches none");
});

test("rule 18: a path is the pass's only inside its canvas folder; climbs and tricks are refused first", () => {
	assert.equal(reachesPath(pass, "canvases/a/cards/x/index.html"), true);
	for (const bad of ["canvases/b/cards/x/index.html", "canvases/a/../b/cards/x/index.html", "canvases/a%2f..%2fb/x.html", "canvases/a%252f..%252fb/x.html", "canvases/ab/cards/x/index.html", "assets/..%2fcanvases%2fa/x.html", "canvases/a/.decks/x"]) {
		assert.equal(reachesPath(pass, bad), false, bad);
	}
});
