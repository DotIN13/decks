import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyBoardInto } from "./copy-in.ts";

test("a card placed from another canvas comes with its whole folder, into cards/, as a card", () => {
	const deck = mkdtempSync(join(tmpdir(), "copy-in-"));
	try {
		mkdirSync(join(deck, "canvases/a/cards/sales"), { recursive: true });
		writeFileSync(join(deck, "canvases/a/cards/sales/index.html"), "<h1>Sales</h1><script type=module src=chart.js></script>");
		writeFileSync(join(deck, "canvases/a/cards/sales/chart.js"), "export default () => {};");
		const copy = copyBoardInto(deck, "canvases/a/cards/sales/index.html", "b");
		assert.equal(copy, "canvases/b/cards/sales/index.html");
		assert.equal(readFileSync(join(deck, "canvases/b/cards/sales/chart.js"), "utf8"), "export default () => {};");
		assert.ok(!existsSync(join(deck, "canvases/b/boards")), "no board copy");
		assert.equal(copyBoardInto(deck, "canvases/a/cards/sales/index.html", "b"), "canvases/b/cards/sales-2/index.html", "the next free name");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});
