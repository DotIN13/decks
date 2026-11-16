// Google Docs on today's line, on a fake line: a mirror's Doc and comments when opened, again on Google's
// words and every few seconds, its link's state with the account, and nothing once it is closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DocLine } from "./docs.ts";
import { mirrorChanged, mirrorClosed, mirrorOpened } from "./google.ts";

const path = "docs/google/plan.md";

function fakeLine(answers: Record<string, unknown>) {
	const sent: Array<Record<string, unknown>> = [];
	const asked: string[] = [];
	const line = {
		state: { caller: { kind: "person", id: "person" }, watched: new Map(), clients: new Set(["page-a"]) },
		door: { call: async (name: string) => (asked.push(name), name in answers ? { ok: true, value: answers[name], notes: [] } : { ok: false, error: { code: "refused", message: "no" }, notes: [] }) },
		send: (m: Record<string, unknown>) => sent.push(m),
		client: { id: "c" },
	} as unknown as DocLine;
	return { line, sent, asked };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test("a mirror opened gets its Doc and comments; closed, its comments stop being read", async () => {
	const { line, sent } = fakeLine({ "google.get": { path, document: { body: 1 }, text: "Hi" }, "google.comments": [{ id: "k" }] });
	mirrorOpened(line, path);
	await settle();
	assert.deepEqual(sent.map((m) => m.type).sort(), ["doc.gcomments", "doc.gdoc"]);
	assert.deepEqual(sent.find((m) => m.type === "doc.gdoc"), { type: "doc.gdoc", path, document: { body: 1 }, text: "Hi" });
	mirrorClosed(line, path);
	assert.equal(line.state.watched.has(`google:${path}`), false);
});

test("only Google's words bring the Doc again, not this line's own typing; the link's state comes with the account", async () => {
	const { line, sent, asked } = fakeLine({ "google.get": { path, document: {}, text: "" }, "google.comments": [], "google.status": { connected: true, email: "a@b.c" } });
	mirrorOpened(line, path);
	await settle();
	sent.length = 0;
	asked.length = 0;
	mirrorChanged(line, { ids: [path], part: "words", client: "page-a" });
	await settle();
	assert.deepEqual(asked, [], "this line's own typing");
	mirrorChanged(line, { ids: [path], part: "words" });
	mirrorChanged(line, { ids: [path], part: "remote", remote: { state: "synced", at: 3 } });
	await settle();
	assert.deepEqual(sent.find((m) => m.type === "doc.remote"), { type: "doc.remote", path, status: { state: "synced", at: 3, email: "a@b.c" } });
	assert.ok(sent.some((m) => m.type === "doc.gdoc"));
	mirrorClosed(line, path);
});
