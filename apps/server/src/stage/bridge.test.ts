import assert from "node:assert/strict";
import { test } from "node:test";
import { StageBridge } from "./bridge.ts";
import type { StageTool } from "./tool.ts";

/**
 * The canvas tool's other end, for the runtimes that are not in this process.
 *
 * The whole security model is one sentence — the token is the identity — so the tests are
 * about exactly that: a token reaches its own agent's tool and nothing else, and a token
 * whose agent has gone reaches nothing at all.
 */
function fakeTool(answer: string): StageTool {
	return {
		name: "stage_eval",
		label: "Stage",
		description: "",
		promptSnippet: "",
		guidelines: [],
		parameterDescription: "",
		run: async (code: string) => ({ text: `${answer}:${code}`, isError: false }),
	} as unknown as StageTool;
}

test("a token runs against the agent it was minted for", async () => {
	const bridge = new StageBridge();
	const ada = bridge.issue("ada", fakeTool("ada"));
	const bo = bridge.issue("bo", fakeTool("bo"));
	assert.notEqual(ada, bo);
	assert.deepEqual(await bridge.run(ada, "x"), { text: "ada:x", isError: false });
	assert.deepEqual(await bridge.run(bo, "x"), { text: "bo:x", isError: false });
});

test("the same agent asking twice gets the same token", () => {
	// A rewind reopens the runtime, and the tool on the other side is still holding the
	// token it was given: minting a new one would leave it talking to nobody.
	const bridge = new StageBridge();
	const first = bridge.issue("ada", fakeTool("ada"));
	const second = bridge.issue("ada", fakeTool("ada"));
	assert.equal(first, second);
});

test("a revoked token is refused, and says why rather than throwing", async () => {
	const bridge = new StageBridge();
	const token = bridge.issue("ada", fakeTool("ada"));
	bridge.revoke("ada");
	const outcome = await bridge.run(token, "x");
	assert.equal(outcome.isError, true);
	assert.match(outcome.text, /not valid any more/);
});

test("no token, an unknown token and empty code are all refusals", async () => {
	const bridge = new StageBridge();
	const token = bridge.issue("ada", fakeTool("ada"));
	assert.equal((await bridge.run(undefined, "x")).isError, true);
	assert.equal((await bridge.run("nonsense", "x")).isError, true);
	assert.equal((await bridge.run(token, "   ")).isError, true);
});

test("a token says which agent it speaks for", () => {
	const bridge = new StageBridge();
	const token = bridge.issue("ada", fakeTool("ada"));
	assert.equal(bridge.agentOf(token), "ada");
	assert.equal(bridge.agentOf("nonsense"), undefined);
});

test("tokens are long enough not to be guessed", () => {
	const bridge = new StageBridge();
	assert.ok(bridge.issue("ada", fakeTool("ada")).length >= 32);
});

test("the server token with a session id reaches that session's agent", async () => {
	// opencode's path: one shared server, so one token proves the caller is the process
	// Decks spawned, and the session id names whose agent it acts for.
	const bridge = new StageBridge();
	bridge.setServerToken("server-token");
	bridge.registerSession("ses_1", "ada", fakeTool("ada"));
	bridge.registerSession("ses_2", "bo", fakeTool("bo"));
	assert.deepEqual(await bridge.run("server-token", "x", "ses_1"), { text: "ada:x", isError: false });
	assert.deepEqual(await bridge.run("server-token", "x", "ses_2"), { text: "bo:x", isError: false });
});

test("a session id that was never registered is refused with a sentence", async () => {
	// A stale or foreign id is not a crash and not a guess — it is a failed tool call
	// saying exactly which identity did not hold.
	const bridge = new StageBridge();
	bridge.setServerToken("server-token");
	bridge.registerSession("ses_1", "ada", fakeTool("ada"));
	const outcome = await bridge.run("server-token", "x", "ses_unknown");
	assert.equal(outcome.isError, true);
	assert.match(outcome.text, /not registered to a live Decks agent/);
});

test("a session whose agent is gone stops answering", async () => {
	const bridge = new StageBridge();
	bridge.setServerToken("server-token");
	bridge.registerSession("ses_1", "ada", fakeTool("ada"));
	bridge.unregisterSession("ses_1");
	assert.equal((await bridge.run("server-token", "x", "ses_1")).isError, true);
	// And unregistering nothing is a no-op, not a throw.
	bridge.unregisterSession(undefined);
});

test("a session id without the server token is refused", async () => {
	// The session id names the agent, but only the shared server's token proves the
	// caller is the process Decks spawned — a per-agent token or nothing at all is not
	// enough, or any chat could speak for any other.
	const bridge = new StageBridge();
	bridge.setServerToken("server-token");
	const agentToken = bridge.issue("ada", fakeTool("ada"));
	bridge.registerSession("ses_1", "ada", fakeTool("ada"));
	assert.equal((await bridge.run(agentToken, "x", "ses_1")).isError, true);
	assert.equal((await bridge.run(undefined, "x", "ses_1")).isError, true);
	// And the server token alone speaks for nobody: without a session id there is no
	// per-agent token for it to be.
	assert.equal((await bridge.run("server-token", "x")).isError, true);
});

test("a new server's token retires the old one", async () => {
	// A server that died and came back mints a fresh token; a session id replayed from
	// the dead process must not validate against the new server.
	const bridge = new StageBridge();
	bridge.setServerToken("old-server");
	bridge.registerSession("ses_1", "ada", fakeTool("ada"));
	bridge.setServerToken("new-server");
	assert.equal((await bridge.run("old-server", "x", "ses_1")).isError, true);
	assert.deepEqual(await bridge.run("new-server", "x", "ses_1"), { text: "ada:x", isError: false });
});
