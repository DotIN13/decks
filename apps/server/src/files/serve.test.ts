import assert from "node:assert/strict";
import { test } from "node:test";
import { isExecutable } from "./serve.ts";

test("which files a browser runs, and therefore which get quarantined", () => {
	for (const path of ["a.html", "A.HTM", "chart.svg", "doc.xhtml", "feed.xml"]) {
		assert.equal(isExecutable(path), true, path);
	}
	// Data, not documents: board.js draws these itself, so they never execute.
	for (const path of ["notes.md", "paper.pdf", "fig.png", "data.json", "x"]) {
		assert.equal(isExecutable(path), false, path);
	}
});
