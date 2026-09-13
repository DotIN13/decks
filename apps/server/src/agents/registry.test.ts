import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentChat, AgentKind, AgentMode, ServerMessage, ThinkingLevel } from "@decks/protocol";
import { Deck } from "../deck/loader.ts";
import type { StageService } from "../stage/service.ts";
import { Registry } from "./registry.ts";
import { DeckAgent } from "./session.ts";
import { AgentStateStore } from "./agent-state.ts";
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
			send: () => ({ queued: true as const, position: 1 }),
			queue: () => [],
			report: () => {},
			// The real one pastes the board source in; here the task is the whole briefing, so
			// a drained item is recognisable in the transcript by its own words.
			brief: (task: string) => task,
			recordRevision: () => undefined,
			boardPathOf: () => undefined,
		},
		{ color, kind: "pi", snapshots: new AgentStateStore(), store: new AgentStore(deck) },
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

/*
 * Routing work to an agent that already exists (§6.2).
 *
 * Dormant rows on purpose: nothing here starts a runtime, and a queue is exactly the thing
 * that should be fillable while the receiver is asleep. What is under test is the routing
 * and the bookkeeping — the drain itself belongs to `session.test.ts`, which can watch it.
 */
function twoRestored(deck: Deck): { registry: Registry; ada: string; kit: string } {
	for (const name of ["Ada", "Kit"]) {
		const agent = agentOn(deck);
		agent.rename(name);
		agent.translator.user("hello");
		agent.dispose();
	}
	const { registry } = registryOn(deck);
	registry.restore();
	const idOf = (name: string) => registry.chats().find((chat) => chat.name === name)?.id ?? "";
	return { registry, ada: idOf("Ada"), kit: idOf("Kit") };
}

test("work can be sent to an agent by name, and lands in its queue", () => {
	const { deck, cleanup } = deckOn();
	const { registry, ada, kit } = twoRestored(deck);

	const result = registry.send(ada, "Kit", { task: "Remeasure the panel", boards: ["boards/plan.html", "boards/gone.html"] });
	assert.deepEqual(result, { queued: true, position: 1 });

	const waiting = registry.get(kit)?.queue() ?? [];
	assert.equal(waiting.length, 1);
	assert.equal(waiting[0]?.fromName, "Ada", "and it says who sent it");
	assert.deepEqual(waiting[0]?.boards, ["boards/plan.html"], "boards that do not exist are dropped");
	assert.deepEqual([...(registry.get(kit)?.context ?? [])], [], "and the receiver's own context is untouched");
	cleanup();
});

test("a second item queues behind the first, and every agent can see the backlog", () => {
	const { deck, cleanup } = deckOn();
	const { registry, ada, kit } = twoRestored(deck);

	assert.equal(registry.send(ada, kit, { task: "one" }).position, 1, "by id as well as by name");
	assert.equal(registry.send(ada, kit, { task: "two" }).position, 2);
	assert.equal(registry.summaries().find((agent) => agent.id === kit)?.queued, 2);
	assert.equal(registry.summaries().find((agent) => agent.id === ada)?.queued, 0);
	cleanup();
});

test("sending to yourself is allowed — it is how you leave yourself a follow-up", () => {
	const { deck, cleanup } = deckOn();
	const { registry, ada } = twoRestored(deck);
	assert.equal(registry.send(ada, ada, { task: "and then check the numbers" }).position, 1);
	cleanup();
});

test("an address that cannot be resolved is refused rather than guessed at", () => {
	const { deck, cleanup } = deckOn();
	const { registry, ada } = twoRestored(deck);

	assert.throws(() => registry.send(ada, "Nobody", { task: "x" }), /No agent Nobody/);

	// Two agents with the same name is a real state — the user can rename either — and
	// picking one of them would send work to the wrong conversation silently.
	registry.get(ada)?.rename("Kit");
	assert.throws(() => registry.send(ada, "Kit", { task: "x" }), /More than one agent is called Kit/);
	cleanup();
});

/*
 * What `stage.agents()` reports about every agent — the twenty newest boards, the true
 * total, and the runtime.
 *
 * The cap is a screen of the held list, not a truncation: `holding` rides beside it so a
 * reader can tell a slice from everything before deciding whether to ask for more. And
 * `kind` is the load-bearing word — whether the row is a Claude one or an antigravity one
 * changes what handing work to it means.
 */
test("summaries reports the twenty newest boards, the true total, and the runtime", () => {
	const { deck, cleanup } = deckOn();

	const agent = agentOn(deck);
	agent.translator.user("hello");
	const id = agent.id;
	agent.dispose();

	const { registry } = registryOn(deck);
	registry.restore();
	const held = registry.get(id)!;
	const paths = Array.from({ length: 25 }, (_, index) => `boards/b${index}.html`);
	held.setContext(paths);

	const summary = registry.summaries().find((row) => row.id === id)!;
	assert.equal(summary.holding, 25, "the true total is not truncated");
	assert.deepEqual(summary.context, paths.slice(0, 20), "but the list reported is the twenty newest");
	assert.equal(summary.kind, "pi", "and the runtime is on the row");
	cleanup();
});

