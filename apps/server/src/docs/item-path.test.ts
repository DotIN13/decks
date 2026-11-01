import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { documentItemPath } from "./item-path.ts";

const deck = mkdtempSync(join(tmpdir(), "decks-item-path-"));
mkdirSync(join(deck, "canvases/china/files"), { recursive: true });
mkdirSync(join(deck, "docs"), { recursive: true });
writeFileSync(join(deck, "canvases/china/files/notes.md"), "# notes");
writeFileSync(join(deck, "docs/plan.md"), "# plan");
test.after(() => rmSync(deck, { recursive: true, force: true }));

test("a path as the deck names it is kept, with no note", () => {
	assert.deepEqual(documentItemPath(deck, "china", "docs/plan.md"), { path: "docs/plan.md" });
	assert.deepEqual(documentItemPath(deck, "china", "canvases/china/files/notes.md"), { path: "canvases/china/files/notes.md" });
});

test("a path from the canvas's folder, or a bare file name, is found in the canvas's files and said as the deck names it", () => {
	assert.equal(documentItemPath(deck, "china", "files/notes.md").path, "canvases/china/files/notes.md");
	assert.equal(documentItemPath(deck, "china", "notes.md").path, "canvases/china/files/notes.md");
	assert.match(documentItemPath(deck, "china", "files/notes.md").note ?? "", /taken as canvases\/china\/files\/notes.md/);
});

test("an absolute path inside the deck becomes the deck's name for it; one outside is left with a note", () => {
	assert.equal(documentItemPath(deck, "china", join(deck, "docs/plan.md")).path, "docs/plan.md");
	const outside = documentItemPath(deck, "china", "/somewhere/else/paper.md");
	assert.equal(outside.path, "/somewhere/else/paper.md");
	assert.match(outside.note ?? "", /outside the deck/);
});

test("a file named nowhere is made empty in the canvas's files when asked, else left with a note saying how to name it", () => {
	const said = documentItemPath(deck, "china", "files/new.md");
	assert.equal(said.path, "files/new.md");
	assert.match(said.note ?? "", /no file called files\/new.md/);
	const made = documentItemPath(deck, "china", "files/new.md", { make: true });
	assert.equal(made.path, "canvases/china/files/new.md");
	assert.ok(existsSync(join(deck, "canvases/china/files/new.md")));
	assert.deepEqual(documentItemPath(deck, "china", "canvases/china/files/new.md"), { path: "canvases/china/files/new.md" });
});

test("a path that climbs out of the deck is refused with a note", () => {
	assert.match(documentItemPath(deck, "china", "../../etc/passwd").note ?? "", /climbs out/);
});
