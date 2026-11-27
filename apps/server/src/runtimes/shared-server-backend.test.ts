import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentBackendContext } from "../agents/backend.ts";
import { Translator } from "../agents/translator.ts";
import { SharedServerBackend, type SessionCalls } from "./shared-server-backend.ts";

/*
 * The shared part of the opencode and OpenCode 2 backends, against a server that is a list of
 * calls. Neither real backend can be started here without its binary, so this is where what
 * they share (a dead server, a refused permission, the status line, the session tree) is held.
 */

class FakeServer {
	listeners: Array<() => void> = [];
	up = true;
	onExit(listener: () => void): () => void {
		this.listeners.push(listener);
		return () => (this.listeners = this.listeners.filter((one) => one !== listener));
	}
	alive(): boolean {
		return this.up;
	}
	die(): void {
		this.up = false;
		for (const listener of this.listeners) listener();
	}
}

class FakeBackend extends SharedServerBackend {
	readonly capabilities = { modes: ["manual" as const, "acceptEdits" as const, "auto" as const] };
	protected readonly runtimeName = "Fake";
	protected readonly deckCommands = [{ name: "status", hint: "Status", source: "deck" as const }];
	protected readonly permissions = { acceptEdits: { edit: "allow" as const, bash: "ask" as const } };
	protected readonly noModels = "No models.";
	protected readonly signIn = "fake auth";
	readonly sent: string[] = [];
	readonly replies: Array<[string, boolean]> = [];
	reverting: (entryId: string) => Promise<void> = async () => {};
	protected readonly calls: SessionCalls = {
		subscribe: async () => (async function* () {})(),
		onEvent: () => {},
		say: async (text) => void this.sent.push(text),
		runOwnCommand: async (name) => void this.sent.push(`own /${name}`),
		replyPermission: async (_session, id, allowed) => void this.replies.push([id, allowed]),
		interrupt: async () => {},
		compact: async () => {},
		listCommands: async () => [],
		listModels: async () => [{ provider: "p", model: "m", label: "M", reasoning: false }],
		updatePermissions: async () => {},
		rename: async () => {},
		userEntries: async () => [{ id: "e1", text: "hello" }],
		revert: (_session, entryId) => this.reverting(entryId),
		fork: async (_session, entryId) => `fork-of-${entryId}`,
	};

	constructor(
		context: AgentBackendContext,
		protected readonly server: FakeServer,
	) {
		super(context);
	}

	async begin(): Promise<void> {
		this.hold({ url: "http://127.0.0.1:1", release: () => {} });
		this.sessionId = "s1";
		await this.refreshModels();
	}

	answer(id: string, asked: string): Promise<void> {
		return this.answerPermission(id, asked, undefined);
	}
}

function backend() {
	const notices: string[] = [];
	const translator = new Translator("A", () => {});
	const context = { translator, notice: (_level: string, text: string) => void notices.push(text) } as unknown as AgentBackendContext;
	const server = new FakeServer();
	return { agent: new FakeBackend(context, server), server, notices, translator };
}

test("a server that dies says so once, and the chat lets go of its session", async () => {
	const { agent, server, notices } = backend();
	await agent.begin();
	server.die();
	assert.deepEqual(notices, ["Fake exited. This chat needs restarting."]);
	assert.equal(agent.sessionRef(), undefined);
});

test("a permission the mode allows is allowed once, and one it leaves to the person is refused out loud", async () => {
	const { agent, notices } = backend();
	await agent.begin();
	await agent.answer("r1", "edit");
	await agent.answer("r2", "bash");
	assert.deepEqual(agent.replies, [["r1", true], ["r2", false]]);
	assert.deepEqual(notices, ["Refused to bash: acceptEdits mode asks first, and there is no one to ask."]);
});

test("the deck's commands are answered here, and the rest go to the runtime", async () => {
	const { agent, notices } = backend();
	await agent.begin();
	await agent.prompt("/status");
	assert.equal(notices.at(-1), "Fake · model p/m · mode acceptEdits · http://127.0.0.1:1 · session s1");
	await agent.prompt("/review now");
	await agent.prompt("hello");
	assert.deepEqual(agent.sent, ["own /review", "hello"]);
});

test("a paired message can be rewound to and forked from; a refused rewind is said and cancelled", async () => {
	const { agent, notices, translator } = backend();
	await agent.begin();
	translator.user("hello");
	await agent.syncEntryIds();
	assert.deepEqual(agent.timeline().map((point) => point.id), ["e1"]);
	assert.deepEqual(await agent.rewindTo("e1"), { cancelled: false, editorText: "hello" });
	assert.equal(await agent.forkFrom("e1"), "fork-of-e1");
	agent.reverting = async () => {
		throw new Error("no");
	};
	assert.deepEqual(await agent.rewindTo("e1"), { cancelled: true });
	assert.equal(notices.at(-1), "Fake would not rewind: no");
});
