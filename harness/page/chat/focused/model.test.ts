import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentChat, Identity } from "@decks/protocol";
import { focusedFacts } from "./model.ts";

test("with no agent, the stream is idle, says It, and uses the default runtime", () => {
	assert.deepEqual(focusedFacts(undefined, undefined, "claude"), { state: "idle", name: "It", agent: "claude" });
});

test("the identity's name wins over the chat's", () => {
	const chat = { state: "tool", name: "chat-name", kind: "pi" } as unknown as AgentChat;
	assert.deepEqual(focusedFacts(chat, { name: "Sable" } as Identity, "claude"), { state: "tool", name: "Sable", agent: "pi" });
});
