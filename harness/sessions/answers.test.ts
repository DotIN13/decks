// The harness's call answers: one per call, refusals for unknown agents, the queue and the focus.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeAccounts } from "../accounts/index.ts";
import { HARNESS_CALLS, harnessAnswers } from "../calls.ts";
import { Settings } from "../runtimes/settings.ts";
import { Sessions, Transcripts } from "./index.ts";

const who = { kind: "person" as const, id: "p", name: "P" };

function parts() {
	const home = mkdtempSync(join(tmpdir(), "helm-"));
	const host = { tell: () => {}, call: async () => ({}) };
	const sessions = new Sessions({ url: "http://127.0.0.1:1", deckPath: home, transcripts: new Transcripts(home), host });
	const answers = harnessAnswers({ sessions, accounts: new ClaudeAccounts(home), settings: new Settings(home), host, forks: new Map() });
	return { home, sessions, answers, done: () => rmSync(home, { recursive: true, force: true }) };
}

test("every call the protocol gives the harness has one answer here", () => {
	const { answers, done } = parts();
	assert.deepEqual(Object.keys(answers).sort(), [...HARNESS_CALLS].sort());
	done();
});

test("an agent this harness does not run is refused not_found", async () => {
	const { answers, done } = parts();
	await assert.rejects(async () => answers["chat.list"]!({ agent: "nobody" }, who), (e: { code?: string }) => e.code === "not_found");
	done();
});

test("the person's queue answers as the README says, and the transcript lists newest last", async () => {
	const { sessions, answers, done } = parts();
	const session = sessions.start({ id: "a1", name: "Ada", kind: "pi" });
	session.state = "thinking";
	await answers["chat.queue"]!({ agent: "a1", action: "add", text: "later" }, who);
	const view = (await answers["chat.queue"]!({ agent: "a1", action: "add", text: "after" }, who)) as { items: Array<{ text: string }> };
	assert.deepEqual(view.items.map((i) => i.text), ["later", "after"]);
	session.translator.notice("info", "one");
	session.translator.notice("info", "two");
	const listed = (await answers["chat.list"]!({ agent: "a1" }, who)) as Array<{ text: string }>;
	assert.deepEqual(listed.map((i) => i.text), ["one", "two"]);
	session.dispose();
	done();
});

test("chat.focus is remembered, and runtime.get answers it for every new page", async () => {
	const { sessions, answers, done } = parts();
	sessions.start({ id: "a1", name: "Ada", kind: "pi" });
	await answers["chat.focus"]!({ agent: "a1" }, who);
	assert.equal(((await answers["runtime.get"]!({}, who)) as { focused?: string }).focused, "a1");
	sessions.dispose();
	done();
});

test("runtime.update refuses a speech model it does not know", () => {
	const { answers, done } = parts();
	assert.throws(() => answers["runtime.update"]!({ sttModel: "nope" }, who), (e: { code?: string }) => e.code === "invalid");
	done();
});
