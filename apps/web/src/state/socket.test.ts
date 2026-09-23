import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage } from "@decks/protocol";

/*
 * How frames reach the app: in waves, once per paint.
 *
 * The greeting is not one frame. It is the deck, the chat list and then seven frames for
 * every conversation on the deck, which on a real deck is a couple of hundred — sent by the
 * server in a tenth of a second. Applied one at a time, each one ran the whole reactive graph,
 * and the page was blocked for seconds while the same derived state was recomputed over and
 * over. What is pinned here is the collecting: nothing
 * is dropped, nothing is reordered, and a window that never paints still gets its frames.
 */

/** A paint that only happens when this test says so. */
const paints: Array<() => void> = [];
/** A timer that only fires when this test says so. */
const timers = new Map<number, () => void>();
let nextTimer = 1;

class FakeSocket {
	static last: FakeSocket | undefined;
	static readonly OPEN = 1;
	readyState = FakeSocket.OPEN;
	onopen: (() => void) | undefined;
	onmessage: ((event: { data: string }) => void) | undefined;
	onclose: (() => void) | undefined;
	onerror: (() => void) | undefined;
	sent: string[] = [];
	constructor(_url: string) {
		FakeSocket.last = this;
	}
	send(text: string) {
		this.sent.push(text);
	}
	close() {}
}

const global = globalThis as Record<string, unknown>;
global.WebSocket = FakeSocket;
global.location = { protocol: "http:", host: "127.0.0.1:4329" };
global.requestAnimationFrame = (fn: () => void) => paints.push(fn);
global.cancelAnimationFrame = (id: number) => void id;
global.clearTimeout = (id: number) => void timers.delete(id);
global.window = {
	setTimeout: (fn: () => void) => {
		timers.set(nextTimer, fn);
		return nextTimer++;
	},
};

const { on, reset, start } = await import("./socket.ts");

/** A fresh connection, with the frames it hands over collected in order. */
function connected() {
	reset();
	paints.length = 0;
	timers.clear();
	const heard: string[] = [];
	/** How many separate times the listener was called in a burst — one per wave. */
	const waves: number[] = [];
	start(() => {});
	const socket = FakeSocket.last!;
	socket.onopen?.();
	on((message: ServerMessage) => heard.push(`${message.type}:${(message as { id?: string }).id ?? ""}`));
	const arrive = (type: string, id?: string) => socket.onmessage?.({ data: JSON.stringify({ type, ...(id ? { id } : {}) }) });
	const paint = () => {
		const before = heard.length;
		for (const fn of paints.splice(0)) fn();
		waves.push(heard.length - before);
	};
	const tick = () => {
		for (const fn of [...timers.values()]) fn();
		timers.clear();
	};
	return { heard, waves, arrive, paint, tick };
}

test("frames that arrive together are applied together, in the order they came", () => {
	const app = connected();
	app.arrive("deck.state");
	for (const id of ["a", "b", "c"]) app.arrive("agent.identity", id);
	assert.deepEqual(app.heard, [], "nothing is applied before the paint");
	app.paint();
	assert.deepEqual(app.heard, ["deck.state:", "agent.identity:a", "agent.identity:b", "agent.identity:c"]);
	assert.deepEqual(app.waves, [4], "one wave, not four");
});

test("frames that arrive after a paint are the next wave, still in order", () => {
	const app = connected();
	app.arrive("deck.state");
	app.paint();
	app.arrive("agent.state", "a");
	app.arrive("agent.state", "b");
	app.paint();
	assert.deepEqual(app.heard, ["deck.state:", "agent.state:a", "agent.state:b"]);
	assert.deepEqual(app.waves, [1, 2]);
});

test("a window that never paints still gets its frames, from the timer", () => {
	const app = connected();
	app.arrive("agent.state", "a");
	app.tick();
	assert.deepEqual(app.heard, ["agent.state:a"], "a hidden tab is where the bell rings");
});

test("a frame is applied once, whichever of the two fires first", () => {
	const app = connected();
	app.arrive("agent.state", "a");
	app.paint();
	app.tick();
	assert.deepEqual(app.heard, ["agent.state:a"]);
});
