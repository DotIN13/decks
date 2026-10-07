import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import type { DocServerMessage } from "../index.ts";
import { DocLibrary } from "./library.ts";
import { DocService } from "./service.ts";
import { MemoryVersions } from "./versions.ts";
import { readEntry } from "./zip.ts";
import { storedZip } from "./fixtures.ts";

const changed = (sent: DocServerMessage[]) => sent.filter((m): m is Extract<DocServerMessage, { type: "doc.changed" }> => m.type === "doc.changed");

/** A deck-like folder: documents anywhere in it, a library in docs/, and ro/ that may not be written. */
function setup() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "decks-library-")));
	mkdirSync(join(root, "papers"));
	mkdirSync(join(root, "ro"));
	const library = new DocLibrary(join(root, "docs"));
	const sent: DocServerMessage[] = [];
	const make = () =>
		new DocService({
			resolve: (path) => {
				const file = resolve(root, path);
				const key = relative(root, file);
				if (key.startsWith("..")) throw new Error(`${path} is outside`);
				return { file, key, writable: !key.startsWith("ro/") };
			},
			versions: new MemoryVersions(),
			library: () => library,
			send: (m) => sent.push(m),
		});
	const docs = make();
	return { root, library, sent, docs, make, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("opening a file copies it into a folder of its own, and typing edits the copy, not the original", () => {
	const { root, docs, done } = setup();
	writeFileSync(join(root, "papers/paper.md"), "# Results\n\nThe effect is small.\n");
	const state = docs.opened("papers/paper.md", "p");
	assert.equal(state.path, "docs/paper/paper.md");
	assert.equal(state.asked, "papers/paper.md");
	assert.equal(state.source, join(root, "papers/paper.md"));
	docs.patch(state.path, "p", state.rev, "b1", [{ at: 9, before: "", text: ", for now" }]);
	assert.equal(readFileSync(join(root, "docs/paper/paper.md"), "utf8"), "# Results, for now\n\nThe effect is small.\n");
	assert.equal(readFileSync(join(root, "papers/paper.md"), "utf8"), "# Results\n\nThe effect is small.\n");
	assert.deepEqual(readdirSync(join(root, "docs/paper")).sort(), ["base", "doc.json", "paper.md", "versions"]);
	// The same original opens the same copy, by either name.
	assert.equal(docs.opened("papers/paper.md", "q").path, "docs/paper/paper.md");
	assert.equal(docs.opened("docs/paper/paper.md", "r").path, "docs/paper/paper.md");
	docs.closeAll();
	done();
});

test("history and waiting suggestions are kept in the folder, so a restart keeps them", () => {
	const { root, docs, make, done } = setup();
	writeFileSync(join(root, "papers/a.md"), "one two\n");
	const state = docs.opened("papers/a.md", "p");
	// An agent's own write to the copy.
	writeFileSync(join(root, "docs/a/a.md"), "one two three\n");
	docs.patch(state.path, "p", state.rev, "b1", []);
	docs.closeAll();
	const again = make().opened("papers/a.md", "p");
	assert.equal(again.changes.length, 1);
	assert.equal(again.changes[0]!.splices[0]!.text, " three");
	const versions = make().versions("docs/a/a.md").versions;
	assert.ok(versions.length >= 2);
	assert.ok(existsSync(join(root, "docs/a/changes.json")));
	done();
});

test("an edit to the original is merged into the copy as a change, keeping the copy's own typing", () => {
	const { root, sent, docs, done } = setup();
	writeFileSync(join(root, "papers/p.md"), "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n");
	const state = docs.opened("papers/p.md", "p");
	const at = state.text.indexOf("First") + "First".length;
	const typed = docs.patch(state.path, "p", state.rev, "b1", [{ at, before: "", text: " and only" }]);
	// An agent edits the original, not the copy.
	writeFileSync(join(root, "papers/p.md"), "# Title\n\nFirst paragraph.\n\nSecond, longer paragraph.\n");
	const written = docs.writeBack(state.path);
	assert.equal(written.error, undefined);
	const copy = readFileSync(join(root, "docs/p/p.md"), "utf8");
	assert.equal(copy, "# Title\n\nFirst and only paragraph.\n\nSecond, longer paragraph.\n");
	assert.equal(readFileSync(join(root, "papers/p.md"), "utf8"), copy, "written back, with both edits");
	const merged = changed(sent).find((m) => m.change);
	assert.ok(merged, "the original's edit came in as a change to review");
	assert.ok(merged.base >= typed.rev);
	docs.closeAll();
	done();
});

test("a .docx copy is written back into the original zip", () => {
	const { root, docs, done } = setup();
	const zip = storedZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:t>Hello</w:t>" });
	writeFileSync(join(root, "papers/form.docx"), zip);
	const state = docs.opened("papers/form.docx", "p");
	docs.patch(state.path, "p", state.rev, "b1", [{ at: state.text.indexOf("Hello") + 5, before: "", text: " there" }]);
	assert.equal(readEntry(readFileSync(join(root, "papers/form.docx")), "word/document.xml")!.toString(), "<w:t>Hello</w:t>");
	docs.writeBack(state.path);
	assert.equal(readEntry(readFileSync(join(root, "papers/form.docx")), "word/document.xml")!.toString(), "<w:t>Hello there</w:t>");
	docs.closeAll();
	done();
});

test("a copy of a read-only original can be edited, and writing it back is refused", () => {
	const { root, docs, done } = setup();
	writeFileSync(join(root, "ro/locked.md"), "fixed\n");
	const state = docs.opened("ro/locked.md", "p");
	assert.equal(state.error, undefined, "the copy is in the library, which is writable");
	assert.deepEqual(docs.patch(state.path, "p", state.rev, "b1", [{ at: 5, before: "", text: "!" }]).refused, []);
	assert.match(docs.writeBack(state.path).error ?? "", /not somewhere this server may write/);
	assert.equal(readFileSync(join(root, "ro/locked.md"), "utf8"), "fixed\n");
	docs.closeAll();
	done();
});
