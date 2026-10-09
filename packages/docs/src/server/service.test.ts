import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DocServerMessage as ServerMessage } from "../index.ts";
import { DocService, QUIET_MS } from "./service.ts";
import { DirectoryVersions, MemoryVersions } from "./versions.ts";
import { readEntry, replaceEntry } from "./zip.ts";
import { inside, storedZip } from "./fixtures.ts";

function setup() {
	const root = mkdtempSync(join(tmpdir(), "decks-docs-"));
	const sent: ServerMessage[] = [];
	const revisions = new DirectoryVersions(join(root, ".versions"));
	const docs = new DocService({ resolve: inside(root), versions: revisions, send: (m) => sent.push(m) });
	const done = () => {
		docs.closeAll();
		rmSync(root, { recursive: true, force: true });
	};
	return { root, sent, revisions, docs, done };
}

const changed = (sent: ServerMessage[]) => sent.filter((m): m is Extract<ServerMessage, { type: "doc.changed" }> => m.type === "doc.changed");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a zip entry is replaced and every other entry is left as it was", () => {
	const zip = storedZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:t>old</w:t>" });
	const next = replaceEntry(zip, "word/document.xml", Buffer.from("<w:t>new</w:t>"));
	assert.equal(readEntry(next, "word/document.xml")!.toString(), "<w:t>new</w:t>");
	assert.equal(readEntry(next, "[Content_Types].xml")!.toString(), "<Types/>");
	// And the rewritten archive reads back through itself.
	assert.equal(readEntry(replaceEntry(next, "word/document.xml", Buffer.from("x")), "word/document.xml")!.toString(), "x");
});

test("a batch is written to the file as it lands, and every page is told", () => {
	const { root, sent, docs, done } = setup();
	writeFileSync(join(root, "paper.md"), "Hello world\n");
	const state = docs.opened("paper.md", "page-a");
	assert.equal(state.text, "Hello world\n");
	const answer = docs.patch("paper.md", "page-a", state.rev, "b1", [{ at: 5, before: "", text: "," }]);
	assert.deepEqual(answer.refused, []);
	assert.equal(readFileSync(join(root, "paper.md"), "utf8"), "Hello, world\n");
	const [news] = changed(sent);
	assert.equal(news!.client, "page-a");
	assert.equal(news!.base, state.rev);
	assert.equal(news!.rev, answer.rev);
	done();
});

test("an agent's write made mid-typing is taken in before the next write, not written over", () => {
	const { root, sent, docs, done } = setup();
	const file = join(root, "paper.md");
	writeFileSync(file, "# Results\n\nThe effect is small.\n");
	const state = docs.opened("paper.md", "page-a");
	// The agent's own Edit, straight to the file, before the watcher has had its quiet.
	writeFileSync(file, "# Findings\n\nThe effect is small.\n");
	const at = state.text.indexOf("small") + "small".length;
	const answer = docs.patch("paper.md", "page-a", state.rev, "b1", [{ at, before: "", text: " but real" }]);
	assert.deepEqual(answer.refused, []);
	assert.equal(readFileSync(file, "utf8"), "# Findings\n\nThe effect is small but real.\n");
	const outside = changed(sent).find((m) => m.change);
	assert.ok(outside, "the agent's write went out as a change to highlight");
	assert.deepEqual(outside.change!.splices[0], { at: 2, before: "Result", text: "Finding" });
	done();
});

test("rejecting a change puts the old words back and keeps what was typed since", () => {
	const { root, sent, docs, done } = setup();
	const file = join(root, "paper.md");
	writeFileSync(file, "# Results\n\nThe effect is small.\n");
	const state = docs.opened("paper.md", "page-a");
	writeFileSync(file, "# Findings\n\nThe effect is small.\n");
	const at = state.text.indexOf("small") + "small".length;
	docs.patch("paper.md", "page-a", state.rev, "b1", [{ at, before: "", text: " but real" }]);
	const change = changed(sent).find((m) => m.change)!.change!;
	docs.review("paper.md", change.id, false);
	assert.equal(readFileSync(file, "utf8"), "# Results\n\nThe effect is small but real.\n");
	assert.deepEqual(changed(sent).at(-1)!.settled, [change.id]);
	assert.equal(docs.opened("paper.md", "page-b").changes.length, 0);
	done();
});

