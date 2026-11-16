import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createBackend, createHearing, drawingFollower, type Heard } from "./backend.ts";

// The frame on the protocol's socket keeps the person's undo: a renewed pass and a reconnect read nothing
// whole, and a change that arrives while the frame boots is applied, against a fake WebSocket.

/** A WebSocket the test plays the server for: what the frame sent, and what the server says back. */
class FakeSocket {
	static all: FakeSocket[] = [];
	sent: Array<Record<string, unknown>> = [];
	closed = false;
	onopen?: () => void;
	onmessage?: (event: { data: string }) => void;
	onclose?: (event: { reason: string }) => void;
	onerror?: () => void;
	constructor(readonly url: URL) {
		FakeSocket.all.push(this);
	}
	send(text: string) {
		this.sent.push(JSON.parse(text) as Record<string, unknown>);
	}
	close() {
		this.closed = true;
		this.onclose?.({ reason: "" });
	}
	/** The server's side: open, say hello, tell an event. */
	open() {
		this.onopen?.();
	}
	say(message: Record<string, unknown>) {
		this.onmessage?.({ data: JSON.stringify(message) });
	}
	hello() {
		this.say({ type: "hello", protocol: "0.33.0", caller: { kind: "person", id: "person~frame-1", name: "you", canvas: "plan" } });
	}
	event(name: string, payload: Record<string, unknown>) {
		this.say({ type: "event", name, payload });
	}
}

const change = (rev: number, base: number, more: Record<string, unknown> = {}) => ({ canvas: "plan", ids: ["a"], by: "agent", rev, base, pen: [{ op: "set", id: "a", key: "content", value: `rev ${rev}` }], ...more });

function frameOn(token = "t1") {
	FakeSocket.all = [];
	(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
	let pass = token;
	const backend = createBackend("http://127.0.0.1:4329/compat", "plan", pass, "http://127.0.0.1:4329/api/t/p/card/");
	const heard: Heard[] = [];
	let rev = 3;
	const stop = backend.follow((message) => heard.push(message), () => rev);
	const ws = FakeSocket.all.find((one) => one.url.pathname === "/api/v1/socket")!;
	ws.open();
	ws.hello();
	return { backend, heard, ws, setRev: (next: number) => (rev = next), renew: (next: string) => ((pass = next), backend.setToken(next)), stop };
}

test("a renewed pass is said on the open socket: nothing closes, nothing is read whole", () => {
	const { heard, ws, renew } = frameOn();
	assert.deepEqual(ws.sent.slice(0, 2).map((m) => m.type), ["hello", "watch"]);
	renew("t2");
	assert.equal(ws.closed, false);
	assert.deepEqual(ws.sent.at(-1), { type: "token", token: "t2" });
	ws.hello();
	assert.equal(ws.sent.filter((m) => m.type === "watch").length, 1, "the hello answering a token is not a new watch");
	assert.equal(heard.filter((m) => m.type === "reconnected").length, 0);
});

test("a reconnect watches from the revision held and catches up by the replay, never reading whole", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const { heard, ws, setRev } = frameOn();
		setRev(7);
		ws.close();
		mock.timers.tick(600);
		const again = FakeSocket.all.filter((one) => one.url.pathname === "/api/v1/socket").at(-1)!;
		assert.notEqual(again, ws);
		again.open();
		again.hello();
		assert.deepEqual(again.sent.find((m) => m.type === "watch"), { type: "watch", canvas: "plan", events: ["item.changed", "card.changed", "view.requested", "view.changed", "agent.acted", "app.changed"], since: 7 });
		again.event("item.changed", change(8, 7));
		assert.equal(heard.filter((m) => m.type === "reconnected").length, 0);
		assert.deepEqual(heard.filter((m) => m.type === "canvas.changed").map((m) => (m as { rev: number }).rev), [8]);
		// Only when the server's log no longer reaches the revision held is the drawing read whole.
		again.event("item.changed", { canvas: "plan", ids: [], by: "server", rev: 7, missed: true });
		assert.equal(heard.at(-1)?.type, "reconnected");
	} finally {
		mock.timers.reset();
	}
});

test("neither a renewal nor a reconnect reads the drawing whole, which is what emptied the person's undo", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const follower = drawingFollower({
			whole: () => assert.fail("nothing is read whole"),
			edits: () => true,
			reread: () => assert.fail("nothing is read again"),
		});
		follower.at(3);
		const { backend, ws, renew } = frameOn();
		backend.follow((message) => follower.hear(message), () => follower.rev());
		renew("t2");
		ws.hello();
		ws.event("item.changed", change(4, 3));
		ws.close();
		mock.timers.tick(600);
		const again = FakeSocket.all.filter((one) => one.url.pathname === "/api/v1/socket").at(-1)!;
		again.open();
		again.hello();
		assert.deepEqual(again.sent.find((m) => m.type === "watch"), { type: "watch", canvas: "plan", events: ["item.changed", "card.changed", "view.requested", "view.changed", "agent.acted", "app.changed"], since: 4 });
		again.event("item.changed", change(5, 4));
		assert.equal(follower.rev(), 5);
	} finally {
		mock.timers.reset();
	}
});

