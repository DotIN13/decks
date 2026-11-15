import { test } from "node:test";
import assert from "node:assert/strict";
import { testServer } from "../kernel/testing.ts";
import { FakeExtension, type FakePage } from "./fake-extension.ts";
import { tabFeature, TabHub } from "./feature.ts";

// The README's rules, as calls through the real router, against an extension
// that speaks the real one's wire.

const form = (): FakePage => ({
	url: "https://example.com/form",
	title: "Sign up",
	fields: [
		{ name: "Email", role: "textbox" },
		{ name: "Plan", role: "combobox" },
		{ name: "Save", role: "button" },
		{ name: "Row", role: "textbox" },
		{ name: "Row", role: "textbox" },
		{ name: "Buy", role: "button", covered: "<div#cookie>" },
	],
});

const settle = () => new Promise((done) => setTimeout(done, 20));

async function start(options: { answerMs?: number } = {}) {
	const hub = new TabHub({ pingMs: 60_000, ...options });
	const s = await testServer({ features: [tabFeature({ hub })] });
	return { s, hub };
}

async function shared(options: { answerMs?: number } = {}) {
	const { s, hub } = await start(options);
	const { code } = await s.value<{ code: string }>("tab.pair", {});
	const ext = new FakeExtension(form());
	assert.equal(hub.connect(code, ext.line), true);
	ext.share();
	await settle();
	return { s, hub, ext };
}

test("rule 2: the code is kept, a wrong code is refused, fresh drops the line", async () => {
	const { s, hub } = await start();
	const first = await s.value<{ code: string; expires: number }>("tab.pair", {});
	assert.equal((await s.value<{ code: string }>("tab.pair", {})).code, first.code);
	assert.equal(first.expires, 0);
	const wrong = new FakeExtension(form());
	assert.equal(hub.connect("nope", wrong.line), false);
	assert.equal(wrong.closedWith, "The pairing code is wrong.");
	assert.deepEqual(wrong.sent, []);
	const ext = new FakeExtension(form());
	hub.connect(first.code, ext.line);
	ext.share();
	await settle();
	const fresh = await s.value<{ code: string }>("tab.pair", { fresh: true });
	assert.notEqual(fresh.code, first.code);
	assert.match(ext.closedWith ?? "", /new code/);
	assert.equal((await s.value<{ connected: boolean }>("tab.status")).connected, false);
	await s.close();
});

test("rule 3: the first tab named is attached, and a new line replaces the old", async () => {
	const { s, hub, ext } = await shared();
	assert.deepEqual(ext.methods().slice(0, 2), ["chrome.debugger.attach", "Page.enable"]);
	assert.deepEqual(await s.value("tab.status"), { paired: true, connected: true, url: "https://example.com/form", title: "Sign up" });
	const code = (await s.value<{ code: string }>("tab.pair", {})).code;
	const second = new FakeExtension(form(), 9);
	hub.connect(code, second.line);
	assert.match(ext.closedWith ?? "", /replaced/);
	second.share();
	await settle();
	assert.equal((await s.value<{ connected: boolean }>("tab.status")).connected, true);
	assert.ok(s.heard.some((one) => one.name === "tab.changed"));
	await s.close();
});

test("rule 4: with nothing paired a call is unavailable, with a sentence", async () => {
	const { s } = await start();
	const got = await s.call("tab.read", {}, "agent");
	assert.equal(got.ok, false);
	if (!got.ok) assert.deepEqual([got.error.code, /tab\.pair/.test(got.error.message)], ["unavailable", true]);
	assert.deepEqual(await s.value("tab.status"), { paired: false, connected: false });
	await s.close();
});

test("open navigates, read gives refs, and a ref after a navigation is refused", async () => {
	const { s, ext } = await shared();
	const page = await s.value<{ snapshot: string }>("tab.read", {}, "agent");
	assert.match(page.snapshot, /- textbox "Email" \[ref=e1\]/);
	ext.page.url = "https://example.com/next";
	const stale = await s.call("tab.fill", { field: { ref: "e1" }, text: "a@b.c" }, "agent");
	assert.equal(stale.ok, false);
	if (!stale.ok) assert.equal(stale.error.code, "conflict");
	const opened = await s.value<{ url: string }>("tab.open", { url: "https://example.com/done" }, "agent");
	assert.equal(opened.url, "https://example.com/done");
	assert.ok(ext.methods().includes("Page.navigate"));
	await s.close();
});

