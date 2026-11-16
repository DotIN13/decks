import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deleteFile, editFile, FileRefused, findFiles, grepFiles, listFiles, moveFile, readFile, resolveIn, writeFile } from "./deck-files.ts";

function deck() {
	const root = mkdtempSync(join(tmpdir(), "decks-files-"));
	mkdirSync(join(root, "canvases", "plan", "cards", "q3"), { recursive: true });
	writeFileSync(join(root, "canvases", "plan", "cards", "q3", "index.html"), "<title>Q3</title>\n<h1>Revenue is up</h1>\n");
	mkdirSync(join(root, ".decks"));
	writeFileSync(join(root, ".decks", "tokens.json"), "{}");
	mkdirSync(join(root, "lib"));
	writeFileSync(join(root, "lib", "d3.min.js"), "revenue");
	mkdirSync(join(root, "assets"));
	writeFileSync(join(root, "assets", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
	return root;
}

test("file calls reach the deck and nothing else", () => {
	const root = deck();
	const outside = mkdtempSync(join(tmpdir(), "decks-outside-"));
	writeFileSync(join(outside, "secret.txt"), "secret");
	symlinkSync(outside, join(root, "assets", "out"));
	for (const path of ["/etc/passwd", "../x", "a/../../x", ".decks/tokens.json", "canvases/.git/config", "assets/out/secret.txt", "a//b"]) {
		assert.throws(() => resolveIn(root, path), FileRefused, path);
	}
	assert.throws(() => writeFile(root, "assets/out/new.txt", "x"), FileRefused);
	assert.throws(() => writeFile(root, "lib/d3.min.js", "x"), FileRefused, "lib is read only");
	assert.throws(() => writeFile(root, "", "x"), FileRefused);
	assert.equal(existsSync(join(outside, "new.txt")), false);
	rmSync(root, { recursive: true, force: true });
	rmSync(outside, { recursive: true, force: true });
});

test("list, find, read and grep see the deck's text, not its hidden folders or libraries", () => {
	const root = deck();
	assert.deepEqual(listFiles(root, "").map((one) => one.path), ["assets", "canvases", "lib"]);
	const deep = listFiles(root, "canvases", { deep: true }).map((one) => one.path);
	assert.ok(deep.includes("canvases/plan/cards/q3/index.html"));
	assert.deepEqual(findFiles(root, "index.html").map((one) => one.path), ["canvases/plan/cards/q3/index.html"]);
	assert.deepEqual(findFiles(root, "canvases/*/cards/*/index.html").map((one) => one.path), ["canvases/plan/cards/q3/index.html"]);
	assert.deepEqual(findFiles(root, "**/*.html").map((one) => one.path), ["canvases/plan/cards/q3/index.html"]);
	const read = readFile(root, "canvases/plan/cards/q3/index.html", { from: 2, lines: 1 });
	assert.equal(read.text, "<h1>Revenue is up</h1>");
	assert.equal(read.lines, 3);
	assert.equal(read.more, true);
	assert.throws(() => readFile(root, "assets/a.png"), /not text/);
	// The library's copy of the word is not the deck's content.
	assert.deepEqual(grepFiles(root, "revenue", { ignoreCase: true }).map((one) => `${one.path}:${one.line}`), ["canvases/plan/cards/q3/index.html:2"]);
	rmSync(root, { recursive: true, force: true });
});

test("write, edit, move and delete change the deck, and a stale write is refused", () => {
	const root = deck();
	const made = writeFile(root, "canvases/plan/cards/new/index.html", "<title>New</title>\n<p>one two one</p>\n");
	assert.equal(made.path, "canvases/plan/cards/new/index.html");
	assert.throws(() => writeFile(root, made.path, "x", { rev: made.at - 5 }), /changed since/);
	assert.throws(() => editFile(root, made.path, [{ find: "one", replace: "1" }]), /2 times/);
	assert.throws(() => editFile(root, made.path, [{ find: "two", replace: "2" }, { find: "absent", replace: "" }]), /not in/);
	assert.match(readFileSync(join(root, made.path), "utf8"), /one two one/, "all the edits land or none");
	editFile(root, made.path, [{ find: "one", replace: "1", all: true }, { find: "two", replace: "$&" }]);
	assert.match(readFileSync(join(root, made.path), "utf8"), /1 \$& 1/);
	const moved = moveFile(root, "canvases/plan/cards/new", "canvases/plan/cards/renamed");
	assert.equal(moved.dir, true);
	assert.throws(() => moveFile(root, "canvases/plan/cards/renamed", "canvases/plan/cards/q3"), /already there/);
	const gone = deleteFile(root, "canvases/plan/cards/renamed");
	assert.equal(existsSync(join(root, "canvases/plan/cards/renamed")), false);
	assert.equal(existsSync(join(root, gone.trash, "index.html")), true);
	rmSync(root, { recursive: true, force: true });
});
