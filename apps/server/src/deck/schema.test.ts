import assert from "node:assert/strict";
import { test } from "node:test";
import { declaredRoots, normalizeBoardPath, parseDeckFile, serializeDeckFile } from "./schema.ts";

test("a deck file round-trips, keeping keys it does not know about", () => {
	const source = `{
  "version": 1,
  "name": "Example",
  "boards": { "boards/a.html": { "x": 10, "y": 20 } },
  "roots": ["../shared"],
  "somethingNewer": { "keep": true }
}`;
	const { file, warnings } = parseDeckFile(source);
	assert.deepEqual(warnings, []);
	assert.equal(file.name, "Example");
	assert.deepEqual(file.boards, { "boards/a.html": { x: 10, y: 20 } });
	assert.deepEqual(file.somethingNewer, { keep: true });

	// A future field survives a write, because the file belongs to the user too.
	const written = serializeDeckFile(file);
	assert.match(written, /"somethingNewer"/);
	assert.equal(written.at(-1), "\n");
	// version first, then the parts a human scans for.
	assert.ok(written.indexOf('"version"') < written.indexOf('"name"'));
	assert.ok(written.indexOf('"boards"') < written.indexOf('"somethingNewer"'));
});

test("a broken deck file opens the deck anyway, with a warning", () => {
	const { file, warnings } = parseDeckFile("{ not json");
	assert.equal(file.version, 1);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0]!, /not valid JSON/);
});

test("a position that is not a pair of numbers is dropped, not fatal", () => {
	const { file, warnings } = parseDeckFile('{"boards":{"a.html":{"x":"left","y":0},"b.html":{"x":1,"y":2}}}');
	assert.deepEqual(file.boards, { "b.html": { x: 1, y: 2 } });
	assert.equal(warnings.length, 1);
	assert.match(warnings[0]!, /a\.html/);
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
