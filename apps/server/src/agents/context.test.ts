import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decksCommands } from "@decks/runtime";
import { apiFor } from "./context.ts";

/*
 * What an agent is told about the API, and what it is spared.
 */
test("the browser's verbs are described only when a tab is shared", () => {
	const api = readFileSync(decksCommands(), "utf8");
	const shared = apiFor(api, { web: true });
	const alone = apiFor(api, { web: false });
	assert.match(shared, /decks web screenshot/, "with a tab, the whole block is there");
	assert.doesNotMatch(shared, /<!-- web -->/, "without its markers");
	assert.doesNotMatch(alone, /decks web screenshot/, "without one, the thirteen verbs are not described");
	assert.match(alone, /nothing is shared now/, "and the one line says how to find out");
	assert.ok(alone.length < api.length - 600, `it saves real prompt text: ${api.length - alone.length} characters`);
});
