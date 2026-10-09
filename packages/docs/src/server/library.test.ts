import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import type { DocServerMessage } from "../index.ts";
import { DocLibrary } from "./library.ts";
import { DocService } from "./service.ts";
import { MemoryVersions } from "./versions.ts";

/** A deck-like folder: documents anywhere in it, their records in docs/, and ro/ that may not be written. */
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

test("a file is edited where it is, and only its records go in a folder of their own", () => {
	const { root, docs, done } = setup();
	writeFileSync(join(root, "papers/paper.md"), "# Results\n\nThe effect is small.\n");
	const state = docs.opened("papers/paper.md", "p");
	assert.equal(state.path, "papers/paper.md");
	docs.patch(state.path, "p", state.rev, "b1", [{ at: 9, before: "", text: ", for now" }]);
	assert.equal(readFileSync(join(root, "papers/paper.md"), "utf8"), "# Results, for now\n\nThe effect is small.\n");
	assert.deepEqual(readdirSync(join(root, "papers")), ["paper.md"], "nothing is added beside the file");
	assert.deepEqual(readdirSync(join(root, "docs/paper")).sort(), ["doc.json", "versions"]);
	assert.equal(JSON.parse(readFileSync(join(root, "docs/paper/doc.json"), "utf8")).source, join(root, "papers/paper.md"));
	docs.closeAll();
	done();
});

test("history and recent outside writes are kept in the records, so a restart keeps them", () => {
	const { root, docs, make, done } = setup();
	writeFileSync(join(root, "papers/a.md"), "one two\n");
	const state = docs.opened("papers/a.md", "p");
	// An agent's own write to the file.
	writeFileSync(join(root, "papers/a.md"), "one two three\n");
	docs.patch(state.path, "p", state.rev, "b1", []);
	docs.closeAll();
	const again = make().opened("papers/a.md", "p");
	assert.equal(again.changes.length, 1);
	assert.equal(again.changes[0]!.splices[0]!.text, " three");
	assert.ok(make().versions("papers/a.md").versions.length >= 2);
	assert.ok(existsSync(join(root, "docs/a/changes.json")));
	done();
});

test("two files with one name keep separate records, and each finds its own again", () => {
	const { root, docs, make, done } = setup();
	mkdirSync(join(root, "papers/old"));
	writeFileSync(join(root, "papers/main.tex"), "new\n");
	writeFileSync(join(root, "papers/old/main.tex"), "old\n");
	docs.opened("papers/main.tex", "p");
	docs.opened("papers/old/main.tex", "p");
	docs.closeAll();
	assert.deepEqual(readdirSync(join(root, "docs")).sort(), ["main", "main-2"]);
	make().opened("papers/old/main.tex", "p");
	assert.deepEqual(readdirSync(join(root, "docs")).sort(), ["main", "main-2"]);
	done();
});

test("a page naming a copy from before documents were edited in place opens the original", () => {
	const { root, docs, done } = setup();
	writeFileSync(join(root, "papers/x.md"), "the original\n");
	mkdirSync(join(root, "docs/x"), { recursive: true });
	writeFileSync(join(root, "docs/x/x.md"), "a stale copy\n");
	writeFileSync(join(root, "docs/x/doc.json"), JSON.stringify({ source: join(root, "papers/x.md"), file: "x.md", format: "text", openedAt: 1 }));
	const state = docs.opened("docs/x/x.md", "p");
	assert.equal(state.path, "papers/x.md");
	assert.equal(state.asked, "docs/x/x.md");
	assert.equal(state.text, "the original\n");
	docs.closeAll();
	done();
});

test("a file that may not be written opens read-only", () => {
	const { root, docs, done } = setup();
	writeFileSync(join(root, "ro/locked.md"), "fixed\n");
	const state = docs.opened("ro/locked.md", "p");
	assert.match(state.error ?? "", /read-only/);
	assert.deepEqual(docs.patch(state.path, "p", state.rev, "b1", [{ at: 5, before: "", text: "!" }]).refused, [0]);
	assert.equal(readFileSync(join(root, "ro/locked.md"), "utf8"), "fixed\n");
	docs.closeAll();
	done();
});
