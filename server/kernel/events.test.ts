import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "./testing.ts";

// The event stream's rules: a card hears only its own canvas, person-only
// events reach the person, and an event sent to some clients reaches only them.

test("a card hears only its own canvas's events; person-only events reach the person only", async () => {
	const server = await testServer();
	const card: string[] = [];
	const agent: string[] = [];
	server.events.subscribe({ caller: callers.card("canvases/a/cards/x/index.html", "a") }, (one) => void card.push(one.name));
	server.events.subscribe({ caller: callers.agent("ann") }, (one) => void agent.push(one.name));
	const { events } = await import("../../protocol/index.ts");
	server.events.emit(events.itemChanged, { canvas: "a", ids: ["n"], by: "ann", rev: 1 });
	server.events.emit(events.itemChanged, { canvas: "b", ids: ["n"], by: "ann", rev: 2 });
	server.events.emit(events.chatChanged, { ids: [], by: "ann", rev: 3 });
	assert.deepEqual(card, ["item.changed"]);
	assert.deepEqual(agent, ["item.changed", "item.changed"]);
	await server.close();
});

test("an event sent to some clients reaches only them", async () => {
	const server = await testServer();
	const heard: string[] = [];
	server.events.subscribe({ caller: callers.person, client: "c1" }, () => void heard.push("c1"));
	server.events.subscribe({ caller: callers.person, client: "c2" }, () => void heard.push("c2"));
	const { events } = await import("../../protocol/index.ts");
	server.events.emit(events.viewRequested, { ids: [], by: "ann", rev: 1, call: "view.focus", args: {} }, { clients: ["c2"] });
	assert.deepEqual(heard, ["c2"]);
	await server.close();
});
