import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import type { ServerMessage } from "@decks/protocol";
import { App } from "../app.ts";
import { AgentStateStore } from "../agents/agent-state.ts";
import { DeckAgent } from "../agents/session.ts";
import { AgentStore } from "../agents/store.ts";
import { Deck } from "../deck/loader.ts";
import { realPathOf } from "../deck/roots.ts";
import type { CanvasService } from "../canvas/service.ts";
import { runVerb } from "../calls/run.ts";
import type { View } from "../calls/person-call.ts";
import { greet } from "./greeting.ts";

/** Write a file, making its folder: a card is `cards/<name>/index.html`. */
function put(file: string, data: string | Uint8Array): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
}


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
		{} as CanvasService,
		{
			port: 4329,
			camera: () => ({ x: 0, y: 0, zoom: 1 }),
			agents: () => [],
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
	agent.conversation.translator.user("here");
	agent.seat.setPosition("canvases/t/cards/plan/index.html", place.x, place.y);
	const id = agent.id;
	agent.dispose();
	return id;
}

function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-views-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	put(join(deck, "canvases", "t", "cards", "plan", "index.html"), `<!doctype html><title>Plan</title><body class="board"></body>`);
	const one = seeded(deck, "One", { x: 10, y: 20 });
	const two = seeded(deck, "Two", { x: 900, y: 400 });

	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	app.agents.restore();
	// Two pages on the line, each keeping what it was told: a broadcast as its own screen sees it (`forView`), as the line says it.
	const laptop: View = {};
	const phone: View = {};
	const inbox = new Map<View, ServerMessage[]>([
		[laptop, []],
		[phone, []],
	]);
	app.pages.listen((message) => {
		for (const [view, got] of inbox) got.push(app.pages.forView(message, view));
	});
	const replyTo = (view: View) => (message: ServerMessage) => inbox.get(view)!.push(message);
	/** One of the person's calls from a page, which names the conversation on its screen. */
	const call = (view: View, verb: string, args: unknown[]) => runVerb(app, { kind: "person" }, view.focused ? { "x-decks-agent": view.focused } : {}, verb, args, undefined, { tell: replyTo(view), view });
	const last = <T extends ServerMessage["type"]>(view: View, type: T) =>
		inbox.get(view)!.filter((message): message is Extract<ServerMessage, { type: T }> => message.type === type).at(-1);
	const plan = (message: Extract<ServerMessage, { type: "deck.changed" }> | undefined) => {
		const board = message?.deck.boards.find((one) => one.path === "canvases/t/cards/plan/index.html");
		return board && [board.x, board.y];
	};
	return {
		app,
		one,
		two,
		laptop,
		phone,
		replyTo,
		call,
		last,
		plan,
		cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })),
	};
}

test("opening a chat on one device leaves the other device where it was", async () => {
	const { app, one, two, laptop, phone, replyTo, call, last, cleanup } = open();
	try {
		greet(app, replyTo(laptop), laptop);
		greet(app, replyTo(phone), phone);
		await call(laptop, "agent.focus", [one]);
		await call(phone, "agent.focus", [two]);

		assert.equal(last(phone, "agent.list")?.focused, two, "the phone is on the chat it opened");
		assert.equal(last(laptop, "agent.list")?.focused, one, "and the laptop was not moved to it");

		// A republish nobody asked for — an agent finishing a turn — says the same thing to each.
		app.agents.publish();
		assert.equal(last(laptop, "agent.list")?.focused, one);
		assert.equal(last(phone, "agent.list")?.focused, two);
	} finally {
		cleanup();
	}
});

test("each device's board list carries its own conversation's arrangement", async () => {
	const { app, one, two, laptop, phone, call, last, plan, cleanup } = open();
	try {
		await call(laptop, "agent.focus", [one]);
		assert.deepEqual(plan(last(laptop, "deck.changed")), [10, 20]);
		await call(phone, "agent.focus", [two]);
		assert.deepEqual(plan(last(phone, "deck.changed")), [900, 400]);

		// Something changed the deck: each device hears it as its own stage sees it.
		app.send({ type: "deck.changed", deck: app.stageState() });
		assert.deepEqual(plan(last(laptop, "deck.changed")), [10, 20]);
		assert.deepEqual(plan(last(phone, "deck.changed")), [900, 400]);
		// A card moved on one device names the canvas on its screen: `canvas/card-size-on-canvas.test.ts` holds that it lands there.
	} finally {
		cleanup();
	}
});
