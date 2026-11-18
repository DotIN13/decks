import assert from "node:assert/strict";
import { test } from "node:test";
import type { Deck } from "../deck/loader.ts";
import { brief } from "./registry.ts";

/* Work handed over is briefed: when it is, and the cards it came with. A slash command the person hands over is not: it is the exact line. */
const deck = {} as Deck;

test("handed-over work says when it runs, and a person's slash command is handed over as the exact line it is", () => {
	assert.match(brief("Tidy the plan", [], deck, true), /^Tidy the plan\n\nIt is now /);
	assert.equal(brief("/compact", [], deck, true), "/compact");
	assert.equal(brief("  /compact keep the plan ", [], deck, true), "/compact keep the plan");
	// From another agent it is words to read, never a command: it is sent with who it is from in front (`Turns.deliver`).
	assert.match(brief("/compact", [], deck, false), /^\/compact\n\nIt is now /);
	// A path at the start of a task is not a command.
	assert.match(brief("/Users/ada/plan.md needs a title", [], deck, true), /^\/Users\/ada\/plan\.md needs a title\n\nIt is now /);
});
