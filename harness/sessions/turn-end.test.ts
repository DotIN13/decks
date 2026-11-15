import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentBackend, AgentBackendContext } from "../runtimes/backend.ts";
import { Sessions, Transcripts } from "./index.ts";

// A runtime whose prompt returns before its turn ends (Claude's does), and
// whose end of turn can arrive late, after the next message has begun.

function fakeBackend(context: AgentBackendContext, turns: Array<() => void>, before: () => Promise<void> = async () => {}): AgentBackend {
	let streaming = false;
	const backend = {
		capabilities: { modes: [] },
		get isStreaming() {
			return streaming;
		},
		prompt: async () => {
			await before();
			streaming = true;
			context.translator.setState("streaming");
			turns.push(() => {
				streaming = false;
				context.translator.setState("idle");
			});
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
		syncEntryIds: async () => {},
		revisionsAt: () => ({}),
		rewindTo: async () => ({ cancelled: true }),
		forkFrom: async () => undefined,
		dispose: () => {},
	};
	return backend as AgentBackend;
}

function rig(before?: () => Promise<void>) {
	const home = mkdtempSync(join(tmpdir(), "helm-"));
	const turns: Array<() => void> = [];
	const box: { context?: AgentBackendContext } = {};
	const sessions = new Sessions({
		url: "http://127.0.0.1:1",
		deckPath: home,
		transcripts: new Transcripts(home),
		host: { tell: () => {}, call: async () => ({}) },
		open: async (made) => fakeBackend((box.context = made), turns, before),
	});
	const session = sessions.start({ id: "a1", name: "Ada", kind: "opencode2" });
	return { session, turns, box, done: () => (sessions.dispose(), rmSync(home, { recursive: true, force: true })) };
}

test("a late end that arrives while the next message is still being handed over says nothing", async () => {
	let late: (() => void) | undefined;
	let gate = async () => {};
	const r = rig(() => gate());
	try {
		await r.session.prompt("turn one");
		r.turns[0]!();
		gate = () => new Promise<void>((done) => (late = () => (r.box.context!.turnEnded!(), done())));
		const second = r.session.prompt("turn two");
		await new Promise((done) => setTimeout(done, 20));
		assert.equal(r.session.state, "thinking", "the runtime is switching models: turn 2 has begun");
		late!();
		assert.equal(r.session.state, "thinking", "turn 1's late end, during the hand-over, said nothing");
		await second;
		assert.equal(r.session.state, "streaming");
		r.turns[1]!();
		assert.equal(r.session.state, "idle");
	} finally {
		r.done();
	}
});

test("a late end of turn 1, arriving during turn 2, leaves turn 2 working until its own end", async () => {
	const home = mkdtempSync(join(tmpdir(), "helm-"));
	const turns: Array<() => void> = [];
	let context!: AgentBackendContext;
	const sessions = new Sessions({
		url: "http://127.0.0.1:1",
		deckPath: home,
		transcripts: new Transcripts(home),
		host: { tell: () => {}, call: async () => ({}) },
		open: async (made) => fakeBackend((context = made), turns),
	});
	const session = sessions.start({ id: "a1", name: "Ada", kind: "claude" });
	try {
		await session.prompt("turn one");
		turns[0]!();
		assert.equal(session.state, "idle", "turn 1's result: idle");
		await session.prompt("turn two");
		assert.equal(session.state, "streaming");
		context.turnEnded!();
		assert.equal(session.state, "streaming", "turn 1's late end says nothing during turn 2");
		turns[1]!();
		context.turnEnded!();
		assert.equal(session.state, "idle", "turn 2's own end: idle");
	} finally {
		sessions.dispose();
		rmSync(home, { recursive: true, force: true });
	}
});
