import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientFor, type Client } from "@decks-next/sdk";
import { readLock, startServer } from "../../main.ts";

// Decks-local and the harness as two processes, a Pi agent on the fake model:
// it takes a message, makes a card with the decks command, and reports. Then
// the harness stops, and its calls answer unavailable. Ports 4670 and 4671.

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRATCH = join(ROOT, ".scratch/Helm/turn");
const DECK = join(SCRATCH, "deck");
const children: ChildProcess[] = [];
let person: Client;

const node = (args: string[], env: Record<string, string> = {}) => {
	const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"] });
	children.push(child);
	return child;
};

async function until<T>(what: string, probe: () => Promise<T | undefined>, ms = 30_000): Promise<T> {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) {
		const got = await probe().catch(() => undefined);
		if (got !== undefined) return got;
	}
	throw new Error(`Waited ${ms} ms for ${what}.`);
}

function piAgentDir(): string {
	const dir = join(SCRATCH, "pi");
	mkdirSync(dir, { recursive: true });
	const model = { id: "fake-1", name: "Fake 1", input: ["text"], contextWindow: 200000, maxTokens: 8192 };
	writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { fake: { baseUrl: "http://127.0.0.1:4671/v1", api: "openai-completions", apiKey: "fake", models: [model] } } }));
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "fake", defaultModel: "fake-1", defaultThinkingLevel: "off" }));
	return dir;
}

let harness: ChildProcess;

before(async () => {
	rmSync(SCRATCH, { recursive: true, force: true });
	cpSync(join(ROOT, "tools/fixtures/deck"), DECK, { recursive: true });
	node([join(ROOT, "harness/sessions/checks/fake-model.mjs")], { FAKE_MODEL_PORT: "4671" });
	const { lock, child } = await startServer(DECK, "4670");
	children.push(child);
	person = clientFor(lock.url, lock.token);
	harness = node(["--import", "tsx", join(ROOT, "harness/main.ts"), "--deck", DECK, "--kinds", "pi"], { PI_CODING_AGENT_DIR: piAgentDir(), DECKS_DATA_DIR: join(SCRATCH, "home"), DECKS_QUEUE_IDLE_MS: "200" });
	await until("the harness to offer pi", async () => ((await person.call("runtime.list")).value as Array<{ kind: string }>).some((one) => one.kind === "pi") || undefined);
});

after(() => {
	for (const child of children) child.kill("SIGTERM");
});

type Item = { id: string; kind: string; text?: string };

test("a deck with no agent gets one, at home on the deck's first canvas, as a first run does", async () => {
	const agents = await until("the first agent", async () => {
		const all = (await person.call("agent.list")).value as Array<{ kind?: string; canvas?: string; state?: string }>;
		return all.length && all[0]!.state === "idle" ? all : undefined;
	});
	assert.equal(agents.length, 1);
	assert.equal(agents[0]!.kind, "pi");
	assert.equal(agents[0]!.canvas, "auth-refresh");
});
const chat = async (agent: string) => (await person.call("chat.list", { agent })).value as Item[];

test("an agent takes a message, makes a card with the decks command, and reports", async () => {
	const agent = (await person.call("agent.create", { kind: "pi", name: "Checker" })).value as { id: string; canvas: string };
	await until("the session", async () => ((await person.call("agent.get", { agent: agent.id })).value as { state?: string }).state === "idle" || undefined);
	const sent = (await person.call("chat.send", { agent: agent.id, text: "Make a card titled 'Harness check' with the decks command." })).value as Item;
	assert.equal(sent.kind, "user");
	const reply = await until("the report", async () => (await chat(agent.id)).find((one) => one.kind === "assistant" && /^Made /.test(one.text ?? "")));
	const path = /^Made (.+)\.$/.exec(reply.text!)![1]!;
	const cards = (await person.call("card.list")).value as Array<{ path: string; by?: string }>;
	assert.ok(cards.some((one) => one.path === path), `${path} is in the deck`);
	const items = (await person.call("item.list", { canvas: agent.canvas })).value as Array<{ type: string; card?: string }>;
	assert.ok(items.some((one) => one.type === "card" && one.card === path), "and on the agent's own canvas");
	const kinds = (await chat(agent.id)).map((one) => one.kind);
	assert.deepEqual(kinds.filter((k) => k === "user" || k === "assistant"), ["user", "assistant"], "the transcript: the message and the report");
	await until("idle again", async () => ((await person.call("agent.get", { agent: agent.id })).value as { state?: string }).state === "idle" || undefined);
});

test("with the harness stopped, its calls answer unavailable", async () => {
	harness.kill("SIGTERM");
	await until("the harness to go", async () => (await person.call("runtime.list").then(() => undefined, (e: { code?: string }) => e.code)) as string | undefined);
	await assert.rejects(person.call("chat.list", { agent: "anyone" }), (error: { code?: string }) => error.code === "unavailable");
	await assert.rejects(person.call("account.list"), (error: { code?: string }) => error.code === "unavailable");
	assert.ok(readLock(DECK), "the server is still running");
});
