import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../../protocol/index.ts";
import { toDeckPath as p, type Deck, type FileChange } from "./types.ts";

// The Deck's promises as one suite, for any deck with history: the memory
// and folder decks here, Studio's own deck there. make() gets the files to
// seed and gives the deck and a way to clean up.

const ann: Caller = { kind: "agent", id: "ann", name: "Ann" };
const enc = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A deck with its history methods, as the kernel wraps every deck. */
export type SuiteDeck = Deck & Required<Pick<Deck, "revisions" | "readAt" | "restore">> & { restoreAll(rev: number, by: Caller): Promise<number> };
/** outside: a fresh absolute folder to mount, for a deck that can mount. */
export type MadeDeck = { deck: SuiteDeck; done(): Promise<void>; outside?(): Promise<string> };

type Run = (title: string, body: (deck: SuiteDeck, made: MadeDeck) => Promise<void>, files?: Record<string, string>) => void;

export function deckSuite(name: string, make: (files: Record<string, string>) => Promise<MadeDeck>): void {
	const run: Run = (title, body, files = {}) =>
		test(`${name}: ${title}`, async () => {
			const made = await make(files);
			try {
				await body(made.deck, made);
			} finally {
				await made.done();
			}
		});
	fileCases(run);
	historyCases(run);
	mountCases(run);
}

function fileCases(run: Run): void {
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
}

function historyCases(run: Run): void {
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

function mountCases(run: Run): void {
	run("a mounted app's files live in its folder, outlive an unmount and show wherever it is mounted", async (deck, made) => {
		if (!deck.mount || !made.outside) return;
		const folder = await made.outside();
		deck.mount(p("apps/notes"), folder);
		await deck.write(p("apps/notes/app.js"), enc("one"), ann);
		assert.deepEqual((await deck.list(p("apps"))).map((e) => `${e.kind}:${e.path}`), ["dir:apps/local", "dir:apps/notes"]);
		assert.deepEqual((await deck.list(p("apps/notes"))).map((e) => e.path), ["apps/notes/app.js"]);
		deck.unmount?.(p("apps/notes"));
		await assert.rejects(deck.read(p("apps/notes/app.js")), { code: "not_found" });
		deck.mount(p("apps/other"), folder);
		assert.equal(text(await deck.read(p("apps/other/app.js"))), "one");
		assert.equal(text(await deck.read(p("apps/local/app.json"))), "{}");
	}, { "apps/local/app.json": "{}" });

	run("a mounted app is not deleted or moved through the deck; its files are, and history keeps them", async (deck, made) => {
		if (!deck.mount || !made.outside) return;
		deck.mount(p("apps/notes"), await made.outside());
		const first = await deck.write(p("apps/notes/a.txt"), enc("a"), ann);
		await assert.rejects(deck.remove(p("apps/notes"), ann), { code: "refused" });
		await assert.rejects(deck.move(p("apps/notes"), p("apps/n2"), ann), { code: "refused" });
		await deck.move(p("apps/notes/a.txt"), p("apps/notes/b.txt"), ann);
		assert.equal(text(await deck.read(p("apps/notes/b.txt"))), "a");
		await deck.remove(p("apps/notes/b.txt"), ann);
		assert.equal(text(await deck.readAt(p("apps/notes/a.txt"), first.rev)), "a");
	});
}
