import { test } from "node:test";
import assert from "node:assert/strict";
import { events, PROTOCOL_VERSION } from "../../../protocol/index.ts";
import { callers, testServer } from "../testing.ts";
import { defineFeature } from "../types.ts";

// A line keeps going: a new token for the same caller replaces the old one,
// and a watch with since first replays the canvas's changes after it, then
// goes live; a log that no longer reaches since says missed.

type Json = any;
function open(url: string, token: string): Promise<{ ws: WebSocket; got: Json[]; closed: Promise<number> }> {
	const ws = new WebSocket(`${url.replace("http", "ws")}/api/v1/socket`);
	const got: Json[] = [];
	const closed = new Promise<number>((done) => (ws.onclose = (e) => done(e.code)));
	return new Promise((ready) => {
		ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL_VERSION }));
		ws.onmessage = (m) => {
			const message = JSON.parse(String(m.data));
			got.push(message);
			if (message.type === "hello" && got.length === 1) ready({ ws, got, closed });
		};
	});
}
const settle = () => new Promise((r) => setTimeout(r, 80));

test("a new token for the same caller replaces the line's; another caller's closes it", async () => {
	const server = await testServer();
	const doors = await server.listen(0);
	const card = callers.card("canvases/a/cards/x/index.html", "a");
	const line = await open(doors.url, server.token(card));
	line.ws.send(JSON.stringify({ type: "token", token: server.token(card) }));
	await settle();
	assert.equal(line.got.filter((m) => m.type === "hello").length, 2);
	line.ws.send(JSON.stringify({ type: "token", token: server.token(callers.card("canvases/b/cards/y/index.html", "b")) }));
	assert.equal(await line.closed, 4403);
	await doors.close();
	await server.close();
});

test("a watch with since replays the canvas's changes after it, then goes live; a short log says missed", async () => {
	const past = [1, 2, 3].map((rev) => ({ canvas: "a", ids: [`n${rev}`], by: "ann", rev }));
	const doc = { read: () => [], apply: () => ({ items: [], rev: 0 }), since: () => [] };
	const canvas = defineFeature({
		name: "canvasy",
		calls: [],
		canvases: () => ({ doc: () => doc, name: (raw) => (raw === "a" ? raw : (() => { throw new Error(`no canvas ${raw}`); })()), replay: (_name, since) => (since < 1 ? { missed: true } : past.filter((one) => one.rev > since)) }),
	});
	const server = await testServer({ features: [canvas] });
	const doors = await server.listen(0);
	const line = await open(doors.url, doors.token);
	line.ws.send(JSON.stringify({ type: "watch", canvas: "a", since: 1 }));
	await settle();
	server.events.emit(events.itemChanged, { canvas: "a", ids: ["n4"], by: "ann", rev: 4 });
	await settle();
	assert.deepEqual(line.got.filter((m) => m.type === "event").map((m) => m.payload.rev), [2, 3, 4]);
	line.got.length = 0;
	line.ws.send(JSON.stringify({ type: "watch", canvas: "a", since: 0 }));
	await settle();
	assert.equal(line.got[0]?.payload.missed, true);
	line.got.length = 0;
	line.ws.send(JSON.stringify({ type: "watch", canvas: "nowhere-at-all", since: 2 }));
	await settle();
	assert.equal(line.got[0]?.payload.missed, true);
	line.ws.close();
	await doors.close();
	await server.close();
});
