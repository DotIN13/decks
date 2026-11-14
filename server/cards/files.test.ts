import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "../kernel/testing.ts";
import { cards } from "./feature.ts";
import { applyEdits, globToRegex } from "./files.ts";

// The README's rules 1 to 8, as calls on an in-memory deck.

const ann = callers.agent("ann", "a");
const seed = { "canvases/a/canvas.pen": "{}", "docs/notes.md": "one\ntwo\nthree\n", "lib/card.css": "x", "assets/a.png": "png" };
const start = () => testServer({ features: [cards()], deck: seed });
const code = async (s: Awaited<ReturnType<typeof start>>, name: string, args: Record<string, unknown>, as: Parameters<typeof s.call>[2] = ann) => {
	const answer = await s.call(name, args, as);
	return answer.ok ? "ok" : answer.error.code;
};

test("rule 1: outside the deck or hidden is refused, with a sentence", async () => {
	const s = await start();
	for (const path of ["../x", "/etc/passwd", ".decks/server.json", "docs/.git/config", "C:/x", "a/../../x"]) {
		const answer = await s.call("file.read", { path }, ann);
		assert.equal(answer.ok, false, path);
		if (!answer.ok) {
			assert.equal(answer.error.code, "refused", path);
			assert.match(answer.error.message, /\.$/);
		}
	}
	assert.equal(await code(s, "file.write", { path: ".decks/x", text: "" }), "refused");
	await s.close();
});

test("rule 2: a write carries its author, and answers the file as it now is", async () => {
	const s = await start();
	const wrote = await s.value<{ path: string; rev: number; by: string; size: number }>("file.write", { path: "docs/new.md", text: "hello" }, ann);
	assert.equal(wrote.path, "docs/new.md");
	assert.equal(wrote.by, "ann");
	assert.equal(wrote.size, 5);
	const history = await s.deck.revisions!(wrote.path as never);
	assert.equal(history.at(-1)?.by, "ann");
	assert.equal((await s.value<{ text: string }>("file.read", { path: "docs/new.md" })).text, "hello");
	await s.close();
});

test("rule 3: a write on an old revision is a conflict", async () => {
	const s = await start();
	const { rev } = await s.value<{ rev: number }>("file.read", { path: "docs/notes.md" });
	await s.value("file.write", { path: "docs/notes.md", text: "changed", rev }, ann);
	assert.equal(await code(s, "file.write", { path: "docs/notes.md", text: "again", rev }), "conflict");
	assert.equal(await code(s, "file.edit", { path: "docs/notes.md", edits: [{ find: "changed", replace: "x" }], rev }), "conflict");
	await s.close();
});

test("rule 4: edits are exact, all or none", () => {
	assert.equal(applyEdits("f", "a b a", [{ find: "b", replace: "c" }]), "a c a");
	assert.equal(applyEdits("f", "a b a", [{ find: "a", replace: "z", all: true }]), "z b z");
	assert.equal(applyEdits("f", "a $1 b", [{ find: "$1", replace: "$&" }]), "a $& b");
	assert.throws(() => applyEdits("f", "a b a", [{ find: "a", replace: "z" }]), { code: "conflict" });
	assert.throws(() => applyEdits("f", "a b", [{ find: "b", replace: "c" }, { find: "q", replace: "r" }]), { code: "not_found" });
});

test("rule 4: a failed edit changes nothing", async () => {
	const s = await start();
	assert.equal(await code(s, "file.edit", { path: "docs/notes.md", edits: [{ find: "one", replace: "1" }, { find: "nine", replace: "9" }] }), "not_found");
	assert.equal((await s.value<{ text: string }>("file.read", { path: "docs/notes.md" })).text, "one\ntwo\nthree\n");
	await s.close();
});

test("rule 5: part of a file by lines", async () => {
	const s = await start();
	const part = await s.value<{ text: string; truncated?: boolean }>("file.read", { path: "docs/notes.md", from: 2, lines: 1 });
	assert.deepEqual(part.text, "two");
	assert.equal(part.truncated, true);
	await s.close();
});

test("rule 6: find by glob and grep by expression, never in lib/", async () => {
	const s = await start();
	const found = await s.value<{ path: string }[]>("file.find", { pattern: "*.css" });
	assert.deepEqual(found, []);
	assert.deepEqual((await s.value<{ path: string }[]>("file.find", { pattern: "**/*.md" })).map((f) => f.path), ["docs/notes.md"]);
	assert.deepEqual((await s.value<{ path: string }[]>("file.find", { pattern: "*.css", path: "lib" })).map((f) => f.path), ["lib/card.css"]);
	assert.deepEqual(await s.value("file.grep", { pattern: "^t", path: "docs" }), [
		{ path: "docs/notes.md", line: 2, text: "two" },
		{ path: "docs/notes.md", line: 3, text: "three" },
	]);
	assert.equal(await code(s, "file.grep", { pattern: "(" }), "invalid");
	assert.ok(globToRegex("cards/*/index.html").test("cards/x/index.html"));
	assert.ok(!globToRegex("cards/*/index.html").test("cards/x/y/index.html"));
	await s.close();
});

test("rule 7: move and delete a file or a folder", async () => {
	const s = await start();
	const moved = await s.value<{ path: string }>("file.move", { path: "docs", to: "papers" }, ann);
	assert.equal(moved.path, "papers");
	assert.equal(await code(s, "file.read", { path: "docs/notes.md" }), "not_found");
	assert.deepEqual(await s.value("file.delete", { path: "papers/notes.md" }, ann), { deleted: "papers/notes.md" });
	assert.equal(await code(s, "file.read", { path: "papers/notes.md" }), "not_found");
	await s.close();
});

test("rule 8: a file's address, and a card may read but not write", async () => {
	const s = await start();
	assert.equal(await s.value("file.url", { path: "assets/a.png" }), "/files/assets/a.png");
	assert.equal(await code(s, "file.read", { path: "docs/notes.md" }, "card"), "ok");
	assert.equal(await code(s, "file.write", { path: "docs/notes.md", text: "" }, "card"), "refused");
	await s.close();
});
