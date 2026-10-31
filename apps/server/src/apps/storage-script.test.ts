import { test } from "node:test";
import assert from "node:assert/strict";
import { withStorage } from "./storage-script.ts";

test("a page opened in the canvas frame gets the storage stand-in first, unless it has it", () => {
	const src = "/app/t/PASS/cutter/decks-storage.js";
	assert.equal(withStorage(`<!doctype html><html><head><meta charset="utf-8"></head></html>`, src), `<!doctype html><html><head><script src="${src}"></script><meta charset="utf-8"></head></html>`);
	assert.equal(withStorage(`<!doctype html><p>no head</p>`, src), `<!doctype html><script src="${src}"></script><p>no head</p>`);
	assert.equal(withStorage(`<p>bare</p>`, src), `<script src="${src}"></script><p>bare</p>`);
	const own = `<head><script src="decks-storage.js"></script></head>`;
	assert.equal(withStorage(own, src), own);
});
