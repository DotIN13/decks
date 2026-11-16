// Documents on today's line: a page opens a document and types into it, and another page on it hears the words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { features } from "../main.ts";
import { testServer } from "../kernel/testing.ts";
import { docChanged, docCompiled } from "./docs.ts";

type Said = Record<string, unknown>;

function openLine(url: string) {
	const ws = new WebSocket(`${url.replace("http", "ws")}/compat/v1/socket`);
	const heard: Said[] = [];
	ws.onmessage = (m) => heard.push(JSON.parse(String(m.data)) as Said);
	const opened = new Promise((done) => (ws.onopen = done));
	return {
		send: (m: Said) => void opened.then(() => ws.send(JSON.stringify(m))),
		async next(type: string, test: (m: Said) => boolean = () => true): Promise<Said> {
			for (let i = 0; i < 100; i++) {
				const at = heard.findIndex((m) => m.type === type && test(m));
				if (at >= 0) return heard.splice(at, 1)[0]!;
				await new Promise((r) => setTimeout(r, 50));
			}
			throw new Error(`no ${type}; heard ${JSON.stringify(heard).slice(0, 300)}`);
		},
		close: () => ws.close(),
	};
}

test("a page opens a document, types into it, and another page on it hears the words", async () => {
	const server = await testServer({ features: features(), deck: { "canvases/plan/canvas.pen": '{"version":"2.14","children":[]}', "canvases/plan/files/notes.md": "Hello\n" } });
	const doors = await server.listen(0);
	const path = "canvases/plan/files/notes.md";
	const [a, b] = [openLine(doors.url), openLine(doors.url)];
	for (const line of [a, b]) {
		line.send({ type: "line.hello", token: doors.token });
		await line.next("line.hello");
	}
	a.send({ type: "doc.open", path, client: "page-a" });
	b.send({ type: "doc.open", path, client: "page-b" });
	const state = await a.next("doc.state");
	assert.equal(state.text, "Hello\n", JSON.stringify(state));
	await b.next("doc.state");
	a.send({ type: "doc.patch", path, client: "page-a", rev: state.rev, batch: "a1", splices: [{ at: 5, before: "", text: ", world" }] });
	const patched = await a.next("doc.patched");
	assert.deepEqual([patched.batch, patched.refused], ["a1", []]);
	const changed = await b.next("doc.changed");
	assert.deepEqual([changed.path, changed.client, changed.batch, changed.splices], [path, "page-a", "a1", [{ at: 5, before: "", text: ", world" }]]);
	b.send({ type: "doc.versions", path });
	assert.ok(Array.isArray((await b.next("doc.versions")).versions));
	a.send({ type: "doc.gstyle", path, client: "page-a", requests: [] });
	assert.match(String((await a.next("harness.notice")).text), /not on this server yet/);
	for (const line of [a, b]) line.close();
	await doors.close();
	await server.close();
});

test("a document that cannot open answers its state with the error, empty", async () => {
	const server = await testServer({ features: features(), deck: { "canvases/plan/canvas.pen": '{"version":"2.14","children":[]}' } });
	const doors = await server.listen(0);
	const line = openLine(doors.url);
	line.send({ type: "line.hello", token: doors.token });
	await line.next("line.hello");
	line.send({ type: "doc.open", path: "canvases/plan/files/none.md", client: "page" });
	const state = await line.next("doc.state");
	assert.deepEqual([state.rev, state.text, state.changes], [0, "", []]);
	assert.ok(state.error);
	line.close();
	await doors.close();
	await server.close();
});

test("file.changed is told only for an open document's words or review, with the record as its change", () => {
	const open = new Set(["d.md"]);
	assert.equal(docChanged({ ids: ["other.md"], part: "words" }, open), undefined);
	assert.equal(docChanged({ ids: ["d.md"], part: "versions" }, open), undefined);
	const record = { id: "c1", by: "agent", at: 1, from: "a", to: "b", splices: [] };
	assert.deepEqual(docChanged({ ids: ["d.md"], part: "words", base: 1, rev: 2, splices: [{ at: 0, before: "", text: "x" }], by: "agent", record }, open), { type: "doc.changed", path: "d.md", base: 1, rev: 2, splices: [{ at: 0, before: "", text: "x" }], by: "agent", change: record });
	assert.deepEqual(docChanged({ ids: ["d.md"], part: "review", base: 2, rev: 3, by: "person", change: "c1" }, open)?.settled, ["c1"]);
});

test("a typesetting is told to the pages on its document, its PDF and errors as today's doc.compiled", () => {
	const open = new Set(["p.tex"]);
	assert.equal(docCompiled({ ids: ["other.tex"], ok: true }, open), undefined);
	assert.deepEqual(docCompiled({ ids: ["p.tex"], by: "a", rev: 3, ok: true, pdf: "p.pdf", errors: [], at: 9, ms: 120 }, open), { type: "doc.compiled", path: "p.tex", ok: true, pdf: "p.pdf", errors: [], at: 9, ms: 120 });
});

test("a git or compile the server refuses is answered to the page that asked", async () => {
	const server = await testServer({ features: features(), deck: { "canvases/plan/canvas.pen": '{"version":"2.14","children":[]}', "canvases/plan/files/p.tex": "x" } });
	const doors = await server.listen(0);
	const line = openLine(doors.url);
	line.send({ type: "line.hello", token: doors.token });
	await line.next("line.hello");
	line.send({ type: "doc.git", path: "canvases/plan/nowhere.tex", client: "page", action: "pull" });
	const repo = await line.next("doc.repo");
	assert.deepEqual([repo.action, repo.ok, typeof repo.message], ["pull", false, "string"]);
	line.send({ type: "doc.compile", path: "canvases/plan/nowhere.tex", client: "page" });
	const compiled = await line.next("doc.compiled");
	assert.deepEqual([compiled.ok, compiled.errors, typeof compiled.error], [false, [], "string"]);
	line.close();
	await doors.close();
	await server.close();
});
