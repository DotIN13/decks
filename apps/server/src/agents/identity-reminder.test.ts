import assert from "node:assert/strict";
import { test } from "node:test";
import { identityGaps, identityReminder } from "./identity-reminder.ts";

const whole = { name: "Linnet", avatar: "/api/avatar/x", workspace: "decks", tags: ["placement"] };

test("an agent that has said all four hears nothing", () => {
	assert.deepEqual(identityGaps(whole), []);
	assert.equal(identityReminder(whole), undefined);
});

test("a numbered default name is not a name", () => {
	assert.deepEqual(identityGaps({ ...whole, name: "Agent 3" }), ["name"]);
	assert.deepEqual(identityGaps({ ...whole, name: "Agent" }), ["name"]);
	assert.deepEqual(identityGaps({ ...whole, name: "Agent Smith" }), [], "a name that merely starts with Agent is one");
});

test("a fresh agent is asked for everything, in one sentence it can act on", () => {
	const said = identityReminder({ name: "Agent 3" });
	assert.match(said ?? "", /stage\.me\(\{ name: .*; avatar: .*; workspace: .*; tags: .* \}\)/);
});

test("only the tags missing is its own, shorter reminder", () => {
	assert.match(identityReminder({ ...whole, tags: [] }) ?? "", /Your tags are empty/);
});