test("a change that arrives while the frame boots is held, then applied once it follows", () => {
	const hearing = createHearing();
	hearing.tell({ type: "canvas.changed", canvas: "plan", rev: 5, from: 4, edits: [], base: "" });
	hearing.tell({ type: "canvas.changed", canvas: "plan", rev: 6, from: 5, edits: [{ op: "set", id: "a", key: "content", value: "six" }], base: "" });
	const applied: number[] = [];
	const follower = drawingFollower({
		whole: () => assert.fail("nothing is read whole"),
		edits: (edits) => (applied.push(edits.length), true),
		reread: () => assert.fail("nothing is read again"),
	});
	// The drawing was read at revision 5: the held 5 is passed over, the held 6 applied.
	follower.at(5);
	hearing.add((message) => follower.hear(message));
	assert.deepEqual(applied, [1]);
	assert.equal(follower.rev(), 6);
});

test("a drop before the frame follows is read whole once it does, since nothing could be replayed", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		FakeSocket.all = [];
		(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
		const backend = createBackend("http://127.0.0.1:4329/compat", "plan", "t1", "http://127.0.0.1:4329/api/t/p/card/");
		void backend.drawing().catch(() => undefined);
		const ws = FakeSocket.all.find((one) => one.url.pathname === "/api/v1/socket")!;
		ws.open();
		ws.hello();
		ws.close();
		mock.timers.tick(600);
		const again = FakeSocket.all.filter((one) => one.url.pathname === "/api/v1/socket").at(-1)!;
		again.open();
		again.hello();
		const heard: Heard[] = [];
		backend.follow((message) => heard.push(message), () => 3);
		assert.equal(heard.at(-1)?.type, "reconnected");
	} finally {
		mock.timers.reset();
	}
});

test("a call in flight when the pass is renewed is answered, not refused", async () => {
	const { backend, ws, renew } = frameOn();
	const asked = backend.act("item.batch", { canvas: "plan", ops: [], edit: "e1" });
	const call = ws.sent.find((m) => m.type === "call")!;
	renew("t2");
	assert.equal(ws.closed, false);
	ws.hello();
	ws.say({ type: "answer", id: call.id, envelope: { ok: true, value: [], notes: [] } });
	assert.deepEqual(await asked, { ok: true, value: [], notes: [] });
});

test("the frame's watch asks only for the events it hears, not every chat or file event", () => {
	const { ws } = frameOn();
	assert.deepEqual(ws.sent.find((m) => m.type === "watch"), { type: "watch", canvas: "plan", events: ["item.changed", "card.changed", "view.requested", "view.changed", "agent.acted", "app.changed"], since: 3 });
});

test("a camera come to rest is said as the frame's view and recorded with view.move, device frame", () => {
	const { backend, ws } = frameOn();
	backend.presence({ camera: { x: 10, y: 20, zoom: 2 } });
	const calls = ws.sent.filter((m) => m.type === "call").map((m) => [m.name, m.args]);
	assert.deepEqual(calls, [
		["view.update", { canvas: "plan", camera: { x: 10, y: 20, zoom: 2 } }],
		["view.move", { canvas: "plan", x: 10, y: 20, zoom: 2, device: "frame" }],
	]);
});

test("a card's file changed on the socket is told with its news from card.get, so the frame marks it new", async () => {
	const { heard, ws } = frameOn();
	ws.event("card.changed", { canvas: "plan", ids: ["canvases/plan/cards/one/index.html"], by: "person", rev: 4 });
	const asked = ws.sent.find((m) => m.type === "call" && m.name === "card.get")!;
	assert.deepEqual(asked.args, { card: "canvases/plan/cards/one/index.html" });
	ws.say({ type: "answer", id: asked.id, envelope: { ok: true, value: { path: "canvases/plan/cards/one/index.html", title: "One", by: "person", named: 10, changed: 20 }, notes: [] } });
	await new Promise((done) => setTimeout(done, 0));
	assert.deepEqual(heard.at(-1), { type: "card.changed", path: "canvases/plan/cards/one/index.html", rev: 4, card: { path: "canvases/plan/cards/one/index.html", rev: 4, lastWrittenBy: "you", namedAt: 10, modifiedAt: 20 } });
});
