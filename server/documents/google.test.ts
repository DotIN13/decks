import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "../../protocol/index.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { MemoryStore } from "../kernel/store.ts";
import { documents } from "./feature.ts";
import { merge3, syncOnce, type DocsRemote } from "./google.ts";
import { applyAll } from "./splice.ts";

// Google Docs: a mirror kept in step with its Doc, and the sign-in seam.

class FakeDocs implements DocsRemote {
	revision = 1;
	constructor(public text: string) {}
	async read() {
		return { text: this.text, revision: String(this.revision) };
	}
	async write(_id: string, splices: Parameters<DocsRemote["write"]>[1], revision: string) {
		if (revision !== String(this.revision)) throw new Refused("conflict", "The Doc moved.");
		this.text = applyAll(this.text, splices)!;
		return { revision: String(++this.revision) };
	}
}

const google = callers.app("google");
const enc = new TextEncoder();
const text = async (deck: MemoryDeck) => new TextDecoder().decode(await deck.read("docs/g/mirror.md" as never));

test("a mirror pulls the Doc first, then pushes its own typing, then merges both ways", async () => {
	const remote = new FakeDocs("Title\nBody\n");
	const deck = new MemoryDeck({ "docs/g/mirror.md": "" });
	const store = new MemoryStore();
	const link = { id: "doc1", mirror: "docs/g/mirror.md" as never };
	assert.equal(await syncOnce(link, remote, deck, store, google), "pulled");
	assert.equal(await text(deck), "Title\nBody\n");
	assert.equal(await syncOnce(link, remote, deck, store, google), "same");
	await deck.write(link.mirror, enc.encode("Title\nBody, typed here\n"), callers.person);
	assert.equal(await syncOnce(link, remote, deck, store, google), "pushed");
	assert.equal(remote.text, "Title\nBody, typed here\n");
	remote.text = "A title\nBody, typed here\n";
	remote.revision++;
	await deck.write(link.mirror, enc.encode("Title\nBody, typed here\nMore\n"), callers.person);
	assert.equal(await syncOnce(link, remote, deck, store, google), "both");
	assert.equal(await text(deck), "A title\nBody, typed here\nMore\n");
	assert.equal(remote.text, "A title\nBody, typed here\nMore\n");
});

test("merge3 keeps both sides' words", () => {
	assert.equal(merge3("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n"), "A\nb\nC\n");
	assert.equal(merge3("x", "x", "y"), "y");
	assert.equal(merge3("x", "z", "x"), "z");
});

test("with a sign-in given, the google calls answer it; when it throws, unavailable", async () => {
	let connected = false;
	const account = {
		status: async () => ({ connected, ...(connected ? { email: "a@b.c" } : {}) }),
		connect: async () => ((connected = true), { connected, email: "a@b.c" }),
		disconnect: async () => {
			throw new Error("network down");
		},
	};
	const s = await testServer({ features: [documents({ google: account })] });
	assert.deepEqual(await s.value("google.status", {}, "person"), { connected: false });
	assert.deepEqual(await s.value("google.connect", { url: "https://x/?code=1" }, "person"), { connected: true, email: "a@b.c" });
	const answer = await s.call("google.disconnect", {}, "person");
	assert.equal(answer.ok ? "ok" : answer.error.code, "unavailable");
	assert.equal((await s.call("google.status", {}, "agent")).ok, false);
	await s.close();
});
