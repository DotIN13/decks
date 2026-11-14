import assert from "node:assert/strict";
import { test } from "node:test";
import { findAgents, listAgents, moreWords } from "./model.ts";

// The agent menu finds agents by name or workspace, and lists every match while searching.

const chat = (id: string, name: string) => ({ id, name, state: "idle", unread: 0, kind: "claude", identity: { name, color: "#000" }, cards: [], inPlay: [] }) as never;
const identities = { a: { name: "Ada", color: "#f00", workspace: "decks" }, b: { name: "Bo", color: "#0f0" } };

test("a search finds by name or by workspace, and nothing finds all", () => {
	const chats = [chat("a", "Ada"), chat("b", "Bo")];
	assert.deepEqual(findAgents(chats, identities, "bo").map((one: { id: string }) => one.id), ["b"]);
	assert.deepEqual(findAgents(chats, identities, "DECKS").map((one: { id: string }) => one.id), ["a"]);
	assert.equal(findAgents(chats, identities, "  ").length, 2);
});

test("while searching every match is listed and none is held back", () => {
	const chats = Array.from({ length: 30 }, (_, i) => chat(`c${i}`, `Agent ${i}`));
	assert.equal(listAgents(chats, {}, {}, undefined, "agent").more, 0);
	assert.equal(listAgents(chats, {}, {}, undefined, "agent").shown.length, 30);
	assert.equal(moreWords(1), "1 more agent");
	assert.equal(moreWords(3), "3 more agents");
});
