import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import type { DocServerMessage } from "@decks/docs";
import { docUnits, FakeDocsApi, plan } from "@decks/docs/gdoc";
import { DocLibrary, DocService, MemoryVersions } from "@decks/docs/server";
import { GoogleDocs } from "./docs.ts";
import { docIdOf } from "./api.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A deck with a library, a document service, and Google Docs against the stand-in. */
function setup() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "decks-gdocs-")));
	process.env.DECKS_GOOGLE = "fake";
	const deck = join(root, "deck");
	const library = new DocLibrary(join(deck, "docs"));
	const sent: DocServerMessage[] = [];
	let google!: GoogleDocs;
	const docs = new DocService({
		resolve: (path) => {
			const file = resolve(deck, path);
			return { file, key: relative(deck, file), writable: true };
		},
		versions: new MemoryVersions(),
		library: () => library,
		send: (m) => sent.push(m),
		writer: (file) => google.writer(file),
		remote: (file) => google.remote(file),
		quietMs: 10,
	});
	google = new GoogleDocs({ dataDir: join(root, "data"), library: () => library, docs, send: (m) => sent.push(m) });
	const fake = new FakeDocsApi(join(root, "data", "google", "fake"));
	return { root, deck, docs, google, fake, sent, done: () => (docs.closeAll(), rmSync(root, { recursive: true, force: true }), delete process.env.DECKS_GOOGLE) };
}

test("a Doc is linked as a folder with its index-aligned mirror, and the page says it is a Google Doc", async () => {
	const { google, fake, docs, deck, done } = setup();
	await fake.create("abcdefghij12", "Draft", "# Draft\n\nFirst paragraph.\n");
	const mirror = await google.link("https://docs.google.com/document/d/abcdefghij12/edit");
	assert.equal(readFileSync(mirror, "utf8"), "\uE000Draft\nFirst paragraph.\n", "every character one of the Doc's indices");
	const state = docs.opened(relative(deck, mirror), "p");
	assert.deepEqual(state.remote, { kind: "google", title: "Draft", url: "https://docs.google.com/document/d/abcdefghij12/edit" });
	assert.equal(await google.link("abcdefghij12"), mirror, "linked again, the same folder");
	done();
});

test("typing on the page reaches the Doc, and a collaborator's edit comes back highlighted", async () => {
	const { google, fake, docs, deck, sent, done } = setup();
	await fake.create("abcdefghij12", "Draft", "# Draft\n\nFirst paragraph.\n\nSecond paragraph.\n");
	const mirror = await google.link("abcdefghij12");
	const path = relative(deck, mirror);
	const state = docs.opened(path, "p");
	// The person types into the mirror, as the page does: at the Doc's own index.
	const at = state.text.indexOf("First paragraph") + "First".length;
	docs.patch(state.path, "p", state.rev, "b1", [{ at, before: "", text: " good" }]);
	await google.sync({ id: "abcdefghij12", folder: join(deck, "docs", "draft"), mirror, title: "Draft", url: "" }, true);
	assert.match(fake.load("abcdefghij12").text(), /First good paragraph/);
	assert.ok(sent.some((m) => m.type === "doc.gdoc"), "the page is sent the Doc to draw");
	// A collaborator edits the Doc in Google.
	const doc = fake.load("abcdefghij12");
	doc.apply(plan(doc.toDocument(), "# Draft\n\nFirst good paragraph.\n\nSecond paragraph, from a collaborator.\n"));
	fake.save(doc);
	await google.sync({ id: "abcdefghij12", folder: join(deck, "docs", "draft"), mirror, title: "Draft", url: "" });
	await wait(150);
	docs.patch(state.path, "p", docs.opened(path, "p").rev, "b2", []);
	assert.match(readFileSync(mirror, "utf8"), /Second paragraph, from a collaborator\./);
	const change = sent.find((m): m is Extract<DocServerMessage, { type: "doc.changed" }> => m.type === "doc.changed" && !!m.change);
	assert.equal(change?.change?.by, "Google Docs");
	done();
});

test("an agent's edit through its tool lands in the Doc and on the page, credited to the agent", async () => {
	const { google, fake, docs, deck, sent, done } = setup();
	await fake.create("abcdefghij12", "Draft", "# Draft\n\nThe effect is small.\n");
	const mirror = await google.link("abcdefghij12");
	docs.opened(relative(deck, mirror), "p");
	const read = await google.tool("gdocs_read", { doc: "abcdefghij12" }, "Rune");
	assert.match(read.text, /The effect is small\./);
	const edit = await google.tool("gdocs_edit", { doc: "https://docs.google.com/document/d/abcdefghij12/edit", old: "is small", new: "is **small but steady**" }, "Rune");
	assert.equal(edit.isError, false, edit.text);
	assert.match(fake.load("abcdefghij12").text(), /small but steady/);
	await wait(300);
	assert.match(readFileSync(mirror, "utf8"), /small but steady/);
	await wait(150);
	docs.patch(relative(deck, mirror), "p", docs.opened(relative(deck, mirror), "p").rev, "b", []);
	const change = sent.find((m): m is Extract<DocServerMessage, { type: "doc.changed" }> => m.type === "doc.changed" && !!m.change);
	assert.equal(change?.change?.by, "Rune");
	assert.equal((await google.tool("gdocs_edit", { doc: "abcdefghij12", old: "not there", new: "x" }, "Rune")).isError, true);
	done();
});

test("a Doc's id is found in any address a person pastes", () => {
	assert.equal(docIdOf("https://docs.google.com/document/d/1AbC-dEf_ghIJkl/edit?usp=sharing"), "1AbC-dEf_ghIJkl");
	assert.equal(docIdOf("https://docs.google.com/document/u/1/d/1AbC-dEf_ghIJkl/view"), "1AbC-dEf_ghIJkl");
	assert.equal(docIdOf("not a doc"), undefined);
});

test("a style set on the page reaches Google at the page's indices, after the typing before it", async () => {
	const { google, fake, docs, deck, done } = setup();
	await fake.create("abcdefghij12", "Draft", "# Draft\n\nMake this bold.\n");
	const mirror = await google.link("abcdefghij12");
	const state = docs.opened(relative(deck, mirror), "p");
	docs.patch(state.path, "p", state.rev, "b1", [{ at: 1, before: "", text: "Now: " }]);
	const page = readFileSync(mirror, "utf8");
	const from = page.indexOf("bold");
	await google.style(mirror, [{ updateTextStyle: { range: { startIndex: from, endIndex: from + 4 }, textStyle: { bold: true }, fields: "bold" } }]);
	const doc = fake.load("abcdefghij12").toDocument();
	assert.equal(docUnits(doc), page);
	const bold = doc.body!.content!.flatMap((e) => e.paragraph?.elements ?? []).filter((e) => e.textRun?.textStyle?.bold).map((e) => e.textRun!.content);
	assert.deepEqual(bold, ["bold"]);
	done();
});
