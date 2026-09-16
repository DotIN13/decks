import assert from "node:assert/strict";
import { test } from "node:test";
import { declaredRoots, normalizeBoardPath, parseDeckFile, serializeDeckFile } from "./schema.ts";

test("a deck file round-trips, keeping keys it does not know about", () => {
	const source = `{
  "version": 1,
  "name": "Example",
  "sizes": { "boards/a.html": { "w": 640, "h": 480 } },
  "roots": ["../shared"],
  "somethingNewer": { "keep": true }
}`;
	const { file, warnings } = parseDeckFile(source);
	assert.deepEqual(warnings, []);
	assert.equal(file.name, "Example");
	assert.deepEqual(file.somethingNewer, { keep: true });

	// A future field survives a write, because the file belongs to the user too.
	const written = serializeDeckFile(file);
	assert.match(written, /"somethingNewer"/);
	assert.equal(written.at(-1), "\n");
	// version first, then the parts a human scans for.
	assert.ok(written.indexOf('"version"') < written.indexOf('"name"'));
	assert.ok(written.indexOf('"roots"') < written.indexOf('"somethingNewer"'));
	/*
	 * And a `sizes` map that was in the source is gone from the write. A board's size is its own file's
	 * business — `withBoardSize` writes it there — and a copy here was what made a resize that wrote
	 * the file look like it had done nothing.
	 */
	assert.equal(written.includes('"sizes"'), false);
});

test("a legacy boards map gives up its places as a seed, and none of its sizes", () => {
	const { file, arrangement, warnings } = parseDeckFile('{"boards":{"a.html":{"x":10,"y":20,"w":500}}}');
	// The place belongs to a stage now, so it is not written back — but it is kept as the arrangement a
	// stage starts from. The size is not kept anywhere: it belonged to the board, and the board's file
	// is where one lives.
	assert.deepEqual(arrangement, { "a.html": { x: 10, y: 20 } });
	assert.equal("boards" in file, false, "the old key is consumed, so a write does not carry it on");
	assert.equal("sizes" in file, false);
	assert.deepEqual(warnings, []);
});

test("a position that is not a pair of numbers is dropped, not fatal", () => {
	const { arrangement, warnings } = parseDeckFile('{"boards":{"a.html":{"x":"left","y":0},"b.html":{"x":1,"y":2}}}');
	assert.deepEqual(arrangement, { "b.html": { x: 1, y: 2 } });
	assert.equal(warnings.length, 1);
	assert.match(warnings[0]!, /a\.html/);
});

test("a broken deck file opens the deck anyway, with a warning", () => {
	const { file, warnings } = parseDeckFile("{ not json");
	assert.equal(file.version, 1);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0]!, /not valid JSON/);
});

test("a deck file with no board state writes neither key", () => {
	const written = serializeDeckFile({ version: 1, name: "T" });
	assert.equal(written.includes("sizes"), false);
	assert.equal(written.includes("boards"), false);
});

test("a newer version is a warning, not a refusal", () => {
	const { warnings } = parseDeckFile('{"version":7}');
	assert.match(warnings.join(" "), /newer than this build/);
});

test("roots take both spellings", () => {
	const { file } = parseDeckFile('{"roots":["~/papers",{"path":"/tmp/x","writable":true},{"nope":1}]}');
	assert.deepEqual(declaredRoots(file), [
		{ path: "~/papers", writable: false },
		{ path: "/tmp/x", writable: true },
	]);
});

test("one board has one key", () => {
	assert.equal(normalizeBoardPath("./boards\\a.html"), "boards/a.html");
	assert.equal(normalizeBoardPath("boards/a.html"), "boards/a.html");
});
