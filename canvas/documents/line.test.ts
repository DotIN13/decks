import { test } from "node:test";
import assert from "node:assert/strict";
import { protocolLine } from "./line.ts";

// The page's messages on the protocol: each made into its call, and the socket's events told back.

function fakeServer(answers: Record<string, unknown>) {
	const calls: Array<[string, Record<string, unknown>]> = [];
	let hear: ((name: string, payload: Record<string, unknown>) => void) | undefined;
	const line = protocolLine(
		async (name, args) => (calls.push([name, args]), name in answers ? { ok: true, value: answers[name] } : { ok: false, error: `no ${name}` }),
		(listener) => ((hear = listener), () => (hear = undefined)),
	);
	const heard: Record<string, unknown>[] = [];
	const stop = line.listen((message) => heard.push(message as never));
	return { line, calls, heard, stop, event: (name: string, payload: Record<string, unknown>) => hear?.(name, payload), listening: () => hear !== undefined };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("opening, typing and versions become file.open, file.splice and file.versions", async () => {
	const s = fakeServer({ "file.open": { path: "docs/a.md", rev: 3, format: "text", text: "hi", changes: [] }, "file.splice": { rev: 4, refused: [] }, "file.versions": [{ sha: "new" }, { sha: "old" }] });
	s.line.send({ type: "doc.open", path: "docs/a.md", client: "c1" });
	await settle();
	assert.deepEqual(s.calls[0], ["file.open", { path: "docs/a.md", client: "c1" }]);
	assert.deepEqual(s.heard[0], { type: "doc.state", path: "docs/a.md", asked: "docs/a.md", client: "c1", rev: 3, format: "text", text: "hi", changes: [] });
	s.line.send({ type: "doc.patch", path: "docs/a.md", client: "c1", rev: 3, batch: "b1", splices: [{ at: 2, before: "", text: "!" }] });
	await settle();
	assert.deepEqual(s.calls[1], ["file.splice", { path: "docs/a.md", client: "c1", rev: 3, batch: "b1", splices: [{ at: 2, before: "", text: "!" }] }]);
	assert.deepEqual(s.heard[1], { type: "doc.patched", path: "docs/a.md", batch: "b1", rev: 4, refused: [] });
	s.line.send({ type: "doc.versions", path: "docs/a.md" });
	await settle();
	assert.deepEqual(s.heard[2], { type: "doc.versions", path: "docs/a.md", versions: [{ sha: "old" }, { sha: "new" }] }, "oldest first, as the page lists them");
});

test("file.changed and file.compiled for an open document are told as doc.changed and doc.compiled; others are not", async () => {
	const s = fakeServer({ "file.open": { path: "docs/a.md", rev: 1, format: "text", text: "", changes: [] } });
	s.line.send({ type: "doc.open", path: "docs/a.md", client: "c1" });
	await settle();
	s.event("file.changed", { ids: ["docs/other.md"], rev: 2, part: "words", splices: [] });
	s.event("file.changed", { ids: ["docs/a.md"], by: "ann", rev: 2, base: 1, part: "words", splices: [{ at: 0, before: "", text: "x" }], client: "c1", batch: "b1" });
	s.event("file.changed", { ids: ["docs/a.md"], by: "ann", rev: 3, part: "review", change: "ch1" });
	s.event("file.changed", { ids: ["docs/a.md"], by: "ann", rev: 3, part: "versions" });
	s.event("file.compiled", { ids: ["docs/a.md"], by: "x", rev: 3, ok: true, pdf: "p.pdf", errors: [], at: 5, ms: 9 });
	assert.deepEqual(s.heard.slice(1), [
		{ type: "doc.changed", path: "docs/a.md", base: 1, rev: 2, splices: [{ at: 0, before: "", text: "x" }], by: "ann", client: "c1", batch: "b1" },
		{ type: "doc.changed", path: "docs/a.md", base: undefined, rev: 3, splices: [], by: "ann", settled: ["ch1"] },
		{ type: "doc.compiled", path: "docs/a.md", ok: true, pdf: "p.pdf", errors: [], at: 5, ms: 9 },
	]);
});

test("a refused open says so as the page's error, and the last listener gone stops hearing the socket", async () => {
	const s = fakeServer({});
	s.line.send({ type: "doc.open", path: "docs/x.md", client: "c1" });
	await settle();
	assert.equal((s.heard[0] as { error?: string }).error, "no file.open");
	assert.equal(s.listening(), true);
	s.stop();
	assert.equal(s.listening(), false);
});
