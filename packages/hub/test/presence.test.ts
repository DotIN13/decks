import { test } from "node:test";
import assert from "node:assert/strict";
import { Live, MemoryStore, type LiveSocket } from "../src/index.ts";

/*
 * Presence through the relay: a page's, a canvas frame's (a socket held to one canvas, which speaks for
 * its person on that canvas alone) and a harness's, each reaching the others on the canvas and nobody
 * else; the camera carrying the viewport's size; everyone told when a socket goes.
 */
const store = new MemoryStore();
const ada = { id: "ada", name: "Ada" };
const bob = { id: "bob", name: "Bob" };
const plan = store.createCanvas("ada", "Plan", "plan");
const other = store.createCanvas("ada", "Other", "other");
store.share(plan.id, "bob", "view");

function socket() {
	const one = { sent: [] as string[], message: undefined as ((d: unknown) => void) | undefined, close: undefined as (() => void) | undefined };
	const ws: LiveSocket = { send: (t) => one.sent.push(t), close: () => {}, on: ((event: string, listener: (d?: unknown) => void) => void (event === "message" ? (one.message = listener) : (one.close = listener as () => void))) as never };
	const presences = () => one.sent.map((t) => JSON.parse(t) as Record<string, unknown>).filter((m) => m.type === "presence");
	return { ws, one, presences, say: (m: unknown) => one.message!(JSON.stringify(m)) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("a frame's presence reaches the pages and the harness on its canvas, as its person; another canvas's it may not speak for", async () => {
	const live = new Live(store);
	const page = socket();
	const frame = socket();
	const harness = socket();
	const bobsPage = socket();
	const elsewhere = socket();
	live.add(page.ws, { user: ada });
	live.add(frame.ws, { user: ada, only: plan.id });
	live.add(harness.ws, { user: ada, harness: { id: "h-mini", name: "mini" } });
	live.add(bobsPage.ws, { user: bob });
	live.add(elsewhere.ws, { user: ada, only: other.id });

	frame.say({ type: "presence", canvas: plan.id, pointer: { x: 10, y: 20 }, camera: { x: 0, y: 0, zoom: 2, w: 800, h: 600 } });
	await tick();
	for (const [who, s] of [["the page", page], ["the harness", harness], ["Bob's page", bobsPage]] as const) {
		const got = s.presences();
		assert.equal(got.length, 1, `${who} heard it`);
		assert.deepEqual(got[0]!.pointer, { x: 10, y: 20 });
		assert.deepEqual(got[0]!.camera, { x: 0, y: 0, zoom: 2, w: 800, h: 600 }, "the viewport's size travels with the camera");
		const by = got[0]!.by as { kind: string; id: string; name: string; harness?: string };
		assert.equal(by.kind, "person");
		assert.equal(by.name, "Ada");
		assert.match(by.id, /^ada:/);
		assert.equal(by.harness, undefined, "a frame speaks as Studio's, not a harness's");
	}
	assert.equal(frame.presences().length, 0, "never back to the sender");
	assert.equal(elsewhere.presences().length, 0, "a frame on another canvas hears nothing of this one");

	// The frame may not speak for another canvas, nor in the older cursor form.
	frame.say({ type: "presence", canvas: other.id, pointer: { x: 1, y: 1 } });
	frame.say({ type: "cursor", canvas: plan.id, x: 1, y: 1 });
	await tick();
	assert.equal(page.presences().length, 1);
	assert.equal(elsewhere.presences().length, 0);

	// A page's presence reaches the frame; a frame on another canvas hears nothing.
	page.say({ type: "presence", canvas: plan.id, selection: ["n1"] });
	await tick();
	assert.deepEqual(frame.presences().at(-1)!.selection, ["n1"]);
	assert.equal(elsewhere.presences().length, 0);

	// The frame's socket closing says gone, once, to everyone who heard it.
	frame.one.close!();
	await tick();
	assert.equal(page.presences().at(-1)!.gone, true);
	assert.equal(harness.presences().at(-1)!.gone, true);
	assert.equal(bobsPage.presences().filter((p) => p.gone).length, 1);
});
