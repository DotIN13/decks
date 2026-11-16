import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "../../protocol/index.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { MemoryStore } from "../kernel/store.ts";
import { documents } from "./feature.ts";
import type { DocsRemote } from "./google.ts";
import { merge3, syncOnce } from "./links.ts";
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

class FakeLibrary extends FakeDocs {
	async list(query?: string) {
		const all = [{ id: "1abcdefghijklmnopqrstuvwxyz", title: "Field notes", url: "https://docs.google.com/document/d/1abcdefghijklmnopqrstuvwxyz/edit" }];
		return all.filter((d) => !query || d.title.toLowerCase().includes(query.toLowerCase()));
	}
	async title() {
		return "Field notes";
	}
	async markdown() {
		return { text: this.text, revision: String(this.revision), title: "Field notes" };
	}
	notes: Array<{ id: string; content: string; quote?: string }> = [];
	async document() {
		return { documentId: "doc", title: "Field notes" };
	}
	async style(_id: string, requests: unknown[]) {
		if (requests.length) this.text = this.text.replace("Google", "GOOGLE"), this.revision++;
	}
	async comments() {
		return this.notes;
	}
	async comment(_id: string, action: string, fields: { content?: string; quote?: string; comment?: string }) {
		if (action === "create") this.notes.push({ id: `n${this.notes.length + 1}`, content: fields.content ?? "", ...(fields.quote ? { quote: fields.quote } : {}) });
		if (action === "resolve") this.notes = this.notes.filter((n) => n.id !== fields.comment);
	}
	async writeMarkdown(_id: string, markdown: string, revision: string) {
		if (revision !== String(this.revision)) throw new Refused("conflict", "The Doc moved.");
		this.text = markdown;
		this.revision++;
	}
}

test("google.list and google.link: the mirror is made once, and syncs while a page has it open", async () => {
	const remote = new FakeLibrary("From Google\n");
	const s = await testServer({ features: [documents({ docs: remote, tickMs: 10 })] });
	assert.equal((await s.value<unknown[]>("google.list", { query: "field" }, "person")).length, 1);
	assert.deepEqual(await s.value("google.list", { query: "nothing" }, "person"), []);
	const url = "https://docs.google.com/document/d/1abcdefghijklmnopqrstuvwxyz/edit";
	const made = await s.value<{ path: string; by: string }>("google.link", { url }, "person");
	assert.equal(made.path, "docs/google/field-notes-1abcde.md");
	assert.equal(made.by, "google");
	assert.equal((await s.value<{ path: string }>("google.link", { url }, "person")).path, made.path);
	const opened = await s.value<{ rev: number; text: string; remote?: { url: string; title?: string } }>("file.open", { path: made.path, client: "p" }, "person");
	assert.equal(opened.text, "From Google\n");
	assert.deepEqual(opened.remote, { url, title: "Field notes" });
	await s.value("file.splice", { path: made.path, client: "p", rev: opened.rev, batch: "1", splices: [{ at: 11, before: "", text: ", typed" }] }, "person");
	remote.text = "From Google Docs\n";
	remote.revision++;
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(remote.text, "From Google Docs, typed\n");
	const state = await s.value<{ text: string; changes: { by: string }[] }>("file.open", { path: made.path, client: "p" }, "person");
	assert.equal(state.text, "From Google Docs, typed\n");
	assert.deepEqual(state.changes.map((c) => c.by), ["google"]);
	assert.equal((await s.call("google.link", { url: "not a doc" }, "person")).ok, false);
	await s.close();
});

test("without the Docs API, list and link answer unavailable", async () => {
	const s = await testServer({ features: [documents()] });
	for (const [name, args] of [["google.list", {}], ["google.link", { url: "https://docs.google.com/document/d/x/edit" }]] as const) {
		const answer = await s.call(name, args, "person");
		assert.equal(answer.ok ? "ok" : answer.error.code, "unavailable", name);
	}
	await s.close();
});

test("rule 13: an agent reads a Doc and edits one exact piece; the change reaches the mirror as theirs", async () => {
	const remote = new FakeLibrary("Alpha beta\nGamma beta\n");
	const s = await testServer({ features: [documents({ docs: remote, tickMs: 10 })] });
	const url = "https://docs.google.com/document/d/1abcdefghijklmnopqrstuvwxyz/edit";
	const { path } = await s.value<{ path: string }>("google.link", { url }, "person");
	await s.value("file.open", { path, client: "p" }, "person");
	const read = await s.value<{ doc: string; title?: string; text: string }>("google.read", { doc: url }, "agent");
	assert.deepEqual(read, { doc: "1abcdefghijklmnopqrstuvwxyz", title: "Field notes", text: "Alpha beta\nGamma beta\n" });
	const twice = await s.call("google.edit", { doc: url, old: "beta", new: "delta" }, "agent");
	assert.equal(twice.ok ? "ok" : twice.error.code, "invalid");
	const done = await s.value<{ text: string }>("google.edit", { doc: "1abcdefghijklmnopqrstuvwxyz", old: "Gamma beta", new: "Gamma delta" }, callers.agent("ann"));
	assert.equal(done.text, "Alpha beta\nGamma delta\n");
	await new Promise((r) => setTimeout(r, 60));
	const state = await s.value<{ text: string; changes: { by: string }[] }>("file.open", { path, client: "p" }, "person");
	assert.equal(state.text, "Alpha beta\nGamma delta\n");
	assert.deepEqual(state.changes.map((c) => c.by), ["ann"]);
	await s.close();
});

test("rule 15: a page's calls by its mirror: the Doc, a style pulled into the mirror, comments, the sync's state", async () => {
	const remote = new FakeLibrary("From Google\n");
	const s = await testServer({ features: [documents({ docs: remote, tickMs: 10 })] });
	const url = "https://docs.google.com/document/d/1abcdefghijklmnopqrstuvwxyz/edit";
	const { path } = await s.value<{ path: string }>("google.link", { url }, "person");
	const got = await s.value<{ document: { title: string }; text: string }>("google.get", { path }, "person");
	assert.deepEqual([got.document.title, got.text], ["Field notes", "From Google\n"]);
	const styled = await s.value<{ rev: number }>("google.style", { path, requests: [{ updateTextStyle: {} }] }, "person");
	assert.ok(styled.rev > 0);
	assert.equal((await s.value<{ text: string }>("file.open", { path, client: "p" }, "person")).text, "From GOOGLE\n");
	const after = await s.value<{ id: string }[]>("google.comment", { path, action: "create", content: "Why?", quote: "From" }, "person");
	assert.equal(after.length, 1);
	assert.deepEqual(await s.value("google.comment", { path, action: "resolve", comment: after[0]!.id }, "person"), []);
	assert.equal((await s.call("google.get", { path: "docs/other.md" }, "person")).ok, false);
	await new Promise((r) => setTimeout(r, 40));
	const told = s.heard.filter((e) => e.name === "file.changed").map((e) => e.payload as { part?: string; remote?: { state: string } }).find((p) => p.part === "remote");
	assert.equal(told?.remote?.state, "synced");
	await s.close();
});