/*
 * `Registry.spawn` honouring what a delegation asked for (§6.2).
 *
 * Spawn creates the child through `Registry.create`, which would start a real runtime — the
 * thing these tests exist to avoid. So `create` is overridden to hand spawn a `SpyChild`
 * whose `setModel`/`setMode`/`setThinking`/`run` record rather than reach a backend, and
 * a parent built directly (the way the registry test harness builds every agent) is put on
 * the list under its real id so `spawn` can find it and write its notices to it.
 */
class SpyChild extends DeckAgent {
	readonly models: Array<[string, string, ThinkingLevel | undefined]> = [];
	readonly modes: AgentMode[] = [];
	readonly thinkings: ThinkingLevel[] = [];
	override async start(): Promise<void> {}
	override async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		this.models.push([provider, model, thinking]);
	}
	override async setMode(mode: AgentMode): Promise<void> {
		this.modes.push(mode);
	}
	override async setThinking(level: ThinkingLevel): Promise<void> {
		this.thinkings.push(level);
	}
	override async run(text: string): Promise<{ report: string; boards: string[] }> {
		return { report: "done", boards: [] };
	}
}

function spawnHarness(deck: Deck, childKind: AgentKind): { registry: Registry; parentId: string; child: () => SpyChild | undefined; sent: ServerMessage[] } {
	const sent: ServerMessage[] = [];
	let child: SpyChild | undefined;

	class SpyRegistry extends Registry {
		override create(options: { name?: string; parentId?: string; kind?: AgentKind } = {}) {
			const agent = new SpyChild(
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
				{
					...(options.name ? { name: options.name } : {}),
					...(options.parentId ? { parentId: options.parentId } : {}),
					color: "#2eaf5a",
					kind: options.kind ?? childKind,
					snapshots: new AgentStateStore(),
					store: new AgentStore(deck),
				},
			);
			child = agent;
			return agent;
		}
	}

	const registry = new SpyRegistry(deck, (message) => sent.push(message), {} as StageService, {
		port: 4329,
		defaultKind: "pi",
		camera: () => ({ x: 0, y: 0, zoom: 1 }),
		recordRevision: () => undefined,
		boardPathOf: () => undefined,
	});
	// The parent: built directly so nothing starts, spoken to so its notices land, then put
	// on the registry's list under its real id — which is all `spawn` asks of it. Its emit
	// goes to the same `sent` the registry's does, so a refusal notice is observable.
	const parent = new DeckAgent(
		deck,
		(message) => sent.push(message),
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
	parent.translator.user("delegate something");
	(registry as unknown as { agents: DeckAgent[] }).agents.push(parent);
	return { registry, parentId: parent.id, child: () => child, sent };
}

test("spawn passes the asked-for kind to create, and the child is that runtime", async () => {
	const { deck, cleanup } = deckOn();
	const { registry, parentId, child } = spawnHarness(deck, "pi");

	await registry.spawn(parentId, { task: "survey the deck", kind: "claude", boards: ["boards/plan.html"] });
	assert.equal(child()?.kind, "claude", "the child was created on the runtime asked for, not the default");
	cleanup();
});

test("spawn passes the thinking level as setModel's third argument", async () => {
	const { deck, cleanup } = deckOn();
	const { registry, parentId, child } = spawnHarness(deck, "claude");

	await registry.spawn(parentId, { task: "x", model: "pi/deepseek-v4", thinking: "high" });
	assert.deepEqual(child()?.models, [["pi", "deepseek-v4", "high"]], "the level reaches the backend, which is where it used to be dropped");
	cleanup();
});

test("thinking asked for without a model is applied to the default", async () => {
	const { deck, cleanup } = deckOn();
	const { registry, parentId, child } = spawnHarness(deck, "pi");

	await registry.spawn(parentId, { task: "x", thinking: "max" });
	assert.deepEqual(child()?.thinkings, ["max"]);
	cleanup();
});

test("a mode the runtime offers reaches the child's setMode", async () => {
	const { deck, cleanup } = deckOn();
	const { registry, parentId, child } = spawnHarness(deck, "claude");

	await registry.spawn(parentId, { task: "x", mode: "plan" });
	assert.deepEqual(child()?.modes, ["plan"]);
	cleanup();
});

test("a mode a runtime does not offer is a notice, not an error — pi has no modes at all", async () => {
	const { deck, cleanup } = deckOn();
	const { registry, parentId, child, sent } = spawnHarness(deck, "pi");

	const report = await registry.spawn(parentId, { task: "x", mode: "plan" });
	assert.equal(report.report, "done", "the child still did the work, on the mode it has");
	assert.deepEqual(child()?.modes, [], "no mode was set");
	const notice = sent.filter((message) => message.type === "chat.item").at(-1);
	assert.ok(notice && notice.type === "chat.item" && notice.item.kind === "notice");
	assert.match(notice.item.text, /Subagent stays in its default mode: pi cannot do "plan"/);
	cleanup();
});

/*
 * The reply: `send(to, { reply: true })` — the report comes back to the sender.
 *
 * The flag rides on the queued item; the delivery is the receiver's `drain()` calling
 * `report` on the host, which this registry turns into a notice in the sender's transcript.
 * The no-loop rule is the shape of that delivery: a notice, never a task — a task in a
 * queue runs a turn when it drains, and a turn that answers a report with another report
 * is two agents talking forever.
 */
test("send carries reply into the queued item, and not without it", () => {
	const { deck, cleanup } = deckOn();
	const { registry, ada, kit } = twoRestored(deck);

	registry.send(ada, kit, { task: "one", reply: true });
	registry.send(ada, kit, { task: "two" });
	const waiting = registry.get(kit)?.queue() ?? [];
	assert.equal(waiting.length, 2);
	assert.equal(waiting[0]?.reply, true);
	assert.equal(waiting[1]?.reply, undefined, "plain sends stay plain");
	cleanup();
});

/**
 * A receiver that can actually drain without a runtime – the registry's `send`/`enqueue`
 * path from one end to the other, with `run` stubbed the way `session.test.ts` stubs it.
 */
class DrainingChild extends DeckAgent {
	readonly ran: string[] = [];
	override async run(text: string): Promise<{ report: string; boards: string[] }> {
		this.ran.push(text);
		return { report: "the numbers are 42px", boards: [] };
	}
}

function replyHarness(deck: Deck): { registry: Registry; sender: DrainingChild; receiver: DrainingChild; sent: ServerMessage[] } {
	const sent: ServerMessage[] = [];
	const created: DrainingChild[] = [];
	const registry = new (class extends Registry {
		override create(options: { name?: string } = {}) {
			const agent = new DrainingChild(
				deck,
				(message) => sent.push(message),
				{} as StageService,
				{
					port: 4329,
					camera: () => ({ x: 0, y: 0, zoom: 1 }),
					agents: () => [],
					spawn: async () => ({ agent: "", name: "", report: "", boards: [] }),
					send: (fromId, target, spec) => this.send(fromId, target, spec),
					queue: (agentId) => this.get(agentId)?.queue() ?? [],
					// The real wiring under test: the receiver's `report` call becomes a
					// notice in whoever is named — a transcript item, not a queued task.
					report: (agentId, text) => this.get(agentId)?.translator.notice("info", text),
					brief: (task: string, boards: string[]) => (boards.length > 0 ? `${task} [${boards.join(" ")}]` : task),
					recordRevision: () => undefined,
					boardPathOf: () => undefined,
				},
				{ name: options.name ?? "Agent", color: "#2eaf5a", kind: "pi", snapshots: new AgentStateStore(), store: new AgentStore(deck) },
			);
			(this as unknown as { agents: DeckAgent[] }).agents.push(agent);
			(this as unknown as { focusedId?: string }).focusedId ??= agent.id;
			created.push(agent);
			return agent;
		}
	})(deck, (message) => sent.push(message), {} as StageService, {
		port: 4329,
		defaultKind: "pi",
		camera: () => ({ x: 0, y: 0, zoom: 1 }),
		recordRevision: () => undefined,
		boardPathOf: () => undefined,
	});

	const sender = registry.create({ name: "Ada" });
	const receiver = registry.create({ name: "Kit" });
	return { registry, sender: sender as DrainingChild, receiver: receiver as DrainingChild, sent };
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a reply is delivered as a notice in the sender's transcript — and never runs a turn of their own", async () => {
	process.env.DECKS_QUEUE_IDLE_MS = "10";
	const { deck, cleanup } = deckOn();
	const { registry, sender, receiver, sent } = replyHarness(deck);

	registry.send(sender.id, receiver.id, { task: "Remeasure the panel numbers", boards: ["boards/plan.html"], reply: true });
	await settle(80);

	assert.deepEqual(receiver.ran, ["Remeasure the panel numbers [boards/plan.html]"], "the receiver did the work");
	assert.equal(receiver.queued, 0, "and its queue drained");
	const notices = sent.filter(
		(message): message is Extract<ServerMessage, { type: "chat.item" }> => message.type === "chat.item" && message.item.kind === "notice",
	);
	assert.ok(
		notices.some(
			(message) => message.item.kind === "notice" && /Kit finished "Remeasure the panel numbers": the numbers are 42px/.test(message.item.text),
		),
		"the report landed in the sender's transcript as a notice",
	);
	// The no-loop rule: nothing was queued to the sender, so nothing can ever wake them to
	// answer the report — the reply is read when they next look, not turned into a turn.
	assert.equal(sender.queued, 0, "no task landed in the sender's queue");
	assert.deepEqual(sender.ran, [], "and no turn of the sender ever ran");
	delete process.env.DECKS_QUEUE_IDLE_MS;
	cleanup();
});
