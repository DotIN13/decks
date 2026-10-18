import assert from "node:assert/strict";
import { test } from "node:test";
import { StageBridge } from "./bridge.ts";

/**
 * Who a call from another process speaks for.
 *
 * The model is one sentence for each runtime — a token is an agent's identity, and opencode's
 * shared server proves itself with its token and names the agent with the session — so the tests
 * are about exactly that: an identity reaches its own agent and nothing else, and an identity
 * whose agent has gone reaches nothing at all.
 */

test("a token names the agent it was minted for", () => {
	const bridge = new StageBridge();
	const ada = bridge.issue("ada");
	const bo = bridge.issue("bo");
	assert.notEqual(ada, bo);
	assert.equal(bridge.agentOf(ada), "ada");
	assert.equal(bridge.agentOf(bo), "bo");
	assert.equal(bridge.agentOf("nonsense"), undefined);
	assert.equal(bridge.agentOf(undefined), undefined);
});

test("the same agent asking twice gets the same token", () => {
	// A rewind reopens the runtime, and the process on the other side is still holding the
	// token it was given: minting a new one would leave it talking to nobody.
	const bridge = new StageBridge();
	assert.equal(bridge.issue("ada"), bridge.issue("ada"));
});

test("a revoked token names nobody", () => {
	const bridge = new StageBridge();
	const token = bridge.issue("ada");
	bridge.revoke("ada");
	assert.equal(bridge.agentOf(token), undefined);
});

test("tokens are long enough not to be guessed", () => {
	assert.ok(new StageBridge().issue("ada").length >= 32);
});

test("the server token with a session id reaches that session's agent, and nothing less does", () => {
	// opencode's path: one shared server, so one token proves the caller is the process
	// Decks spawned, and the session id names whose agent it acts for.
	const bridge = new StageBridge();
	bridge.setServerToken("server-token");
	const agentToken = bridge.issue("ada");
	bridge.registerSession("ses_1", "ada");
	bridge.registerSession("ses_2", "bo");
	assert.equal(bridge.agentFor("server-token", "ses_1"), "ada");
	assert.equal(bridge.agentFor("server-token", "ses_2"), "bo");
	assert.equal(bridge.agentFor("server-token", "ses_unknown"), undefined);
	assert.equal(bridge.agentFor(agentToken, "ses_1"), undefined, "a per-agent token does not speak for a session");
	assert.equal(bridge.agentFor(undefined, "ses_1"), undefined);
});

test("a session's agent is known to the decks command, and forgotten when it goes", () => {
	const bridge = new StageBridge();
	bridge.registerSession("ses_1", "ada");
	assert.equal(bridge.agentOfSession("ses_1"), "ada");
	bridge.unregisterSession("ses_1");
	assert.equal(bridge.agentOfSession("ses_1"), undefined);
	// And unregistering nothing is a no-op, not a throw.
	bridge.unregisterSession(undefined);
	assert.equal(bridge.agentOfSession(undefined), undefined);
});

test("a new server's token retires the old one, and each kind of server keeps its own", () => {
	const bridge = new StageBridge();
	bridge.setServerToken("old-server");
	bridge.registerSession("ses_1", "ada");
	bridge.setServerToken("new-server");
	assert.equal(bridge.agentFor("old-server", "ses_1"), undefined);
	assert.equal(bridge.agentFor("new-server", "ses_1"), "ada");

	bridge.setServerToken("v2-token", "opencode2");
	bridge.registerSession("ses_v2", "bo", "opencode2");
	assert.equal(bridge.agentFor("v2-token", "ses_v2"), "bo");
	assert.equal(bridge.agentFor("new-server", "ses_v2"), undefined, "one server's token does not reach the other's sessions");
	assert.equal(bridge.agentFor("new-server", "ses_1"), "ada", "the second server starting left the first one's alone");
});
