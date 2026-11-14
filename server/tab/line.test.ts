import { test } from "node:test";
import assert from "node:assert/strict";
import { ExtensionLine, type Line } from "./line.ts";
import { actScript, READ } from "./page.ts";

// The wire alone, and the page scripts parse.

function pair(): { line: Line; up(text: string): void; sent: string[]; close(): void } {
	const sent: string[] = [];
	let hear: (text: string) => void = () => {};
	let closed: () => void = () => {};
	return {
		line: { send: (t) => void sent.push(t), close: () => closed(), onText: (h) => void (hear = h), onClose: (h) => void (closed = h) },
		up: (text) => hear(text),
		sent,
		close: () => closed(),
	};
}

test("commands are numbered, answers and errors find their command, events pass up", async () => {
	const p = pair();
	const line = new ExtensionLine(p.line, 60_000);
	const heard: string[] = [];
	line.onEvent = (method) => heard.push(method);
	const one = line.send("chrome.debugger.attach", [{ tabId: 1 }, "1.3"]);
	const two = line.send("chrome.tabs.create", [{}]);
	assert.deepEqual(p.sent.map((t) => JSON.parse(t).id), [1, 2]);
	p.up(JSON.stringify({ id: 2, error: "No tab" }));
	p.up(JSON.stringify({ id: 1, result: { ok: 1 } }));
	p.up(JSON.stringify({ method: "chrome.tabs.onRemoved", params: [1] }));
	assert.deepEqual(await one, { ok: 1 });
	await assert.rejects(two, /No tab/);
	assert.deepEqual(heard, ["chrome.tabs.onRemoved"]);
	line.close("done");
});

test("a closed line rejects what waits and every later command", async () => {
	const p = pair();
	const line = new ExtensionLine(p.line, 60_000);
	let reason = "";
	line.onEnd = (why) => (reason = why);
	const waiting = line.send("chrome.debugger.attach", []);
	p.close();
	await assert.rejects(waiting, /gone/);
	await assert.rejects(line.send("decks.ping", []), /gone/);
	assert.equal(reason, "the extension disconnected");
});

test("the ping goes down on its own", async () => {
	const p = pair();
	const line = new ExtensionLine(p.line, 10);
	await new Promise((done) => setTimeout(done, 35));
	assert.ok(p.sent.some((t) => JSON.parse(t).method === "decks.ping"));
	line.close("done");
});

test("the page scripts are valid JavaScript", () => {
	assert.doesNotThrow(() => new Function(`return ${READ}`));
	assert.doesNotThrow(() => new Function(`return ${actScript({ mode: "click", target: { name: "Save" } })}`));
});
