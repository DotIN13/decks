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
	assert.deepEqual(file.sizes, { "boards/a.html": { w: 640, h: 480 } });
	assert.deepEqual(file.somethingNewer, { keep: true });

	// A future field survives a write, because the file belongs to the user too.
	const written = serializeDeckFile(file);
	assert.match(written, /"somethingNewer"/);
	assert.equal(written.at(-1), "\n");
	// version first, then the parts a human scans for.
	assert.ok(written.indexOf('"version"') < written.indexOf('"name"'));
	assert.ok(written.indexOf('"sizes"') < written.indexOf('"somethingNewer"'));
});

test("a legacy boards map gives up its sizes and loses its positions", () => {
	const { file, warnings } = parseDeckFile('{"boards":{"a.html":{"x":10,"y":20,"w":500}}}');
	// The size is a fact about a board that has nowhere else to keep it; the place belongs to a
	// stage now, and this file is not one.
	assert.deepEqual(file.sizes, { "a.html": { w: 500 } });
	assert.equal("boards" in file, false, "the old key is consumed, so a write does not carry it on");
	assert.deepEqual(warnings, []);
});

test("sizes is the current key, and it wins where a file has both", () => {
	const { file } = parseDeckFile('{"boards":{"a.html":{"x":1,"y":2,"w":500}},"sizes":{"a.html":{"w":800}}}');
	assert.deepEqual(file.sizes, { "a.html": { w: 800 } });
});

test("a size that is not a positive number is dropped, not fatal", () => {
	const { file, warnings } = parseDeckFile('{"sizes":{"a.html":{"w":"wide"},"b.html":{"w":640}}}');
	assert.deepEqual(file.sizes, { "b.html": { w: 640 } });
	assert.equal(warnings.length, 1);
	assert.match(warnings[0]!, /a\.html/);
});

test("a broken deck file opens the deck anyway, with a warning", () => {
	const { file, warnings } = parseDeckFile("{ not json");
	assert.equal(file.version, 1);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0]!, /not valid JSON/);
});

test("a deck file without sizes writes none, so a deck nobody resized stays tidy", () => {
	const written = serializeDeckFile({ version: 1, name: "T" });
	assert.equal(written.includes("sizes"), false);
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
