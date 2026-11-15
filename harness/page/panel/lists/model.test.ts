import assert from "node:assert/strict";
import { test } from "node:test";
import { addWords, noAgentsWords, workspaceOf } from "./model.ts";

// A dropped agent moves into a workspace section's workspace, or out of any; empty lists say why.

test("a workspace section names its workspace; the other section names none", () => {
	assert.equal(workspaceOf({ kind: "workspace", label: "decks" }), "decks");
	assert.equal(workspaceOf({ kind: "none", label: "No workspace" }), null);
	assert.equal(addWords({ kind: "workspace", label: "decks" }), "Add an agent in decks");
});

test("an empty list says there are no agents, or none that match", () => {
	assert.equal(noAgentsWords(0, "", true), "No agents yet.");
	assert.match(noAgentsWords(0, "", false), /Start one/);
	assert.equal(noAgentsWords(3, " ada ", false), "No agent matches “ada”.");
});