test("accept all keeps every change, reject all takes every one back, newest first", () => {
	const { root, sent, docs, done } = setup();
	const file = join(root, "paper.md");
	writeFileSync(file, "one two three\n");
	const state = docs.opened("paper.md", "page-a");
	writeFileSync(file, "one 2 three\n");
	docs.patch("paper.md", "page-a", state.rev, "b1", []);
	writeFileSync(file, "one 2 three four\n");
	docs.patch("paper.md", "page-a", state.rev, "b2", []);
	assert.equal(docs.opened("paper.md", "page-b").changes.length, 2);
	docs.review("paper.md", "*", false);
	assert.equal(readFileSync(file, "utf8"), "one two three\n");
	assert.equal(docs.opened("paper.md", "page-c").changes.length, 0);
	writeFileSync(file, "one two three!\n");
	docs.patch("paper.md", "page-a", docs.opened("paper.md", "page-a").rev, "b3", []);
	docs.review("paper.md", "*", true);
	assert.equal(readFileSync(file, "utf8"), "one two three!\n");
	assert.equal(docs.opened("paper.md", "page-d").changes.length, 0);
	assert.ok(changed(sent).some((m) => m.settled?.length === 1));
	done();
});

test("a kept version can be read back to look at", () => {
	const { root, docs, done } = setup();
	writeFileSync(join(root, "paper.md"), "first\n");
	const state = docs.opened("paper.md", "page-a");
	docs.patch("paper.md", "page-a", state.rev, "b1", [{ at: 5, before: "", text: " draft" }]);
	const first = docs.versions("paper.md").versions[0]!;
	const shown = docs.version("paper.md", first.sha);
	assert.equal(shown.text, "first\n");
	assert.match(docs.version("paper.md", "nope").error ?? "", /version/i);
	done();
});

test("the watcher turns a write from outside into a change without any typing", async () => {
	const { root, sent, docs, done } = setup();
	const file = join(root, "notes.tex");
	writeFileSync(file, "\\section{One}\nText.\n");
	docs.opened("notes.tex", "page-a");
	await wait(50);
	writeFileSync(file, "\\section{One}\nMore text.\n");
	await wait(QUIET_MS + 300);
	const outside = changed(sent).find((m) => m.change);
	assert.ok(outside);
	assert.equal(outside.change!.splices.length, 1);
	assert.deepEqual(outside.change!.splices.map((x) => x.text).join(""), "More t");
	done();
});

test("versions bracket a write from outside, and a restore is one edit every page applies", () => {
	const { root, sent, revisions, docs, done } = setup();
	const file = join(root, "paper.md");
	writeFileSync(file, "one\n");
	const state = docs.opened("paper.md", "page-a");
	docs.patch("paper.md", "page-a", state.rev, "b1", [{ at: 3, before: "", text: " two" }]);
	writeFileSync(file, "one two three\n");
	docs.patch("paper.md", "page-a", docs.opened("paper.md", "page-a").rev, "b2", []);
	const kept = revisions.entries("paper.md").map((v) => revisions.read(v.sha));
	assert.deepEqual(kept, ["one\n", "one two\n", "one two three\n"]);
	const first = revisions.entries("paper.md")[0]!.sha;
	docs.restore("paper.md", first);
	assert.equal(readFileSync(file, "utf8"), "one\n");
	const last = changed(sent).at(-1)!;
	assert.equal(last.client, undefined);
	assert.equal(last.change, undefined);
	done();
});

