import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Caller } from "../../protocol/index.ts";
import { FolderDeck } from "./deck.ts";
import { folderStores } from "./disk.ts";
import { HistoryDeck } from "./history.ts";
import { MemoryDeck } from "./memory-deck.ts";
import { memoryStores } from "./store.ts";
import { toDeckPath as p, type Deck, type FileChange } from "./types.ts";

// One file of the Deck's promises, run against the in-memory deck and the
// deck on a folder, each wrapped in history as the kernel wraps it.

const ann: Caller = { kind: "agent", id: "ann", name: "Ann" };
const enc = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
type Made = { deck: HistoryDeck; done(): Promise<void> };

async function folder(files: Record<string, string>): Promise<Made> {
	const root = await mkdtemp(join(tmpdir(), "keel-deck-"));
	for (const [path, body] of Object.entries(files)) {
		await mkdir(join(root, path, ".."), { recursive: true });
		await writeFile(join(root, path), body);
	}
	const inner = new FolderDeck(root);
	const deck = new HistoryDeck(inner, folderStores(root)("history"));
	await deck.load();
	return { deck, done: async () => (inner.close(), rm(root, { recursive: true, force: true })) };
}

async function memory(files: Record<string, string>): Promise<Made> {
	const deck = new HistoryDeck(new MemoryDeck(files), memoryStores()("history"));
	await deck.load();
	return { deck, done: async () => {} };
}

for (const [name, make] of [["memory", memory], ["folder", folder]] as const) {
	const run = (title: string, body: (deck: Deck & HistoryDeck) => Promise<void>, files: Record<string, string> = {}) =>
		test(`${name}: ${title}`, async () => {
			const made = await make(files);
			try {
				await body(made.deck);
			} finally {
				await made.done();
			}
		});

	run("a write is read back, with its author and a later revision", async (deck) => {
		const first = await deck.write(p("docs/a.md"), enc("hi"), ann);
		const second = await deck.write(p("docs/b.md"), enc("yo"), ann);
		assert.equal(first.by, "ann");
		assert.ok(second.rev > first.rev);
		assert.equal(text(await deck.read(p("docs/a.md"))), "hi");
	});

	run("a read of nothing, or of a folder, is not_found", async (deck) => {
		await assert.rejects(deck.read(p("x.md")), { code: "not_found" });
		await assert.rejects(deck.read(p("a")), { code: "not_found" });
	}, { "a/b.txt": "1" });

	run("list gives a folder's files and folders, once each, nothing hidden", async (deck) => {
		assert.deepEqual((await deck.list("")).map((e) => `${e.kind}:${e.path}`), ["dir:assets", "dir:canvases"]);
		assert.deepEqual((await deck.list(p("canvases/a"))).map((e) => `${e.kind}:${e.path}`), ["file:canvases/a/canvas.pen", "dir:canvases/a/cards"]);
		await assert.rejects(deck.list(p("nowhere")), { code: "not_found" });
	}, { "canvases/a/canvas.pen": "{}", "canvases/a/cards/x/index.html": "<p>", "assets/i.png": "png" });

	run("watchers hear writes and deletes until they stop", async (deck) => {
		const heard: FileChange[] = [];
		const stop = deck.watch((c) => heard.push(c));
		await deck.write(p("a.txt"), enc("1"), ann);
		await deck.remove(p("a.txt"), ann);
		stop();
		await deck.write(p("b.txt"), enc("1"), ann);
		assert.deepEqual(heard.map((c) => `${c.kind}:${c.path}:${c.by}`), ["written:a.txt:ann", "deleted:a.txt:ann"]);
	});

	run("remove and move take a whole folder", async (deck) => {
		await deck.move(p("cards/x"), p("cards/y"), ann);
		assert.equal(text(await deck.read(p("cards/y/c.js"))), "b");
		await assert.rejects(deck.read(p("cards/x/c.js")), { code: "not_found" });
		await deck.remove(p("cards/y"), ann);
		await assert.rejects(deck.read(p("cards/y/index.html")), { code: "not_found" });
	}, { "cards/x/index.html": "a", "cards/x/c.js": "b" });

	run("a write over a folder, or a move onto something, is a conflict", async (deck) => {
		await assert.rejects(deck.write(p("a"), enc(""), ann), { code: "conflict" });
		await assert.rejects(deck.move(p("a"), p("c.txt"), ann), { code: "conflict" });
	}, { "a/b.txt": "1", "c.txt": "2" });

	run("history reads any file at any revision, and restores it", async (deck) => {
		const one = await deck.write(p("doc.md"), enc("one"), ann);
		await deck.write(p("doc.md"), enc("two"), ann);
		const gone = await deck.remove(p("doc.md"), ann);
		assert.equal(text(await deck.readAt(p("doc.md"), one.rev)), "one");
		await assert.rejects(deck.readAt(p("doc.md"), gone.rev), { code: "not_found" });
		assert.equal((await deck.revisions(p("doc.md"))).length, 3);
		await deck.restore(p("doc.md"), one.rev, ann);
		assert.equal(text(await deck.read(p("doc.md"))), "one");
	});

	run("a file there before history began keeps its words after a remove", async (deck) => {
		const gone = await deck.remove(p("old.md"), ann);
		assert.equal(text(await deck.readAt(p("old.md"), gone.rev - 1)), "kept");
	}, { "old.md": "kept" });

	run("a file there before history began keeps its words after a write", async (deck) => {
		const done = await deck.write(p("old.md"), enc("new"), ann);
		assert.equal(text(await deck.readAt(p("old.md"), done.rev - 1)), "kept");
		assert.equal((await deck.revisions(p("old.md"))).length, 2);
	}, { "old.md": "kept" });

	run("the whole deck goes back to a revision", async (deck) => {
		const at = await deck.write(p("a.md"), enc("a1"), ann);
		await deck.write(p("a.md"), enc("a2"), ann);
		await deck.write(p("b.md"), enc("new"), ann);
		await deck.restoreAll(at.rev, ann);
		assert.equal(text(await deck.read(p("a.md"))), "a1");
		await assert.rejects(deck.read(p("b.md")), { code: "not_found" });
	});
}

test("folder: a change made on the disk is heard by disk and recorded", async () => {
	const made = await folder({ "a.txt": "1" });
	const root = (made.deck as unknown as { inner: FolderDeck }).inner.root;
	const heard = await new Promise<FileChange>((done) => {
		made.deck.watch((c) => done(c));
		setTimeout(() => void writeFile(join(root, "a.txt"), "outside"), 50);
	});
	try {
		assert.equal(heard.by, "disk");
		assert.equal(text(await made.deck.readAt(p("a.txt"), heard.rev)), "outside");
	} finally {
		await made.done();
	}
});

test("folder: a symlink out of the deck is refused, and a remove lands in the trash", async () => {
	const made = await folder({ "a.txt": "1" });
	const root = (made.deck as unknown as { inner: FolderDeck }).inner.root;
	await symlink(tmpdir(), join(root, "out"));
	await assert.rejects(made.deck.read(p("out/x")), { code: "invalid" });
	await made.deck.remove(p("a.txt"), ann);
	const { readdir } = await import("node:fs/promises");
	const [batch] = await readdir(join(root, ".decks", "trash"));
	assert.equal(await readFile(join(root, ".decks", "trash", batch!, "a.txt"), "utf8"), "1");
	await made.done();
});
