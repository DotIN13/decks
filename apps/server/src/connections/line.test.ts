import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import type { LineClientMessage, ServerMessage } from "@decks/protocol";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "./http.ts";
import { Line } from "./line.ts";

/** A deck, its server with the line on `/api/v1/socket`, and a way to open one. */
async function open(backlog?: number) {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-line-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "canvases"), { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const line = new Line(app, backlog);
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
	return { app, line, connect, stop };
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
		me.send({ type: "line.call", id: "k1", verb: "canvas.batch", args: [[{ op: "update", id: "a", set: { content: "two" } }]], edit: "typed two", canvas: canvas });
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

test("a document pass on the line opens its one document, placed on a canvas or not, and says and hears nothing else", async () => {
	const { app, connect, stop } = await open();
	try {
		const canvas = app.pens.claim("Mine");
		mkdirSync(join(app.deck.path, "docs"), { recursive: true });
		writeFileSync(join(app.deck.path, "docs", "plan.md"), "# The plan\n\nOn no canvas.\n");
		writeFileSync(join(app.deck.path, "docs", "other.md"), "# Another\n");
		const person = app.tokens.issue({ kind: "person" }, { label: "line test" });
		const id = (app.tokens.verify(person.token) as { id: string }).id;
		assert.equal(app.documentKey("docs/plan.md"), "docs/plan.md");
		assert.equal(app.documentKey("docs/none.md"), undefined, "a file that is not there is no document");
		assert.equal(app.documentKey(".decks/tokens.json"), undefined, "the app's own records are never one");
		const pass = app.passes.document("docs/plan.md", id).pass;
		const frame = connect();
		await frame.opened;
		frame.send({ type: "line.hello", token: pass, watch: [{ canvas, since: 0 }] });
		const hello = (await frame.next((m) => m.type === "line.hello")) as Extract<ServerMessage, { type: "line.hello" }>;
		assert.equal(hello.who, "document");
		assert.match(((await frame.next((m) => m.type === "harness.error")) as { text: string }).text, /hears no canvas/);
		// Its own document opens, though no canvas places it.
		frame.send({ type: "doc.open", path: "docs/plan.md", client: "c1" } as never);
		const state = (await frame.next((m) => m.type === "doc.state")) as unknown as { path: string; text?: string };
		assert.equal(state.path, "docs/plan.md");
		// Another document does not, and neither does a call, a canvas or a card.
		const errors = () => frame.heard.filter((m) => m.type === "harness.error").map((m) => (m as { text: string }).text);
		frame.send({ type: "doc.open", path: "docs/other.md", client: "c1" } as never);
		await frame.next((m) => m.type === "harness.error" && /not this line's document/.test((m as { text: string }).text));
		frame.send({ type: "line.call", id: "a1", verb: "canvas.read", args: [] });
		frame.send({ type: "canvas.watch", canvas });
		await frame.next(() => errors().filter((text) => /says only that document's messages/.test(text)).length === 2);
		assert.equal(frame.heard.some((m) => m.type === "call.answered"), false, "no call is answered");
		// What is said of its document is heard; of another, or of a canvas, not.
		app.send({ type: "doc.changed", path: "docs/other.md", base: 0, rev: 1, splices: [], by: "person" } as never);
		app.send({ type: "doc.changed", path: "docs/plan.md", base: 0, rev: 1, splices: [], by: "person" } as never);
		app.pens.edit(canvas, [{ op: "insert", node: { type: "note", id: "n", content: "n" }, box: { x1: 0, y1: 0 } }]);
		const changed = (await frame.next((m) => m.type === "doc.changed")) as unknown as { path: string };
		assert.equal(changed.path, "docs/plan.md");
		await new Promise((done) => setTimeout(done, 50));
		assert.equal(frame.heard.filter((m) => m.type === "doc.changed").length, 1);
		assert.equal(frame.heard.some((m) => m.type === "canvas.changed"), false);
		// The token it was made with taken back: the pass opens nothing.
		app.tokens.revoke(id);
		assert.equal(app.passes.openDocument(pass), undefined);
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

test("a page's hello is greeted with the whole truth, hears a watched canvas whole, and is told the deck as its own screen has it", async () => {
	const { app, connect, stop } = await open();
	try {
		const canvas = app.pens.claim("Greeted");
		app.pens.edit(canvas, [{ op: "insert", node: { type: "note", id: "n", content: "hi" }, box: { x1: 0, y1: 0 } }]);
		const person = app.tokens.issue({ kind: "person" }, { label: "line page" }).token;

		const page = connect();
		await page.opened;
		page.send({ type: "line.hello", token: person, all: true, greet: true, watch: [{ canvas, whole: true }] });
		await page.next((m) => m.type === "harness.paired");
		const kinds = page.heard.map((m) => m.type);
		for (const kind of ["line.hello", "harness.hello", "deck.changed", "harness.runtimes", "agent.list", "canvas.list", "web.changed", "harness.settings", "harness.paired"]) assert.ok(kinds.includes(kind as never), `greeted with ${kind}`);
		const whole = (await page.next((m) => m.type === "canvas.changed")) as Extract<ServerMessage, { type: "canvas.changed" }>;
		assert.equal(whole.canvas, canvas);
		assert.ok(whole.doc, "the drawing whole, since the page held none");
		assert.equal(whole.rev, app.pens.get(canvas).rev);

		// A call for the person: answered once under its id, and its side messages said to this line alone.
		page.send({ type: "line.call", id: "c1", verb: "agent.add", args: [{}] });
		const added = (await page.next((m) => m.type === "call.answered" && m.id === "c1")) as Extract<ServerMessage, { type: "call.answered" }>;
		assert.equal(added.ok, true, added.error);
		const id = (added.value as { id: string }).id;
		page.send({ type: "line.call", id: "c2", verb: "agent.focus", args: [id] });
		const focused = (await page.next((m) => m.type === "call.answered" && m.id === "c2")) as Extract<ServerMessage, { type: "call.answered" }>;
		assert.equal(focused.ok, true, focused.error);
		const told = (await page.next((m) => m.type === "deck.changed" && page.heard.indexOf(m) > page.heard.indexOf(added))) as Extract<ServerMessage, { type: "deck.changed" }>;
		assert.ok(told.deck, "the deck as this screen's agent has it, said to the page that focused");

		// An agent's token may not call the person's verbs.
		const agent = app.agents.get(id)!;
		const theirs = app.tokens.issue({ kind: "agent", id: agent.id }, { label: "agent" }).token;
		const other = connect();
		await other.opened;
		other.send({ type: "line.hello", token: theirs });
		await other.next((m) => m.type === "line.hello");
		other.send({ type: "line.call", id: "a1", verb: "agent.focus", args: [id] });
		const refused = (await other.next((m) => m.type === "call.answered" && m.id === "a1")) as Extract<ServerMessage, { type: "call.answered" }>;
		assert.equal(refused.ok, false);
		assert.match(refused.error ?? "", /person's to call/);
		page.ws.close();
		other.ws.close();
	} finally {
		await stop();
	}
});

test("a line that stops reading is let go once enough waits for it, and one that comes back is heard again", async () => {
	// A megabyte may wait here, where 32 may in use.
	const { app, line, connect, stop } = await open(1024 * 1024);
	try {
		const canvas = app.pens.claim("Behind");
		const person = app.tokens.issue({ kind: "person" }, { label: "line test" }).token;
		const me = connect();
		await me.opened;
		me.send({ type: "line.hello", token: person, watch: [{ canvas }] });
		await me.next((m) => m.type === "line.hello");
		assert.equal(line.connections, 1);

		// The page stops reading, its connection still open: a tab put to sleep.
		(me.ws as unknown as { _socket: { pause(): void } })._socket.pause();
		// Said to it meanwhile: 64 KB at a time that does not compress, up to 64 MB. Without the limit all of it waits in this process.
		const { randomBytes } = await import("node:crypto");
		let said = 0;
		let gone = false;
		void me.closed.then(() => (gone = true));
		for (; said < 1000 && line.connections > 0; said += 1) {
			app.pages.send({ type: "canvas.changed", canvas, rev: 1000 + said, note: randomBytes(48 * 1024).toString("base64") } as unknown as ServerMessage);
			if (said % 20 === 19) await new Promise((done) => setTimeout(done, 5));
		}
		assert.equal(line.connections, 0, `still held after ${said} messages`);
		assert.equal(said < 1000, true);
		// The page's end hears the connection drop once it reads again.
		(me.ws as unknown as { _socket: { resume(): void } })._socket.resume();
		await me.closed;
		assert.equal(gone, true);

		// And it connects again, as a page does by itself, and is heard and answered.
		const again = connect();
		await again.opened;
		again.send({ type: "line.hello", token: person, watch: [{ canvas }] });
		await again.next((m) => m.type === "line.hello");
		app.pages.send({ type: "canvas.changed", canvas, rev: 5000 } as unknown as ServerMessage);
		await again.next((m) => m.type === "canvas.changed" && m.rev === 5000);
		again.ws.close();
	} finally {
		await stop();
	}
});