test("a .docx is edited through its document.xml and stays a zip", () => {
	const { root, docs, done } = setup();
	const file = join(root, "paper.docx");
	writeFileSync(file, storedZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:p><w:r><w:t>Hello</w:t></w:r></w:p>" }));
	const state = docs.opened("paper.docx", "page-a");
	assert.equal(state.format, "docx");
	const at = state.text.indexOf("Hello") + 5;
	docs.patch("paper.docx", "page-a", state.rev, "b1", [{ at, before: "", text: " there" }]);
	assert.equal(readEntry(readFileSync(file), "word/document.xml")!.toString(), "<w:p><w:r><w:t>Hello there</w:t></w:r></w:p>");
	assert.equal(readEntry(readFileSync(file), "[Content_Types].xml")!.toString(), "<Types/>");
	done();
});

test("other file types, and paths the resolver refuses, do not open", () => {
	const { root, docs, done } = setup();
	writeFileSync(join(root, "script.sh"), "echo hi\n");
	assert.match(docs.opened("script.sh", "p").error ?? "", /not a document/);
	assert.match(docs.opened("../outside.md", "p").error ?? "", /outside the folder/);
	done();
});

test("a host with only a socket answers every message through handle", () => {
	const { root, sent, docs, done } = setup();
	writeFileSync(join(root, "a.md"), "one\n");
	const replies: ServerMessage[] = [];
	docs.handle({ type: "doc.open", path: "a.md", client: "p" }, (m) => replies.push(m));
	const state = replies[0] as Extract<ServerMessage, { type: "doc.state" }>;
	docs.handle({ type: "doc.patch", path: "a.md", client: "p", rev: state.rev, batch: "b", splices: [{ at: 3, before: "", text: "!" }] }, (m) => replies.push(m));
	docs.handle({ type: "doc.restore", path: "a.md", client: "p", sha: "zzz" }, (m) => replies.push(m));
	assert.deepEqual(replies.map((m) => m.type), ["doc.state", "doc.patched", "notice"]);
	assert.equal(readFileSync(join(root, "a.md"), "utf8"), "one!\n");
	assert.equal(changed(sent).length, 1);
	done();
});

test("a page from before a restart is told to open again", () => {
	const { root, docs, done } = setup();
	writeFileSync(join(root, "a.md"), "x\n");
	const state = docs.opened("a.md", "p");
	const answer = docs.patch("a.md", "p", state.rev + 10_000, "b", [{ at: 0, before: "", text: "y" }]);
	assert.deepEqual(answer.refused, [0]);
	assert.equal(readFileSync(join(root, "a.md"), "utf8"), "x\n");
	assert.equal(answer.text, "x\n", "the refusal carries the text, so the page resyncs without asking");
	done();
});

test("typesetting runs one at a time per document, and says where the PDF is", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "decks-compile-")));
	writeFileSync(join(root, "paper.tex"), "\\documentclass{article}\n");
	let running = 0;
	let most = 0;
	const docs = new DocService({
		resolve: (path) => ({ file: join(root, path), key: path, writable: true }),
		versions: new MemoryVersions(),
		send: () => {},
		compile: async (job) => {
			running++;
			most = Math.max(most, running);
			await new Promise((r) => setTimeout(r, 30));
			running--;
			return { ok: true, pdf: join(job.out, "paper.pdf"), errors: [] };
		},
	});
	docs.opened("paper.tex", "page-a");
	const [a, b] = await Promise.all([docs.compile("paper.tex"), docs.compile("paper.tex")]);
	assert.equal(most, 1);
	assert.equal(a.pdf, "build/paper.pdf");
	assert.ok(b.ok);
	assert.match((await docs.compile("nope.tex")).error ?? "", /not open/);
	docs.closeAll();
	rmSync(root, { recursive: true, force: true });
});

test("what a git pull writes is taken in as a change credited to the remote, and typing reaches the file before it", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "decks-git-service-")));
	writeFileSync(join(root, "paper.tex"), "one\n\ntwo\n");
	const sent: ServerMessage[] = [];
	let seenByPull = "";
	const docs = new DocService({
		resolve: (path) => ({ file: join(root, path), key: path, writable: true }),
		versions: new MemoryVersions(),
		send: (m) => sent.push(m),
		writer: () => "some agent",
		git: {
			status: async () => ({ branch: "master", upstream: "origin/master", label: "Overleaf", ahead: 0, behind: 0, changed: 0 }),
			pull: async (file) => {
				seenByPull = readFileSync(file, "utf8");
				writeFileSync(file, readFileSync(file, "utf8").replace("two", "two, from Overleaf"));
				return { ok: true, message: "Pulled 1 commit from Overleaf." };
			},
			push: async () => ({ ok: true, message: "Pushed." }),
		},
	});
	const state = docs.opened("paper.tex", "p");
	docs.patch("paper.tex", "p", state.rev, "b1", [{ at: 3, before: "", text: " typed" }]);
	assert.deepEqual(await docs.git("paper.tex", "status"), { type: "doc.repo", path: "paper.tex", action: "status", ok: true, status: { branch: "master", upstream: "origin/master", label: "Overleaf", ahead: 0, behind: 0, changed: 0 } });
	const pulled = await docs.git("paper.tex", "pull");
	assert.equal(pulled.ok, true);
	assert.equal(seenByPull, "one typed\n\ntwo\n", "the typing was in the file when git ran");
	const change = changed(sent).find((m) => m.change)?.change;
	assert.equal(change?.by, "Overleaf");
	assert.equal(change?.splices.map((s) => s.text).join(""), ", from Overleaf");
	docs.closeAll();
	rmSync(root, { recursive: true, force: true });
});
