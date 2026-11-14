import assert from "node:assert/strict";
import { test } from "node:test";
import { serialize } from "@decks/pen";
import { callers, testServer } from "../kernel/testing.ts";
import { sharingFeature } from "./feature.ts";
import { memoryStudio } from "./testing.ts";

// The three studio calls, as calls: only the person connects, a key Studio
// does not take is refused, and the key never lands in the deck.

const pen = serialize({ version: "2.14", children: [{ id: "n1", type: "note", content: "hi", x: 0, y: 0 }] } as never);

function setup() {
	const studio = memoryStudio();
	studio.keys.set("good", { user: { id: "ada", name: "Ada" }, harness: { id: "h", name: "mini" } });
	return { studio, feature: sharingFeature({ transport: studio.transport, settleMs: 10 }) };
}

test("studio.connect syncs the deck, status says so, disconnect forgets the key", async () => {
	const { studio, feature } = setup();
	const server = await testServer({ features: [feature], deck: { "canvases/plan/canvas.pen": pen } });
	assert.deepEqual(await server.value("studio.status"), { connected: false });
	assert.deepEqual(await server.value("studio.connect", { url: studio.url, key: "good" }), { connected: true, url: studio.url });
	assert.deepEqual(await server.value("studio.status"), { connected: true, url: studio.url });
	for (let i = 0; i < 50 && !studio.hub.canvases("ada").length; i++) await new Promise((r) => setTimeout(r, 10));
	assert.deepEqual(studio.hub.canvases("ada").map((c) => c.name), ["plan"]);
	const files = (await server.deck.list("canvases/plan" as never)).map((e) => e.path);
	for (const path of files) assert.ok(!new TextDecoder().decode(await server.deck.read(path)).includes("good"), `${path} holds no key`);
	assert.deepEqual(await server.value("studio.disconnect"), { connected: false });
	assert.deepEqual(await server.value("studio.status"), { connected: false });
	await server.close();
});

test("a key Studio does not take is refused, an address that is not one is invalid, and only the person connects", async () => {
	const { studio, feature } = setup();
	const server = await testServer({ features: [feature] });
	const bad = await server.call("studio.connect", { url: studio.url, key: "bad" });
	assert.equal(!bad.ok && bad.error.code, "refused");
	const odd = await server.call("studio.connect", { url: "ftp://x", key: "good" });
	assert.equal(!odd.ok && odd.error.code, "invalid");
	const agent = await server.call("studio.connect", { url: studio.url, key: "good" }, callers.agent("a1"));
	assert.equal(agent.ok, false);
	assert.deepEqual(await server.value("studio.status"), { connected: false });
	await server.close();
});
