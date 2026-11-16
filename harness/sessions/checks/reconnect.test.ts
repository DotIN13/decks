// The harness across a server restart, with no model: a real Decks-local process killed and started
// again under it, on the same deck and port, with a new token. The harness finds the new server by the
// deck's lock file, says hello again, and its running agent is adopted, given its new token, and
// answers a message sent after the restart. Port 4673.
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientFor } from "@decks/sdk";
import { readLock, startHarness, type Harness } from "../../host.ts";
import { startServer } from "../../main.ts";
import type { AgentBackend, AgentBackendContext } from "../../runtimes/backend.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRATCH = join(ROOT, ".scratch/Helm/reconnect");
const DECK = join(SCRATCH, "deck");
const PORT = "4673";
const said: string[] = [];
let server: ChildProcess;
let harness: Harness;

/** A runtime with no model: each message is kept as it arrives (news and reminders in front), and answered at once. */
function fakeRuntime(_context: AgentBackendContext): AgentBackend {
	return {
		capabilities: { modes: [] },
		isStreaming: false,
		prompt: async (text: string) => void said.push(text),
		abort: async () => {},
		commands: () => [],
		model: () => undefined,
		setModel: async () => {},
		setThinking: () => {},
		models: async () => [],
		usage: () => null,
		name: () => undefined,
		setName: () => {},
		sessionRef: () => undefined,
		timeline: () => [],
		syncEntryIds: async () => {},
		revisionsAt: () => ({}),
		rewindTo: async () => ({ cancelled: false }),
		forkFrom: async () => undefined,
		dispose: () => {},
	} as AgentBackend;
}

const until = async <T>(what: string, probe: () => T | undefined | Promise<T | undefined>, ms = 20_000): Promise<T> => {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
		const got = await probe();
		if (got !== undefined) return got;
	}
	throw new Error(`Waited ${ms} ms for ${what}.`);
};

/** The server process stopped, and gone: its lock no longer names a live process. */
async function kill(child: ChildProcess): Promise<void> {
	const gone = new Promise((done) => child.once("exit", done));
	child.kill("SIGTERM");
	await gone;
}

before(async () => {
	rmSync(SCRATCH, { recursive: true, force: true });
	cpSync(join(ROOT, "tools/fixtures/deck"), DECK, { recursive: true });
	const started = await startServer(DECK, PORT);
	server = started.child;
	harness = await startHarness({ url: started.lock.url, token: started.lock.token, deck: DECK, home: join(SCRATCH, "home"), kinds: ["pi"], firstAgent: false, open: async (context) => fakeRuntime(context) });
});

after(async () => {
	await harness?.stop();
	if (server && server.exitCode === null) await kill(server);
	rmSync(SCRATCH, { recursive: true, force: true });
});

test("a restarted server is found again, its agent adopted with a new token, and a message after the restart reaches the agent", async () => {
	const lock = readLock(DECK)!;
	const first = clientFor(lock.url, lock.token);
	const agent = (await first.call("agent.create", { kind: "pi", name: "Steady" })).value as { id: string };
	const session = await until("the session", () => harness.sessions.get(agent.id));
	const tokenBefore = (session as unknown as { saved: { token?: string } }).saved.token;
	assert.ok(tokenBefore, "the agent has a token from the first server");

	await kill(server);
	await until("the harness to see the line drop", () => (harness.connected() ? undefined : true));
	const again = await startServer(DECK, PORT);
	server = again.child;
	await until("the harness to connect again", () => (harness.connected() ? true : undefined));

	const person = clientFor(again.lock.url, again.lock.token);
	const tokenOf = () => (session as unknown as { saved: { token?: string } }).saved.token;
	await until("the agent adopted again, with the new server's token", () => (tokenOf() !== tokenBefore ? true : undefined));
	assert.equal(harness.sessions.get(agent.id), session, "the same session, picked up, not a new one");
	const record = ((await person.call("agent.list")).value as Array<{ id: string; state?: string }>).find((one) => one.id === agent.id);
	assert.equal(record?.state, "idle", "the server is told the agent's state");

	await person.call("chat.send", { agent: agent.id, text: "Still there after the restart?" });
	await until("the message to reach the agent", () => (said.some((text) => text.includes("Still there after the restart?")) ? true : undefined));
});

