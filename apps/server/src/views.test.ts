import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ServerMessage } from "@decks/protocol";
import { App } from "./app.ts";
import { AgentStateStore } from "./agents/agent-state.ts";
import { DeckAgent } from "./agents/session.ts";
import { AgentStore } from "./agents/store.ts";
import { Deck } from "./deck/loader.ts";
import { realPathOf } from "./deck/roots.ts";
import type { StageService } from "./stage/service.ts";
import type { Hub, View } from "./ws.ts";

/*
 * Two devices on one deck, each on its own conversation.
 *
 * The bug this pins down: the server kept one focused agent for everybody and broadcast it, so
 * opening a chat on a phone moved the laptop to that chat as well. Nothing here starts a runtime:
 * the chats are written as records first and restored, which starts nothing by design.
 */
function seeded(deckPath: string, name: string, place: { x: number; y: number }): string {
	const deck = Deck.open(deckPath);
	const agent = new DeckAgent(
		deck,
		() => {},
		{} as StageService,
		{
			port: 4329,
			camera: () => ({ x: 0, y: 0, zoom: 1 }),
			agents: () => [],
			spawn: async () => ({ agent: "", name: "", report: "", boards: [] }),
			send: () => ({ queued: true as const, position: 1 }),
			queue: () => [],
			report: () => {},
			brief: (task: string) => task,
			recordRevision: () => undefined,
			boardPathOf: () => undefined,
		},
		{ color: "#3b5cf6", kind: "pi", snapshots: new AgentStateStore(), store: new AgentStore(deck) },
	);
	agent.rename(name);
	agent.translator.user("here");
	agent.setPosition("boards/plan.html", place.x, place.y);
	const id = agent.id;
	agent.dispose();
	return id;
}

function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-views-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(join(deck, "boards", "plan.html"), `<!doctype html><title>Plan</title><body class="board"></body>`);
	const one = seeded(deck, "One", { x: 10, y: 20 });
	const two = seeded(deck, "Two", { x: 900, y: 400 });

	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	app.agents.restore();
	// A hub with two browsers on it, each keeping what it was sent.
	const laptop: View = {};
	const phone: View = {};
	const inbox = new Map<View, ServerMessage[]>([
		[laptop, []],
		[phone, []],
	]);
	const hub = {
		connections: 2,
		each: (render: (view: View) => ServerMessage) => {
			for (const [view, got] of inbox) got.push(render(view));
		},
		broadcast: (message: ServerMessage) => {
			for (const got of inbox.values()) got.push(message);
		},
	};
	(app as unknown as { hub: Hub }).hub = hub as unknown as Hub;
	const replyTo = (view: View) => (message: ServerMessage) => inbox.get(view)!.push(message);
	const last = <T extends ServerMessage["type"]>(view: View, type: T) =>
		inbox.get(view)!.filter((message): message is Extract<ServerMessage, { type: T }> => message.type === type).at(-1);
	const plan = (message: Extract<ServerMessage, { type: "deck.state" }> | undefined) => {
		const board = message?.deck.boards.find((one) => one.path === "boards/plan.html");
		return board && [board.x, board.y];
	};
	return {
		app,
		one,
		two,
		laptop,
		phone,
		replyTo,
		last,
		plan,
		cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })),
	};
}

test("opening a chat on one device leaves the other device where it was", () => {
	const { app, one, two, laptop, phone, replyTo, last, cleanup } = open();
	try {
		app.greet(replyTo(laptop), laptop);
		app.greet(replyTo(phone), phone);
		app.handle({ type: "agent.focus", id: one }, replyTo(laptop), laptop);
		app.handle({ type: "agent.focus", id: two }, replyTo(phone), phone);

		assert.equal(last(phone, "agents")?.focused, two, "the phone is on the chat it opened");
		assert.equal(last(laptop, "agents")?.focused, one, "and the laptop was not moved to it");

		// A republish nobody asked for — an agent finishing a turn — says the same thing to each.
		app.agents.publish();
		assert.equal(last(laptop, "agents")?.focused, one);
		assert.equal(last(phone, "agents")?.focused, two);
	} finally {
		cleanup();
	}
});

test("each device's board list carries its own conversation's arrangement", () => {
	const { app, one, two, laptop, phone, replyTo, last, plan, cleanup } = open();
	try {
		app.handle({ type: "agent.focus", id: one }, replyTo(laptop), laptop);
		assert.deepEqual(plan(last(laptop, "deck.state")), [10, 20]);
		app.handle({ type: "agent.focus", id: two }, replyTo(phone), phone);
		assert.deepEqual(plan(last(phone, "deck.state")), [900, 400]);

		// Something changed the deck: each device hears it as its own stage sees it.
		app.send({ type: "deck.state", deck: app.stageState() });
		assert.deepEqual(plan(last(laptop, "deck.state")), [10, 20]);
		assert.deepEqual(plan(last(phone, "deck.state")), [900, 400]);

		// And a board moved on the laptop lands on the laptop's conversation, not the phone's.
		app.handle({ type: "board.move", path: "boards/plan.html", x: 64, y: 64 }, replyTo(laptop), laptop);
		assert.deepEqual(app.agents.get(one)?.positions()["boards/plan.html"], { x: 64, y: 64 });
		assert.deepEqual(app.agents.get(two)?.positions()["boards/plan.html"], { x: 900, y: 400 });
	} finally {
		cleanup();
	}
});
