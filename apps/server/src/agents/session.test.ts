import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentModel, ChatItem, ServerMessage } from "@decks/protocol";
import { Deck } from "../deck/loader.ts";
import type { StageService } from "../stage/service.ts";
import { DeckAgent } from "./session.ts";
import { SnapshotStore } from "./snapshot.ts";
import { AgentStore } from "./store.ts";

/**
 * The two sets and the invariant between them (DESIGN §2).
 *
 * `DeckAgent` is constructed without starting a Pi session — `start()` is lazy — so the
 * set arithmetic can be exercised on its own, which is where the invariant lives: what is
 * on the canvas is always a subset of what the agent is holding.
 */
function agentOn(
	boards: string[],
	options: {
		parentId?: string;
		resumeRef?: string;
		restored?: { id: string; items: ChatItem[]; context: string[]; inPlay: string[]; avatar?: string; createdAt: number; model?: AgentModel };
	} = {},
) {
	const root = mkdtempSync(join(tmpdir(), "decks-sets-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	for (const name of boards) {
		writeFileSync(join(root, "boards", name), `<!doctype html><title>${name}</title><body class="board"></body>`);
	}
	const sent: ServerMessage[] = [];
	const deck = Deck.open(root);
	const agent = new DeckAgent(
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
			// The real one pastes the board source in; here the task is the whole briefing, so
			// a drained item is recognisable in the transcript by its own words.
			brief: (task: string) => task,
			recordRevision: () => undefined,
			boardPathOf: () => undefined,
		},
		// Given a store, but nothing reaches it here: an agent with no user message is never
		// written down, which is what keeps these tests off the disk.
		{ color: "#000", kind: "pi", snapshots: new SnapshotStore(), store: new AgentStore(deck), ...options },
	);
	const context = () => agent.context.join(" ");
	const inPlay = () => agent.inPlay.join(" ");
	const last = () => sent.filter((message) => message.type === "context.changed").at(-1);
	return { agent, context, inPlay, last, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

	test("a dormant chat greets the model it was restored with", () => {
		const { agent, cleanup } = agentOn([], {
			restored: {
				id: "restored-1",
				items: [{ kind: "user", id: "m1", text: "hello", at: 1 }],
				context: [],
				inPlay: [],
				createdAt: 1,
				model: { provider: "claude", model: "claude-sonnet-4", thinking: "low" },
			},
		});
		const sent: ServerMessage[] = [];
		agent.greet((message) => sent.push(message));
		const model = sent.find((message): message is Extract<ServerMessage, { type: "agent.model" }> => message.type === "agent.model");
		assert.ok(model, "greet should report a model for a dormant chat");
		assert.deepEqual(model.model, { provider: "claude", model: "claude-sonnet-4", thinking: "low" });
		cleanup();
	});

	test("a dormant chat without a recorded model recovers it from its pi session file", () => {
		const root = mkdtempSync(join(tmpdir(), "decks-session-model-"));
		const session = join(root, "resume.jsonl");
		writeFileSync(
			session,
			[
				JSON.stringify({ type: "session", version: 1, cwd: root }),
				JSON.stringify({ type: "model_change", provider: "opencode-go", modelId: "deepseek-v4-flash" }),
				JSON.stringify({ type: "thinking_level_change", thinkingLevel: "high" }),
				JSON.stringify({ type: "model_change", provider: "opencode-go", modelId: "deepseek-v4-flash" }),
			].join("\n"),
		);
		const { agent, cleanup } = agentOn([], {
			resumeRef: session,
			restored: {
				id: "restored-2",
				items: [{ kind: "user", id: "m1", text: "hello", at: 1 }],
				context: [],
				inPlay: [],
				createdAt: 1,
			},
		});
		const sent: ServerMessage[] = [];
		agent.greet((message) => sent.push(message));
		const model = sent.find((message): message is Extract<ServerMessage, { type: "agent.model" }> => message.type === "agent.model");
		assert.ok(model, "greet should report the model recovered from the session file");
		assert.deepEqual(model.model, { provider: "opencode-go", model: "deepseek-v4-flash", thinking: "high" });
		cleanup();
		rmSync(root, { recursive: true, force: true });
	});

test("holding a board puts it on the canvas; the canvas is a subset of what is held", () => {
	const { agent, context, inPlay, cleanup } = agentOn(["a.html", "b.html", "c.html"]);

	agent.setContext(["boards/a.html", "boards/b.html"]);
	assert.equal(context(), "boards/a.html boards/b.html");
	// Setting the context alone does not put anything on the canvas — `attach` does that,
	// and it is the caller that pairs them.
	assert.equal(inPlay(), "");

	agent.setInPlay(["boards/a.html"]);
	assert.equal(inPlay(), "boards/a.html");
	assert.equal(context(), "boards/a.html boards/b.html", "showing what is held changes nothing else");
	cleanup();
});

test("showing a board the agent was not holding attaches it", () => {
	const { agent, context, inPlay, cleanup } = agentOn(["a.html", "b.html"]);
	agent.setContext(["boards/a.html"]);

	agent.setInPlay(["boards/b.html"]);
	assert.equal(inPlay(), "boards/b.html");
	assert.equal(context(), "boards/a.html boards/b.html", "b is now held, appended in order");
	cleanup();
});

test("dropping a board from the context takes it off the canvas", () => {
	const { agent, context, inPlay, cleanup } = agentOn(["a.html", "b.html"]);
	agent.setInPlay(["boards/a.html", "boards/b.html"]);
	assert.equal(inPlay(), "boards/a.html boards/b.html");

	agent.setContext(["boards/a.html"]);
	assert.equal(context(), "boards/a.html");
	assert.equal(inPlay(), "boards/a.html", "a board in play that is no longer held would be a third state");
	cleanup();
});

test("taking a board off the canvas leaves it held", () => {
	const { agent, context, inPlay, cleanup } = agentOn(["a.html", "b.html"]);
	agent.setInPlay(["boards/a.html", "boards/b.html"]);

	// What `stage.hide` and the board's × both do.
	agent.setInPlay(agent.inPlay.filter((path) => path !== "boards/a.html"));
	assert.equal(inPlay(), "boards/b.html");
	assert.equal(context(), "boards/a.html boards/b.html");
	cleanup();
});

test("both sets travel together, and neither repeats itself", () => {
	const { agent, last, cleanup } = agentOn(["a.html", "b.html"]);
	agent.setInPlay(["boards/a.html", "boards/a.html", "boards/b.html"]);

	const message = last();
	assert.ok(message && message.type === "context.changed");
	assert.deepEqual(message.inPlay, ["boards/a.html", "boards/b.html"], "deduplicated");
	assert.deepEqual(message.boards, ["boards/a.html", "boards/b.html"]);
	cleanup();
});

test("the chat row counts what is held, not what is shown", () => {
	const { agent, cleanup } = agentOn(["a.html", "b.html"]);
	agent.setContext(["boards/a.html", "boards/b.html"]);
	agent.setInPlay(["boards/a.html"]);
	assert.equal(agent.chat().contextCount, 2);
	cleanup();
});

test("a deleted board leaves the context, and only the deleted one", () => {
	const { agent, context, inPlay, last, cleanup } = agentOn(["a.html", "b.html"]);
	agent.setInPlay(["boards/a.html", "boards/b.html"]);

	assert.equal(agent.forget("boards/a.html"), true);
	assert.equal(context(), "boards/b.html");
	assert.equal(inPlay(), "boards/b.html");
	const message = last();
	assert.ok(message && message.type === "context.changed");
	assert.deepEqual(message.boards, ["boards/b.html"], "the removal is published, not just recorded");
	cleanup();
});

test("forgetting a board nobody holds says so, and stays quiet", () => {
	const { agent, cleanup } = agentOn(["a.html", "b.html"]);
	agent.setInPlay(["boards/a.html"]);
	const before = agent.context.join(" ");

	// The watcher reports every deletion in the deck, so most calls are about boards this
	// agent never held; those must not emit a context.changed and re-render every rail.
	assert.equal(agent.forget("boards/b.html"), false);
	assert.equal(agent.context.join(" "), before);
	cleanup();
});

test("an agent left holding only a deleted board is holding nothing", () => {
	const { agent, context, inPlay, cleanup } = agentOn(["a.html"]);
	agent.setInPlay(["boards/a.html"]);

	// This is the case that emptied both the rail and the canvas: a non-empty context of
	// one dead path, which is not empty enough to trigger the whole-deck fallback.
	agent.forget("boards/a.html");
	assert.equal(context(), "");
	assert.equal(inPlay(), "");
	cleanup();
});

test("a subagent outlives the parent it reported to", () => {
	const { agent, cleanup } = agentOn(["a.html"], { parentId: "parent-1" });
	assert.equal(agent.parentId, "parent-1");

	// Addressed to a specific parent: another chat closing is not this one's business.
	agent.orphan("someone-else");
	assert.equal(agent.parentId, "parent-1", "an unrelated removal changes nothing");

	// Its own parent closing promotes it to a top-level chat rather than leaving it
	// tagged with a name that no longer resolves.
	agent.orphan("parent-1");
	assert.equal(agent.parentId, undefined);
	assert.equal(agent.chat().parentId, undefined, "and the row stops claiming it");
	cleanup();
});

/*
 * The queue another agent fills, and the quiet period before it is drained (§6.2).
 *
 * `run` is overridden rather than stubbed through the host, because the drain's contract is
 * exactly that it calls it: one item at a time, only while idle, and never a second one
 * before the first has come back. A real `run` would start a model runtime and these tests
 * would take as long as a conversation.
 */
class Probe extends DeckAgent {
	readonly ran: string[] = [];
	override async run(text: string): Promise<{ report: string; boards: string[] }> {
		this.ran.push(text);
		return { report: "done", boards: [] };
	}
}

function probeOn(): { agent: Probe; sent: ServerMessage[]; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "decks-queue-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	writeFileSync(join(root, "boards", "plan.html"), `<!doctype html><title>plan</title><body class="board"></body>`);
	const sent: ServerMessage[] = [];
	const deck = Deck.open(root);
	const agent = new Probe(
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
			brief: (task: string, boards: string[]) => (boards.length > 0 ? `${task} [${boards.join(" ")}]` : task),
			recordRevision: () => undefined,
			boardPathOf: () => undefined,
		},
		{ color: "#000", kind: "pi", snapshots: new SnapshotStore(), store: new AgentStore(deck) },
	);
	return { agent, sent, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const item = (task: string, boards: string[] = []) => ({ from: "a1", fromName: "Ada", task, boards, at: 1 });
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("queued work is announced when it arrives, not when it runs", () => {
	const { agent, sent, cleanup } = probeOn();
	const position = agent.enqueue(item("Remeasure the panel numbers"));

	assert.equal(position, 1, "and the sender is told where it landed");
	assert.equal(agent.queued, 1);
	const notice = sent.filter((message) => message.type === "chat.item").at(-1);
	assert.ok(notice && notice.type === "chat.item" && notice.item.kind === "notice", "a notice in the receiver's transcript");
	assert.match(notice.item.text, /Ada queued work for you: Remeasure the panel numbers/);
	cleanup();
});

test("a queue is capped, and the item over the cap is refused rather than dropped", () => {
	const { agent, cleanup } = probeOn();
	for (let n = 0; n < 8; n++) agent.enqueue(item(`task ${n}`));
	assert.equal(agent.queued, 8);
	assert.throws(() => agent.enqueue(item("one too many")), /already has 8 items waiting/);
	assert.equal(agent.queued, 8, "and nothing was queued");
	cleanup();
});

test("the queue drains once the agent has been quiet, one item at a time", async () => {
	process.env.DECKS_QUEUE_IDLE_MS = "10";
	const { agent, cleanup } = probeOn();
	agent.enqueue(item("first", ["boards/plan.html"]));
	agent.enqueue(item("second"));

	await settle(80);
	// The brief is composed when the item runs, so the board source is the one that exists
	// then — here the stub just names what it was handed.
	assert.deepEqual(agent.ran, ["first [boards/plan.html]", "second"]);
	assert.equal(agent.queued, 0);
	delete process.env.DECKS_QUEUE_IDLE_MS;
	cleanup();
});

test("a busy agent is not interrupted, and the countdown restarts when it goes quiet", async () => {
	process.env.DECKS_QUEUE_IDLE_MS = "10";
	const { agent, cleanup } = probeOn();
	agent.translator.setState("thinking");
	agent.enqueue(item("waits its turn"));

	await settle(60);
	assert.deepEqual(agent.ran, [], "nothing ran while the agent was working");

	// `waiting` is a question the agent asked the user. It is not idle, and the timer must
	// not fire under it either.
	agent.translator.setState("waiting");
	await settle(60);
	assert.deepEqual(agent.ran, [], "nor while it is waiting on an answer");

	agent.translator.setState("idle");
	await settle(60);
	assert.deepEqual(agent.ran, ["waits its turn"]);
	delete process.env.DECKS_QUEUE_IDLE_MS;
	cleanup();
});

test("an item is popped before it runs, so a failure cannot loop", async () => {
	process.env.DECKS_QUEUE_IDLE_MS = "10";
	const { agent, sent, cleanup } = probeOn();
	let calls = 0;
	agent.run = async () => {
		calls++;
		throw new Error("the model fell over");
	};
	agent.enqueue(item("doomed"));

	await settle(80);
	assert.equal(calls, 1, "tried once");
	assert.equal(agent.queued, 0, "and not put back");
	const notice = sent.filter((message) => message.type === "chat.item").at(-1);
	assert.ok(notice && notice.type === "chat.item" && notice.item.kind === "notice");
	assert.match(notice.item.text, /Queued work from Ada failed: the model fell over/);
	delete process.env.DECKS_QUEUE_IDLE_MS;
	cleanup();
});
