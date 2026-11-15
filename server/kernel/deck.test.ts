import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Caller } from "../../protocol/index.ts";
import { FolderDeck } from "./deck.ts";
import { folderStores } from "./disk.ts";
import { HistoryDeck } from "./history.ts";
import { deckSuite } from "./deck-suite.ts";
import { MemoryDeck } from "./memory-deck.ts";
import { memoryStores } from "./store.ts";
import { toDeckPath as p, type Deck, type FileChange } from "./types.ts";

// The Deck's promises (deck-suite.ts) run against the in-memory deck and the
// deck on a folder, each wrapped in history as the kernel wraps it; then the
// folder deck's own.

const ann: Caller = { kind: "agent", id: "ann", name: "Ann" };
const enc = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
type Made = { deck: HistoryDeck; done(): Promise<void>; outside?(): Promise<string> };

async function folder(files: Record<string, string>): Promise<Made> {
	const root = await mkdtemp(join(tmpdir(), "keel-deck-"));
	for (const [path, body] of Object.entries(files)) {
		await mkdir(join(root, path, ".."), { recursive: true });
		await writeFile(join(root, path), body);
	}
	const inner = new FolderDeck(root);
	const deck = new HistoryDeck(inner, folderStores(root)("history"));
	await deck.load();
	const outsides: string[] = [];
	const outside = async () => {
		const one = await mkdtemp(join(tmpdir(), "keel-app-"));
		outsides.push(one);
		return one;
	};
	const done = async () => {
		inner.close();
		for (const one of [root, ...outsides]) await rm(one, { recursive: true, force: true });
	};
	return { deck, done, outside };
}

async function memory(files: Record<string, string>): Promise<Made> {
	const deck = new HistoryDeck(new MemoryDeck(files), memoryStores()("history"));
	await deck.load();
	let n = 0;
	return { deck, done: async () => {}, outside: async () => `/outside/app-${++n}` };
}

deckSuite("memory", memory);
deckSuite("folder", folder);

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

test("folder: a file read before the disk changes it keeps its old words, each change recorded once", async () => {
	const made = await folder({ "a.txt": "before" });
	const root = (made.deck as unknown as { inner: FolderDeck }).inner.root;
	try {
		await made.deck.read(p("a.txt"));
		const stops = [made.deck.watch(() => {}), made.deck.watch(() => {}), made.deck.watch(() => {})];
		const heard = await new Promise<FileChange>((done) => {
			const stop = made.deck.watch((c) => (stop(), done(c)));
			setTimeout(() => void writeFile(join(root, "a.txt"), "outside"), 50);
		});
		assert.equal(text(await made.deck.readAt(p("a.txt"), heard.rev - 1)), "before");
		assert.equal((await made.deck.revisions(p("a.txt"))).length, 2);
		stops.forEach((stop) => stop());
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

test("the kernel says the deck's folder on a folder, and nothing in memory", async () => {
	const { buildKernel } = await import("./kernel.ts");
	const root = await mkdtemp(join(tmpdir(), "keel-folder-"));
	const inner = new FolderDeck(root);
	const onDisk = await buildKernel({ deck: inner, stores: memoryStores(), features: [] });
	assert.equal(onDisk.kernel.folder(), inner.root);
	const inMemory = await buildKernel({ deck: new MemoryDeck(), stores: memoryStores(), features: [] });
	assert.equal(inMemory.kernel.folder(), undefined);
	await rm(root, { recursive: true, force: true });
});

test("folder: a mount is fenced: no symlink out of the mounted folder, changes in it heard as by disk", async () => {
	const made = await folder({});
	const app = await made.outside!();
	try {
		made.deck.mount(p("apps/notes"), app);
		await symlink(tmpdir(), join(app, "out"));
		await assert.rejects(made.deck.read(p("apps/notes/out/x")), { code: "invalid" });
		const heard = await new Promise<FileChange>((done) => {
			const stop = made.deck.watch((c) => (stop(), done(c)));
			setTimeout(() => void writeFile(join(app, "edited.js"), "x"), 50);
		});
		assert.deepEqual([heard.path, heard.by], ["apps/notes/edited.js", "disk"]);
	} finally {
		await made.done();
	}
});

test("folder: an edit on the disk right after the server's own write is still told", async () => {
	const made = await folder({});
	const root = (made.deck as unknown as { inner: FolderDeck }).inner.root;
	try {
		const heard: FileChange[] = [];
		const stop = made.deck.watch((c) => heard.push(c));
		await made.deck.write(p("canvas.pen"), enc("ours"), ann);
		await writeFile(join(root, "canvas.pen"), "theirs");
		await new Promise((r) => setTimeout(r, 300));
		stop();
		assert.deepEqual(heard.map((c) => c.by), ["ann", "disk"]);
		assert.equal(text(await made.deck.read(p("canvas.pen"))), "theirs");
	} finally {
		await made.done();
	}
});
