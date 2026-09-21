import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { stageDts } from "@decks/runtime";
import { apiFor } from "./context.ts";

/*
 * What an agent is told about the API, and what it is spared.
 */
test("the browser's verbs are described only when a tab is shared", () => {
	const api = readFileSync(stageDts(), "utf8");
	const shared = apiFor(api, { web: true });
	const alone = apiFor(api, { web: false });
	assert.equal(shared, api, "with a tab, the whole block is there");
	assert.match(api, /screenshot\(o\?: \{ full\?: boolean \}\)/);
	assert.doesNotMatch(alone, /screenshot\(/, "without one, the thirteen verbs are not described");
	assert.match(alone, /Nothing is shared now/, "and the one line says how to find out");
	// 675 characters as this is written: the thirteen verbs, less the one line that replaces them.
	assert.ok(alone.length < api.length - 600, `it saves real prompt text: ${api.length - alone.length} characters`);
});
