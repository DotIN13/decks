import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "../kernel/testing.ts";
import { documents } from "./feature.ts";
import { documentKind } from "./item.ts";

// The README's rules 1 to 10, as calls on an in-memory deck.

const ann = callers.agent("ann", "a");
const seed = { "canvases/a/canvas.pen": "{}", "docs/plan.md": "# Plan\n\nShip it.\n", "docs/data.bin": "x" };
const start = (pauseMs = 5) => testServer({ features: [documents({ pauseMs })], deck: seed });
type State = { rev: number; text: string; changes: { id: string; by: string; splices: unknown[] }[] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("rule 1 and 2: open fences the path and answers the words", async () => {
	const s = await start();
	const state = await s.value<State>("file.open", { path: "docs/plan.md", client: "p1" });
	assert.equal(state.text, "# Plan\n\nShip it.\n");
	assert.deepEqual(state.changes, []);
	for (const [path, code] of [[".decks/x.md", "refused"], ["../x.md", "refused"], ["docs/data.bin", "invalid"], ["docs/none.md", "not_found"]]) {
		const answer = await s.call("file.open", { path, client: "p1" });
		assert.equal(answer.ok ? "ok" : answer.error.code, code, path);
	}
	await s.close();
});

test("rule 3 and 4: typing lands, moves past an older revision, and is announced", async () => {
	const s = await start();
	const { rev } = await s.value<State>("file.open", { path: "docs/plan.md", client: "p1" });
	const one = await s.value<{ rev: number; refused: number[] }>("file.splice", { path: "docs/plan.md", client: "p1", rev, batch: "b1", splices: [{ at: 8, before: "Ship", text: "Build" }] });
	assert.deepEqual(one.refused, []);
	const late = await s.value<{ refused: number[] }>("file.splice", { path: "docs/plan.md", client: "p2", rev, batch: "b2", splices: [{ at: 0, before: "", text: "> " }] });
	assert.deepEqual(late.refused, []);
	const heard = s.heard.filter((e) => e.name === "file.changed").map((e) => e.payload as { part: string; client: string; by: string });
	assert.deepEqual(heard.map((p) => [p.part, p.client, p.by]), [["words", "p1", "person"], ["words", "p2", "person"]]);
	const state = await s.value<State>("file.open", { path: "docs/plan.md", client: "p3" });
	assert.equal(state.text, "> # Plan\n\nBuild it.\n");
	assert.equal((await s.deck.revisions!("docs/plan.md" as never)).at(-1)?.by, "person");
	await s.close();
});

test("rule 5: typing that pauses becomes a version; keystrokes before a pause do not", async () => {
	const s = await start(20);
	let { rev } = await s.value<State>("file.open", { path: "docs/plan.md", client: "p1" });
	for (const ch of "abc") ({ rev } = await s.value<{ rev: number }>("file.splice", { path: "docs/plan.md", client: "p1", rev, batch: ch, splices: [{ at: 0, before: "", text: ch }] }));
	await sleep(40);
	const versions = await s.value<{ sha: string }[]>("file.versions", { path: "docs/plan.md" });
	assert.equal(versions.length, 2, "the seed and the paused typing");
	assert.equal(versions[0]!.sha, String(rev));
	await s.close();
});

test("rule 6: a write from outside waits for review; reject takes it back, accept keeps it", async () => {
	const s = await start();
	await s.value("file.open", { path: "docs/plan.md", client: "p1" });
	await s.deck.write("docs/plan.md" as never, new TextEncoder().encode("# Plan\n\nShip it today.\n"), ann);
	const state = await s.value<State>("file.open", { path: "docs/plan.md", client: "p1" });
	assert.equal(state.changes.length, 1);
	assert.equal(state.changes[0]!.by, "ann");
	const told = s.heard.filter((e) => e.name === "file.changed").map((e) => e.payload as { change?: string; record?: { id: string; by: string } }).find((p) => p.record);
	assert.deepEqual([told?.record?.id, told?.record?.by, told?.change], [state.changes[0]!.id, "ann", state.changes[0]!.id]);
	const after = await s.value<State>("file.review", { path: "docs/plan.md", change: state.changes[0]!.id, accept: false }, "person");
	assert.equal(after.text, "# Plan\n\nShip it.\n");
	assert.deepEqual(after.changes, []);
	await s.deck.write("docs/plan.md" as never, new TextEncoder().encode("# Plan!\n\nShip it.\n"), ann);
	await s.value("file.open", { path: "docs/plan.md", client: "p1" });
	const kept = await s.value<State>("file.review", { path: "docs/plan.md", change: "*", accept: true });
	assert.equal(kept.text, "# Plan!\n\nShip it.\n");
	assert.equal((await s.call("file.review", { path: "docs/plan.md", change: "nope", accept: true })).ok, false);
	await s.close();
});

test("rule 7: restore a version as one edit", async () => {
	const s = await start();
	const { rev } = await s.value<State>("file.open", { path: "docs/plan.md", client: "p1" });
	await s.value("file.splice", { path: "docs/plan.md", client: "p1", rev, batch: "x", splices: [{ at: 0, before: "# Plan", text: "# Other" }] });
	const back = await s.value<{ rev: number; by: string }>("file.restore", { path: "docs/plan.md", sha: String(rev) }, ann);
	assert.equal(back.by, "ann");
	assert.equal((await s.value<State>("file.close", { path: "docs/plan.md", client: "p1" })).text, "# Plan\n\nShip it.\n");
	await s.close();
});

test("rule 9: a document on a canvas reads as an item and writes back unchanged", () => {
	const node = { type: "browser", id: "d1", name: "Notes", width: 800, height: 600, metadata: { type: "decks.document", path: "docs/notes.md" }, x: 10, y: 20 };
	const item = documentKind.fromPen(node);
	assert.deepEqual([item.type, item.path, item.box], ["document", "docs/notes.md", { x1: 10, y1: 20, x2: 810, y2: 620 }]);
	assert.deepEqual(documentKind.toPen(item), node);
	assert.deepEqual(documentKind.files!(item), ["docs/notes.md"]);
});

test("rule 10: without Google, the google calls answer unavailable", async () => {
	const s = await start();
	for (const [name, args] of [["google.status", {}], ["google.connect", { url: "https://x" }], ["google.disconnect", {}]] as const) {
		const answer = await s.call(name, args, "person");
		assert.equal(answer.ok ? "ok" : answer.error.code, "unavailable", name);
	}
	await s.close();
});
