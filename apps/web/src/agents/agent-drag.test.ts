import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_MIME, carriesAgent, carryAgent, draggedAgent } from "./agent-drag.ts";

/**
 * The payload, and the one rule that shapes it: a drop target is told a drag's *types* while it
 * is in flight and its *data* only when it lands. So everything the heading needs in order to
 * say yes has to be in the type.
 */
function transfer(): DataTransfer {
	const held = new Map<string, string>();
	return {
		get types() {
			return [...held.keys()];
		},
		setData: (type: string, value: string) => void held.set(type, value),
		getData: (type: string) => held.get(type) ?? "",
		effectAllowed: "none",
	} as unknown as DataTransfer;
}

test("an agent row's drag says what it is before it says who", () => {
	const data = transfer();
	carryAgent(data, "a1", "Ada");
	assert.equal(carriesAgent(data), true, "the heading can tell during dragover");
	assert.equal(draggedAgent(data), "a1");
	assert.equal(data.getData("text/plain"), "Ada", "and it reads as a name anywhere else");
	assert.equal(data.effectAllowed, "move");
});

test("a drag that is not ours is not an agent", () => {
	const other = transfer();
	other.setData("text/plain", "a1");
	assert.equal(carriesAgent(other), false);
	assert.equal(draggedAgent(other), undefined);
	assert.equal(draggedAgent(null), undefined);
	// Our own type, carrying nothing: not a drop, rather than a drop onto an empty id.
	const empty = transfer();
	empty.setData(AGENT_MIME, "  ");
	assert.equal(draggedAgent(empty), undefined);
});
