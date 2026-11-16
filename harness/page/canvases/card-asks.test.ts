import assert from "node:assert/strict";
import { test } from "node:test";
import { mayCall } from "./card-asks.ts";

// The page's door for a card's calls: the agent calls a card's role has pass, anything else is refused.

test("a card's agent.send passes the page's door", () => {
	assert.equal(mayCall("agent.send"), true);
	assert.equal(mayCall("agent.list"), true);
});

test("a card may not start an agent, or make a canvas call through the page", () => {
	assert.equal(mayCall("agent.create"), false);
	assert.equal(mayCall("canvas.delete"), false);
	assert.equal(mayCall("item.batch"), false);
});
