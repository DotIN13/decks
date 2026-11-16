// The harness's eight events, each caused with no model and heard told through Decks-local
// on the person's event stream: a real server process, the harness in this process, and a
// fake runtime that asks a question and notices something. Port 4672.
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientFor, type Client, type Heard } from "@decks/sdk";
import { startHarness, type Harness } from "../../host.ts";
import { startServer } from "../../main.ts";
import type { AgentBackend, AgentBackendContext } from "../../runtimes/backend.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRATCH = join(ROOT, ".scratch/Helm/events");
const heard: Heard[] = [];
let server: ChildProcess;
let harness: Harness;
let person: Client;
let stop: () => void;

/** A runtime with no model: a message is answered at once, after a question and a notice. */
function fakeRuntime(context: AgentBackendContext): AgentBackend {
	let entry = 0;
	return {
		capabilities: { modes: [] },
		isStreaming: false,
		prompt: async (text: string) => {
			context.notice("warn", "The fake runtime noticed something.");
			if (text.includes("ask me")) void context.bridge.choose({ title: "Which one?", options: [{ label: "A" }, { label: "B" }] });
		},
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
		syncEntryIds: async () => {
			for (const one of context.translator.userMessages()) if (!(one as { entryId?: string }).entryId) context.translator.tagUser(one.id, `e${++entry}`);
		},
		revisionsAt: () => ({}),
		rewindTo: async () => ({ cancelled: false }),
		forkFrom: async () => undefined,
		dispose: () => {},
	} as AgentBackend;
}

const until = async <T>(what: string, probe: () => T | undefined, ms = 10_000): Promise<T> => {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
		const got = probe();
		if (got !== undefined) return got;
	}
	throw new Error(`Waited ${ms} ms for ${what}.`);
};
const told = (name: string, ok: (payload: Record<string, unknown>) => boolean = () => true) =>
	until(name, () => heard.find((one) => one.name === name && ok(one.payload as Record<string, unknown>)));

before(async () => {
	rmSync(SCRATCH, { recursive: true, force: true });
	const deck = join(SCRATCH, "deck");
	cpSync(join(ROOT, "tools/fixtures/deck"), deck, { recursive: true });
	const started = await startServer(deck, "4672");
	server = started.child;
	person = clientFor(started.lock.url, started.lock.token);
	stop = person.events((event) => heard.push(event)).stop;
	harness = await startHarness({ url: started.lock.url, token: started.lock.token, deck, home: join(SCRATCH, "home"), kinds: ["pi"], firstAgent: false, open: async (context) => fakeRuntime(context) });
});

after(async () => {
	stop?.();
	await harness?.stop();
	server?.kill("SIGTERM");
	rmSync(SCRATCH, { recursive: true, force: true });
});

test("chat.added, chat.changed, runtime.noticed, chat.asked and chat.answered are told through the server", async () => {
	const agent = (await person.call("agent.create", { kind: "pi", name: "Probe" })).value as { id: string };
	await until("the session", () => harness.sessions.get(agent.id));
	await person.call("chat.send", { agent: agent.id, text: "Hello, ask me something." });
	await told("chat.added", (p) => (p.ids as string[])[0] === agent.id && (p.item as { kind?: string } | undefined)?.kind === "user");
	await told("chat.changed", (p) => (p.ids as string[])[0] === agent.id);
	await told("runtime.noticed", (p) => p.text === "The fake runtime noticed something.");
	const asked = await told("chat.asked", (p) => (p.ids as string[])[0] === agent.id);
	const question = ((asked.payload as { question: { id: string } }).question).id;
	await person.call("chat.answer", { agent: agent.id, question, answer: { value: "A" } });
	await told("chat.answered", (p) => (p.ids as string[])[1] === question);
});

test("chat.drafted is told when a rewind gives the message's words back", async () => {
	const agent = ((await person.call("agent.list")).value as Array<{ id: string; name: string }>).find((one) => one.name === "Probe")!;
	const user = await until("the message's entry", () => harness.sessions.get(agent.id)!.history().find((one) => one.kind === "user" && (one as { entryId?: string }).entryId));
	await person.call("chat.rewind", { agent: agent.id, entry: user.id });
	const drafted = await told("chat.drafted", (p) => (p.ids as string[])[0] === agent.id);
	assert.match((drafted.payload as { text: string }).text, /ask me something/);
});

test("account.changed and runtime.changed are told through the server", async () => {
	const agent = ((await person.call("agent.list")).value as Array<{ id: string; name: string }>).find((one) => one.name === "Probe")!;
	await person.call("account.use", { account: "default", agent: agent.id });
	await told("account.changed");
	await person.call("runtime.update", { sttModel: null });
	await told("runtime.changed");
});
