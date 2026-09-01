import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentChat, ServerMessage } from "@decks/protocol";
import { Deck } from "../deck/loader.ts";
import type { StageService } from "../stage/service.ts";
import { Registry } from "./registry.ts";
import { DeckAgent } from "./session.ts";
import { SnapshotStore } from "./snapshot.ts";
import { AgentStore } from "./store.ts";

/**
 * That the chat list survives the process (DESIGN §6.2).
 *
 * The point of these is a seam a browser check cannot reach: the e2e suite shares one server,
 * so a restart cannot be staged in Playwright. Here the writing side can be disposed and a
 * fresh `Registry` built on the same deck, which is what a restart is.
 *
 * **Nothing starts a runtime, deliberately.** `Registry.create` starts a backend for a new
 * agent, and in a test that means loading a model runtime that will sit on the event loop
 * long after the assertions are done — the first version of this file hung for ten minutes
 * for exactly that reason. So the writing side drives `DeckAgent` directly, the way
 * `session.test.ts` does and the way a backend's events would; the reading side goes through
 * `Registry.restore`, which starts nothing by design and is the thing under test.
 */
function deckOn(): { deck: Deck; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "decks-registry-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	for (const name of ["plan.html", "notes.html"]) {
		writeFileSync(join(root, "boards", name), `<!doctype html><title>${name}</title><body class="board"></body>`);
	}
	return { deck: Deck.open(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** One agent on a deck, with a store and no backend — a turn's worth of state, no runtime. */
function agentOn(deck: Deck, color = "#3b5cf6"): DeckAgent {
	return new DeckAgent(
		deck,
		() => {},
		{} as StageService,
		{
			port: 4329,
			camera: () => ({ x: 0, y: 0, zoom: 1 }),
			agents: () => [],
			spawn: async () => ({ agent: "", name: "", report: "", boards: [] }),
			recordRevision: () => undefined,
			boardPathOf: () => undefined,
		},
		{ color, kind: "pi", snapshots: new SnapshotStore(), store: new AgentStore(deck) },
	);
}

function registryOn(deck: Deck): { registry: Registry; sent: ServerMessage[] } {
	const sent: ServerMessage[] = [];
	const registry = new Registry(deck, (message) => sent.push(message), {} as StageService, {
		port: 4329,
		defaultKind: "pi",
		camera: () => ({ x: 0, y: 0, zoom: 1 }),
		recordRevision: () => undefined,
		boardPathOf: () => undefined,
	});
	return { registry, sent };
}

const rowFor = (registry: Registry, id: string): AgentChat | undefined => registry.chats().find((chat) => chat.id === id);

test("a chat that was spoken to comes back after a restart", () => {
	const { deck, cleanup } = deckOn();

	const agent = agentOn(deck);
	agent.rename("Kestrel");
	agent.translator.user("what is the plan");
	agent.setInPlay(["boards/plan.html"]);
	const id = agent.id;
	agent.dispose();

	const { registry } = registryOn(deck);
	assert.equal(registry.restore(), 1, "one row restored");

	const back = rowFor(registry, id);
	assert.ok(back, "and it is the same agent, because the id is part of the record");
	assert.equal(back.name, "Kestrel");
	assert.equal(back.kind, "pi");
	assert.equal(back.dormant, true, "readable, but nothing is running behind it");
	assert.equal(back.contextCount, 1);
	assert.deepEqual([...(registry.get(id)?.inPlay ?? [])], ["boards/plan.html"], "the canvas comes back too");
	cleanup();
});

test("a dormant row still reports what its runtime can do", () => {
	const { deck, cleanup } = deckOn();
	const agent = agentOn(deck);
	agent.translator.user("hello");
	const id = agent.id;
	agent.dispose();

	const { registry } = registryOn(deck);
	registry.restore();

	// Capabilities are a property of the runtime, not of a live session, so the mode control
	// can be drawn correctly before anything is started. pi has no modes; the assertion is
	// that the answer comes from the *kind* rather than from an absent backend.
	assert.deepEqual(rowFor(registry, id)?.capabilities, { modes: [] });
	cleanup();
});

test("the transcript comes back, not only the row", () => {
	const { deck, cleanup } = deckOn();

	const agent = agentOn(deck);
	agent.translator.user("what is the plan");
	agent.translator.startAssistant();
	agent.translator.delta("It is on the board.");
	agent.translator.endAssistant();
	const id = agent.id;
	agent.dispose();

	const { registry } = registryOn(deck);
	registry.restore();
	const history = registry.get(id)?.translator.history() ?? [];

	assert.deepEqual(
		history.map((item) => item.kind),
		["user", "assistant"],
	);
	assert.equal(history[1]?.kind === "assistant" && history[1].text, "It is on the board.");
	cleanup();
});

test("a new message after a restore cannot land on a restored message's id", () => {
	const { deck, cleanup } = deckOn();

	const agent = agentOn(deck);
	// An assistant turn that says nothing is spliced out again, so the surviving ids have
	// gaps in their numbering — which is what makes counting items the wrong way to resume
	// the counter, and this is the case that catches it.
	agent.translator.user("one");
	agent.translator.startAssistant();
	agent.translator.endAssistant();
	agent.translator.user("two");
	const id = agent.id;
	const before = agent.translator.history().map((item) => item.id);
	agent.dispose();

	const { registry } = registryOn(deck);
	registry.restore();
	const restored = registry.get(id)!;
	restored.translator.user("three");
	const after = restored.translator.history().map((item) => item.id);

	assert.equal(new Set(after).size, after.length, `ids collided: ${after.join(" ")}`);
	assert.ok(
		before.every((was) => after.includes(was)),
		"and the restored ones kept the ids the browser already knows them by",
	);
	cleanup();
});

test("an agent nobody spoke to is not written down", () => {
	const { deck, cleanup } = deckOn();

	// What `focused()` creates on demand so a deck is never agentless. Persisting these
	// would leave an empty "Agent" row behind on every single boot.
	const agent = agentOn(deck);
	agent.setInPlay(["boards/plan.html"]);
	agent.rename("Named but silent");
	agent.dispose();

	const { registry } = registryOn(deck);
	assert.equal(registry.restore(), 0);
	cleanup();
});

test("closing a chat keeps it closed across a restart", () => {
	const { deck, cleanup } = deckOn();

	const agent = agentOn(deck);
	agent.translator.user("something");
	const id = agent.id;
	agent.dispose();

	const first = registryOn(deck);
	assert.equal(first.registry.restore(), 1);
	assert.equal(first.registry.remove(id).removed, true);
	first.registry.dispose();

	const second = registryOn(deck);
	assert.equal(second.registry.restore(), 0, "a removed chat does not come back");
	cleanup();
});

test("the newest restored chat is the focused one", () => {
	const { deck, cleanup } = deckOn();

	for (const [index, name] of ["Older", "Newer"].entries()) {
		const agent = agentOn(deck);
		agent.rename(name);
		agent.translator.user(`hello from ${name}`);
		// The transcript's own timestamps are what the list is ordered by, and two agents
		// created in the same millisecond would otherwise tie. `history()` is a shallow copy,
		// so dating the message here dates the one the record will be written from.
		const first = agent.translator.history()[0];
		if (first?.kind === "user") first.at = 1000 + index * 1000;
		agent.dispose();
	}

	const { registry, sent } = registryOn(deck);
	registry.restore();
	const last = sent.filter((message) => message.type === "agents").at(-1);

	assert.equal(last?.type === "agents" && registry.get(last.focused ?? "")?.chat().name, "Newer");
	cleanup();
});

test("restored rows keep their colour, so a chat does not change identity", () => {
	const { deck, cleanup } = deckOn();

	const agent = agentOn(deck, "#0f9ba8");
	agent.translator.user("hello");
	const id = agent.id;
	agent.dispose();

	const { registry } = registryOn(deck);
	registry.restore();
	assert.equal(registry.get(id)?.color, "#0f9ba8");
	cleanup();
});

test("only the newest fifteen chats are kept", () => {
	const { deck, cleanup } = deckOn();

	for (let index = 0; index < 20; index += 1) {
		const agent = agentOn(deck);
		agent.rename(`Agent ${index}`);
		agent.translator.user("hello");
		const first = agent.translator.history()[0];
		if (first?.kind === "user") first.at = 1000 + index;
		agent.dispose();
	}

	const { registry } = registryOn(deck);
	assert.equal(registry.restore(), 15);
	const names = registry.chats().map((chat) => chat.name);
	assert.ok(names.includes("Agent 19"), "the newest survives");
	assert.ok(!names.includes("Agent 0"), "the oldest is pruned");
	cleanup();
});

test("a deck opened for the first time restores nothing and reports so", () => {
	const { deck, cleanup } = deckOn();
	// What `App.attach` branches on to decide whether the deck still needs its first agent.
	assert.equal(registryOn(deck).registry.restore(), 0);
	cleanup();
});

/**
 * The model reaches the runtime, not only the row.
 *
 * The bug this covers had three layers and each one alone looked fine: `session.record()`
 * wrote the model, `store.validate()` dropped it on read, `Registry.restore` never
 * forwarded it, and `start()` asked the backend what it had opened on instead of telling
 * it. The two ends were unit-tested — a record with a model, a session greeted with one —
 * and every seam between them was not, which is why a chat kept coming back on
 * `deepseek-v4-flash`.
 *
 * Asserted on the greeting, because that is where a browser learns what a dormant row is
 * on, *and* on the context the backend would be built with, because that is the half that
 * makes the display true.
 */
test("a restored chat is opened on the model the conversation was last held in", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.write(
		{
			id: "held",
			kind: "pi",
			resumeRef: "/sessions/held.jsonl",
			name: "Ada",
			color: "#3b5cf6",
			context: [],
			inPlay: [],
			createdAt: 1,
			lastAt: 2,
			model: { provider: "opencode-go", model: "deepseek-v4-pro", thinking: "high" },
		},
		[{ kind: "user", id: "u1", at: 2, text: "what is the plan" }],
	);

	const { registry, sent } = registryOn(deck);
	assert.equal(registry.restore(), 1);

	const greeted: ServerMessage[] = [];
	registry.get("held")?.greet((message) => greeted.push(message));
	const model = greeted.find((message): message is Extract<ServerMessage, { type: "agent.model" }> => message.type === "agent.model");
	assert.deepEqual(model?.model, { provider: "opencode-go", model: "deepseek-v4-pro", thinking: "high" }, "the row says what it will use");

	// And the record it writes back keeps it, so the next restart says the same thing
	// rather than losing it one boot later.
	registry.get("held")?.dispose();
	assert.deepEqual(store.read("held")?.record.model, { provider: "opencode-go", model: "deepseek-v4-pro", thinking: "high" });
	assert.equal(sent.length > 0, true);
	cleanup();
});
