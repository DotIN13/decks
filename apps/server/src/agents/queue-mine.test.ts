import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ServerMessage } from "@decks/protocol";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";

/*
 * Ctrl+Enter queues a message for the end of the turn (`DeckAgent.queueMine`): one per turn, before
 * work other agents hand over, held by Stop until it is let go. A runtime is stood in for by
 * recording what `prompt` is given and moving the agent's state by hand.
 */
function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-queue-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const agent = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
	const sent: string[] = [];
	const said: Array<Extract<ServerMessage, { type: "agent.queued" }>> = [];
	(agent as unknown as { prompt: (text: string) => Promise<void> }).prompt = async (text) => {
		sent.push(text);
		state("thinking");
	};
	const state = (to: "idle" | "thinking") => (agent as unknown as { translator: { setState: (s: string) => void } }).translator.setState(to);
	const emit = (agent as unknown as { emit: (m: ServerMessage) => void }).emit;
	(agent as unknown as { emit: (m: ServerMessage) => void }).emit = (message) => {
		if (message.type === "agent.queued") said.push(message);
		emit(message);
	};
	return { agent, sent, said, state, cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })) };
}

test("with nothing running a queued message is simply sent; while working it waits, one per turn", () => {
	const { agent, sent, said, state, cleanup } = open();
	try {
		agent.queueMine("first");
		assert.deepEqual(sent, ["first"], "idle: sent at once");
		agent.queueMine("second");
		agent.queueMine("third");
		assert.deepEqual(sent, ["first"], "working: held");
		assert.deepEqual(said.at(-1)?.items.map((one) => one.text), ["second", "third"]);
		state("idle");
		assert.deepEqual(sent, ["first", "second"], "the turn ended: the next one goes");
		state("idle");
		assert.deepEqual(sent, ["first", "second", "third"]);
		assert.equal(said.at(-1)?.items.length, 0);
	} finally {
		cleanup();
	}
});

test("Stop holds the queue until it is let go, and a row can be removed or sent now", async () => {
	const { agent, sent, said, state, cleanup } = open();
	try {
		agent.queueMine("working on it");
		agent.queueMine("a");
		agent.queueMine("b");
		await agent.abort();
		state("idle");
		assert.deepEqual(sent, ["working on it"], "stopped: nothing more goes");
		assert.equal(said.at(-1)?.held, true);
		const [, b] = said.at(-1)!.items;
		agent.unqueueMine(b!.id);
		assert.deepEqual(said.at(-1)?.items.map((one) => one.text), ["a"]);
		agent.queueMine("c");
		agent.sendMineNow(said.at(-1)!.items.find((one) => one.text === "c")!.id);
		assert.deepEqual(sent, ["working on it", "c"], "send now goes whatever is held");
		state("idle");
		agent.releaseMine();
		assert.deepEqual(sent, ["working on it", "c", "a"], "let go: the rest goes");
	} finally {
		cleanup();
	}
});
