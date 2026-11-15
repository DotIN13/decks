import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentChat } from "@decks/protocol";
import { recipientChat, recipientName } from "./model.ts";

test("the chip names the agent, a card for a note, or nobody", () => {
	assert.equal(recipientName({ kind: "prompt", id: "a", name: "Sable" }), "Sable");
	assert.equal(recipientName({ kind: "note" }), "a card");
	assert.equal(recipientName({ kind: "none" }), "No agent");
});

test("the agent is found only for a prompt", () => {
	const chats = [{ id: "a" }] as unknown as AgentChat[];
	assert.equal(recipientChat({ kind: "prompt", id: "a", name: "Sable" }, chats)?.id, "a");
	assert.equal(recipientChat({ kind: "note" }, chats), undefined);
});