test("rules 6 and 7: fill, select, click; many or covered are refused", async () => {
	const { s, ext } = await shared();
	await s.value("tab.fill", { field: "Email", text: "a@b.c" }, "agent");
	assert.equal(ext.page.fields[0]!.value, "a@b.c");
	await s.value("tab.select", { field: "Plan", option: "Pro" }, "agent");
	assert.equal(ext.page.fields[1]!.value, "Pro");
	await s.value("tab.click", { target: "Save" }, "agent");
	assert.deepEqual(ext.methods().filter((m) => m === "Input.dispatchMouseEvent").length, 3);
	const many = await s.call("tab.fill", { field: "Row", text: "x" }, "agent");
	assert.ok(!many.ok && /did not guess/.test(many.error.message));
	await s.value("tab.fill", { field: { name: "Row", nth: 2 }, text: "y" }, "agent");
	assert.equal(ext.page.fields[4]!.value, "y");
	const covered = await s.call("tab.click", { target: "Buy" }, "agent");
	assert.ok(!covered.ok && /div#cookie/.test(covered.error.message));
	await s.value("tab.press", { key: "Tab" }, "agent");
	assert.ok(ext.methods().includes("Input.dispatchKeyEvent"));
	await s.close();
});

test("rule 8: submit waits for the person; yes clicks, no does not", async () => {
	const { s, ext } = await shared();
	const asked = await s.value<{ pending?: { id: string; text: string } }>("tab.submit", { target: "Save" }, "agent");
	assert.match(asked.pending?.text ?? "", /press "Save" on Sign up/);
	assert.equal(ext.methods().includes("Input.dispatchMouseEvent"), false);
	const agentAnswer = await s.call("tab.answer", { id: asked.pending!.id, ok: true }, "agent");
	assert.equal(agentAnswer.ok, false, "only the person answers");
	const done = await s.value<{ pending?: unknown }>("tab.answer", { id: asked.pending!.id, ok: true });
	assert.equal(done.pending, undefined);
	assert.ok(ext.methods().includes("Input.dispatchMouseEvent"));
	const again = await s.value<{ pending?: { id: string } }>("tab.submit", {}, "agent");
	await s.value("tab.answer", { id: again.pending!.id, ok: false });
	assert.equal(ext.methods().includes("Input.dispatchKeyEvent"), false);
	await s.value("tab.submit", { ask: false }, "agent");
	assert.ok(ext.methods().includes("Input.dispatchKeyEvent"));
	await s.close();
});

test("rule 8: an unanswered question is a no after its time", async () => {
	const { s } = await shared({ answerMs: 30 });
	await s.value("tab.submit", {}, "agent");
	await new Promise((done) => setTimeout(done, 60));
	assert.equal((await s.value<{ pending?: unknown }>("tab.status")).pending, undefined);
	await s.close();
});

test("rule 9: a screenshot is written into the deck with its size", async () => {
	const { s } = await shared();
	const shot = await s.value<{ file: string; size: { w: number; h: number } }>("tab.screenshot", {}, "agent");
	assert.match(shot.file, /^exports\/tab\/.+\.png$/);
	assert.deepEqual(shot.size, { w: 800, h: 600 });
	assert.equal((await s.deck.revisions!(shot.file as never)).at(-1)?.by, "agent-1");
	await s.close();
});

test("stop closes the line as the person's own stop; a hang-up says so", async () => {
	const { s, ext } = await shared();
	const stopped = await s.value<{ connected: boolean; closed?: string }>("tab.stop", {}, "agent");
	assert.equal(stopped.connected, false);
	assert.match(ext.closedWith ?? "", /stopped/);
	const again = await shared();
	again.ext.hangUp();
	const state = await again.s.value<{ closed?: string }>("tab.status");
	assert.match(state.closed ?? "", /disconnected/);
	await s.close();
	await again.s.close();
});
