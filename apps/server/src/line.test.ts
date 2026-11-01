import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import type { LineClientMessage, ServerMessage } from "@decks/protocol";
import { App } from "./app.ts";
import { realPathOf } from "./deck/roots.ts";
import { createHttpApp } from "./http.ts";
import { Line } from "./line.ts";

/** A deck, its server with the line on `/api/v1/socket`, and a way to open one. */
async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-line-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "canvases"), { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const line = new Line(app);
	const server = createServer(createHttpApp(app));
	server.on("upgrade", (request, socket, head) => {
		if (new URL(request.url ?? "/", "http://decks").pathname === "/api/v1/socket") line.handleUpgrade(request, socket, head);
		else socket.destroy();
	});
	server.listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/socket`;
	/** One line: what it heard, in order, and a way to wait for a message. */
	const connect = () => {
		const ws = new WebSocket(url);
		const heard: ServerMessage[] = [];
		const waiting: Array<{ test: (m: ServerMessage) => boolean; done: (m: ServerMessage) => void }> = [];
		ws.on("message", (data) => {
			const message = JSON.parse(String(data)) as ServerMessage;
			heard.push(message);
			for (const one of [...waiting]) if (one.test(message)) {
				waiting.splice(waiting.indexOf(one), 1);
				one.done(message);
			}
		});
		const closed = new Promise<{ code: number; reason: string }>((done) => ws.on("close", (code, reason) => done({ code, reason: String(reason) })));
		const opened = new Promise<void>((done) => ws.on("open", () => done()));
		const next = (test: (m: ServerMessage) => boolean, ms = 3000) =>
			new Promise<ServerMessage>((done, fail) => {
				const found = heard.find(test);
				if (found) return done(found);
				const timer = setTimeout(() => fail(new Error(`nothing matching came in ${ms} ms; heard ${heard.map((m) => m.type).join(", ")}`)), ms);
				waiting.push({ test, done: (m) => (clearTimeout(timer), done(m)) });
			});
		const send = (message: LineClientMessage) => ws.send(JSON.stringify(message));
		return { ws, heard, closed, opened, next, send };
	};
	const stop = async () => {
		line.close();
		app.dispose();
		await new Promise((done) => server.close(() => done(undefined)));
		rmSync(dataDir, { recursive: true, force: true });
	};
	return { app, connect, stop };
}

test("the line takes its token in hello, answers calls once each, and says a canvas's changes once with the edits that made them", async () => {
	const { app, connect, stop } = await open();
	try {
		const canvas = app.pens.claim("Line");
		app.pens.edit(canvas, [{ op: "insert", node: { type: "note", id: "a", content: "one" }, box: { x1: 0, y1: 0 } }]);
		const rev = app.pens.get(canvas).rev;
		const person = app.tokens.issue({ kind: "person" }, { label: "line test" }).token;

		// A line that says anything but hello first, or hello with a bad token, is closed.
		const stranger = connect();
		await stranger.opened;
		stranger.send({ type: "line.hello", token: "not-a-token" });
		assert.equal((await stranger.closed).code, 4401);

		const me = connect();
		await me.opened;
		me.send({ type: "line.hello", token: person, watch: [{ canvas, since: rev }] });
		const hello = (await me.next((m) => m.type === "line.hello")) as Extract<ServerMessage, { type: "line.hello" }>;
		assert.equal(hello.who, "person");
		// Holding the current revision: nothing to catch up on.
		await new Promise((done) => setTimeout(done, 100));
		assert.equal(me.heard.filter((m) => m.type === "canvas.changed").length, 0);

		// A call: one answer under its id, and the change it made, once, with the edit's name on it.
		me.send({ type: "line.call", id: "k1", verb: "canvas.batch", args: [[{ op: "update", id: "a", set: { content: "two" } }]], edit: "typed two", stage: canvas });
		const answer = (await me.next((m) => m.type === "call.answered")) as Extract<ServerMessage, { type: "call.answered" }>;
		assert.equal(answer.id, "k1");
		assert.equal(answer.ok, true, answer.error);
		const changed = (await me.next((m) => m.type === "canvas.changed")) as Extract<ServerMessage, { type: "canvas.changed" }>;
		assert.equal(changed.canvas, canvas);
		assert.deepEqual([changed.from, changed.rev], [rev, rev + 1]);
		assert.deepEqual(changed.edits?.map((e) => e.op), ["set"]);
		assert.deepEqual(changed.made, ["typed two"]);
		assert.equal(changed.author?.kind, "person");
		assert.equal(me.heard.filter((m) => m.type === "canvas.changed").length, 1, "said once, not once per agent");
		assert.equal(me.heard.filter((m) => m.type === "stage.pen.delta").length, 0, "the per-agent copies are the tab's socket's");

		// An unknown verb is answered, not dropped.
		me.send({ type: "line.call", id: "k2", verb: "no.such", args: [] });
		const refused = (await me.next((m) => m.type === "call.answered" && m.id === "k2")) as Extract<ServerMessage, { type: "call.answered" }>;
		assert.equal(refused.ok, false);
		assert.match(refused.error ?? "", /no verb called no.such/);

		// A line that comes back holding an older revision is caught up with the edits since, and their names.
		const again = connect();
		await again.opened;
		again.send({ type: "line.hello", token: person, watch: [{ canvas, since: rev }] });
		const caught = (await again.next((m) => m.type === "canvas.changed")) as Extract<ServerMessage, { type: "canvas.changed" }>;
		assert.deepEqual([caught.from, caught.rev], [rev, rev + 1]);
		assert.deepEqual(caught.edits?.map((e) => e.op), ["set"]);
		assert.deepEqual(caught.made, ["typed two"]);
		// One from before the log is given the drawing whole.
		again.send({ type: "canvas.watch", canvas, since: -5 });
		const whole = (await again.next((m) => m.type === "canvas.changed" && m.doc !== undefined)) as Extract<ServerMessage, { type: "canvas.changed" }>;
		assert.equal(whole.from, undefined);
		assert.equal(whole.doc?.children?.[0]?.content, "two");
		me.ws.close();
		again.ws.close();
	} finally {
		await stop();
	}
});

test("a canvas pass on the line hears its own canvas alone and calls only what a frame may", async () => {
	const { app, connect, stop } = await open();
	try {
		const mine = app.pens.claim("Mine");
		const other = app.pens.claim("Other");
		app.pens.edit(mine, [{ op: "insert", node: { type: "note", id: "m", content: "m" }, box: { x1: 0, y1: 0 } }]);
		app.pens.edit(other, [{ op: "insert", node: { type: "note", id: "o", content: "o" }, box: { x1: 0, y1: 0 } }]);
		const person = app.tokens.issue({ kind: "person" }, { label: "line test" });
		const pass = app.passes.canvas(mine, "edit", app.tokens.verify(person.token).ok ? (app.tokens.verify(person.token) as { id: string }).id : "").pass;
		const frame = connect();
		await frame.opened;
		frame.send({ type: "line.hello", token: pass, watch: [{ canvas: mine, since: app.pens.get(mine).rev }, { canvas: other, since: 0 }] });
		const hello = (await frame.next((m) => m.type === "line.hello")) as Extract<ServerMessage, { type: "line.hello" }>;
		assert.deepEqual([hello.who, hello.canvas, hello.role], ["canvas", mine, "edit"]);
		const noOther = (await frame.next((m) => m.type === "harness.error")) as Extract<ServerMessage, { type: "harness.error" }>;
		assert.match(noOther.text, /hears no other canvas/);
		// An agent at work on a card of this canvas is heard; one on a card elsewhere is not.
		mkdirSync(join(app.deck.path, "canvases", mine, "cards", "one"), { recursive: true });
		writeFileSync(join(app.deck.path, "canvases", mine, "cards", "one", "index.html"), "<!doctype html><title>One</title><p>one</p>");
		app.deck.refresh(`canvases/${mine}/cards/one/index.html`);
		app.pens.edit(mine, [{ op: "insert", node: { type: "browser", id: "card-1", metadata: { type: "decks.card", path: `canvases/${mine}/cards/one/index.html` } }, box: { x1: 500, y1: 0, x2: 900, y2: 300 } }]);
		app.send({ type: "agent.act", agentId: "ag", path: `canvases/${mine}/cards/one/index.html`, phase: "start", what: "edit", label: "Loom", color: "#f00", at: 1 });
		app.send({ type: "agent.act", agentId: "ag", path: `canvases/${other}/cards/two/index.html`, phase: "start", what: "edit", label: "Loom", color: "#f00", at: 2 });
		const act = (await frame.next((m) => m.type === "agent.act")) as Extract<ServerMessage, { type: "agent.act" }>;
		assert.equal(act.path, `canvases/${mine}/cards/one/index.html`);
		await new Promise((done) => setTimeout(done, 50));
		assert.equal(frame.heard.filter((m) => m.type === "agent.act").length, 1, "the other canvas's act is not heard");
		// The other canvas changes: this line hears nothing of it. Its own: it does.
		app.pens.edit(other, [{ op: "update", id: "o", set: { content: "oo" } }]);
		app.pens.edit(mine, [{ op: "update", id: "m", set: { content: "mm" } }]);
		const changed = (await frame.next((m) => m.type === "canvas.changed")) as Extract<ServerMessage, { type: "canvas.changed" }>;
		assert.equal(changed.canvas, mine);
		assert.equal(frame.heard.filter((m) => m.type === "canvas.changed" && m.canvas === other).length, 0);
		// A frame's call reaches past its canvas: refused with a sentence; one on its canvas goes through.
		frame.send({ type: "line.call", id: "a1", verb: "agent.list", args: [] });
		const refused = (await frame.next((m) => m.type === "call.answered" && m.id === "a1")) as Extract<ServerMessage, { type: "call.answered" }>;
		assert.equal(refused.ok, false);
		assert.match(refused.error ?? "", /not the canvas frame's to call/);
		frame.send({ type: "line.call", id: "a2", verb: "canvas.read", args: [] });
		const read = (await frame.next((m) => m.type === "call.answered" && m.id === "a2")) as Extract<ServerMessage, { type: "call.answered" }>;
		assert.equal(read.ok, true, read.error);
		frame.ws.close();
	} finally {
		await stop();
	}
});

test("presence: a line's pointer and selection reach the other lines on the canvas, a newcomer is told who is there, and a leave is said", async () => {
	const { app, connect, stop } = await open();
	try {
		const canvas = app.pens.claim("Room");
		app.pens.edit(canvas, [{ op: "insert", node: { type: "note", id: "n", content: "n" }, box: { x1: 0, y1: 0 } }]);
		const person = app.tokens.issue({ kind: "person" }, { label: "line test" }).token;
		const rev = app.pens.get(canvas).rev;
		const a = connect();
		const b = connect();
		await Promise.all([a.opened, b.opened]);
		a.send({ type: "line.hello", token: person, watch: [{ canvas, since: rev }] });
		b.send({ type: "line.hello", token: person, watch: [{ canvas, since: rev }] });
		await Promise.all([a.next((m) => m.type === "line.hello"), b.next((m) => m.type === "line.hello")]);
		a.send({ type: "presence.set", canvas, pointer: { x: 10, y: 20 } });
		const seen = (await b.next((m) => m.type === "presence.changed")) as Extract<ServerMessage, { type: "presence.changed" }>;
		assert.deepEqual(seen.pointer, { x: 10, y: 20 });
		assert.equal(seen.by.kind, "person");
		assert.ok(seen.by.color);
		await new Promise((done) => setTimeout(done, 50));
		assert.equal(a.heard.filter((m) => m.type === "presence.changed").length, 0, "never echoed to the one who said it");
		a.send({ type: "presence.set", canvas, selection: ["n"] });
		const selected = (await b.next((m) => m.type === "presence.changed" && m.selection !== undefined)) as Extract<ServerMessage, { type: "presence.changed" }>;
		assert.deepEqual(selected.selection, ["n"]);
		assert.equal(selected.by.id, seen.by.id);
		// A third line that starts watching is told where a is, pointer and selection together.
		const c = connect();
		await c.opened;
		c.send({ type: "line.hello", token: person, watch: [{ canvas, since: rev }] });
		const told = (await c.next((m) => m.type === "presence.changed")) as Extract<ServerMessage, { type: "presence.changed" }>;
		assert.deepEqual([told.by.id, told.pointer, told.selection], [seen.by.id, { x: 10, y: 20 }, ["n"]]);
		// a goes: the others hear it left.
		a.ws.close();
		const gone = (await b.next((m) => m.type === "presence.changed" && m.gone === true)) as Extract<ServerMessage, { type: "presence.changed" }>;
		assert.equal(gone.by.id, seen.by.id);
		b.ws.close();
		c.ws.close();
	} finally {
		await stop();
	}
});
