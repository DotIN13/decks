import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";
import { assetHeaders, isExecutable } from "./serve.ts";

test("which files a browser runs, and therefore which get quarantined", () => {
	for (const path of ["a.html", "A.HTM", "chart.svg", "doc.xhtml", "feed.xml"]) {
		assert.equal(isExecutable(path), true, path);
	}
	// Data, not documents: board.js draws these itself, so they never execute.
	for (const path of ["notes.md", "paper.pdf", "fig.png", "data.json", "x"]) {
		assert.equal(isExecutable(path), false, path);
	}
});

/** Just enough of a response to see which headers a call sets. */
function headers(): { set: Record<string, string>; res: Response } {
	const set: Record<string, string> = {};
	return { set, res: { setHeader: (name: string, value: string) => (set[name.toLowerCase()] = value) } as unknown as Response };
}

test("an asset a browser would run is sandboxed, even though it is inside the deck", () => {
	// The point of this one: `assets/` now holds files the user dropped in, and
	// `/api/board/assets/x.html` is same-origin unless something says otherwise.
	const executable = headers();
	assetHeaders(executable.res, "/deck/assets/evil.html");
	assert.equal(executable.set["content-security-policy"], "sandbox allow-scripts");
	assert.equal(executable.set["x-content-type-options"], "nosniff");

	const data = headers();
	assetHeaders(data.res, "/deck/assets/photo.png");
	assert.equal(data.set["content-security-policy"], undefined);
	assert.equal(data.set["x-content-type-options"], "nosniff");
});
