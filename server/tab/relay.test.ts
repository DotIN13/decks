import { test } from "node:test";
import assert from "node:assert/strict";
import { testServer } from "../kernel/testing.ts";
import { tabFeature, TabHub } from "./feature.ts";
import { RELAY_PATH } from "./relay.ts";

// The real door: a WebSocket to /api/web/relay, as background.js opens it,
// answering the server's commands the way the extension does.

test("the extension dials the relay with its code and the tab is shared over a real socket", async () => {
	const hub = new TabHub({ pingMs: 60_000 });
	const s = await testServer({ features: [tabFeature({ hub })] });
	const doors = await s.listen(0);
	const { code } = await s.value<{ code: string }>("tab.pair", {});
	const base = doors.url.replace("http", "ws") + RELAY_PATH;

	const refused = await new Promise<string>((done) => {
		const ws = new WebSocket(`${base}?code=wrong`);
		ws.onopen = () => done("opened");
		ws.onerror = () => done("refused");
	});
	assert.equal(refused, "refused");

	const ws = new WebSocket(`${base}?code=${encodeURIComponent(code)}`);
	await new Promise((done) => (ws.onopen = done));
	ws.onmessage = (event) => {
		const frame = JSON.parse(String(event.data)) as { id: number; method: string; params: unknown[] };
		const expression = String((frame.params[2] as { expression?: string } | undefined)?.expression ?? "");
		const value = expression.includes("readyState") ? { url: "https://example.com/", title: "Example", ready: "complete" } : undefined;
		ws.send(JSON.stringify({ id: frame.id, result: value ? { result: { value } } : {} }));
	};
	ws.send(JSON.stringify({ method: "chrome.tabs.onCreated", params: [{ id: 3, url: "https://example.com/", title: "Example" }] }));
	ws.send(JSON.stringify({ method: "extension.initialized", params: [] }));
	for (let i = 0; i < 50 && !(await s.value<{ connected: boolean }>("tab.status")).connected; i++) await new Promise((done) => setTimeout(done, 20));
	assert.deepEqual(await s.value("tab.status"), { paired: true, connected: true, url: "https://example.com/", title: "Example" });

	const closed = new Promise<string>((done) => (ws.onclose = (event) => done(event.reason)));
	await s.value("tab.stop", {});
	assert.match(await closed, /stopped/);
	await doors.close();
	await s.close();
});
