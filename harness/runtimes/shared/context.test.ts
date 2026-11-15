// The briefing: the tab's calls only when a tab is shared, and every placeholder filled.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { decksCommands } from "../../prompts/paths.ts";
import { apiFor, deckContext } from "./context.ts";

const sample = "# calls\n\n## card\n\n- `card.list()`\n\n## tab\n\n- `tab.screenshot()`\n- `tab.click()`\n\n## studio\n\n- `studio.status()`\n";

test("the tab's calls are described only when a tab is shared", () => {
	assert.equal(apiFor(sample, { web: true }), sample);
	const alone = apiFor(sample, { web: false });
	assert.doesNotMatch(alone, /tab\.screenshot/);
	assert.match(alone, /nothing is shared now/);
	assert.match(alone, /studio\.status/, "the sections after it stay");
});

test("the briefing names the deck and lists its cards, from facts alone", () => {
	const text = deckContext({ name: "Work", path: "/tmp/work", cards: [{ path: "canvases/a/cards/x/index.html", title: "X holds", w: 1000, h: 600 }] });
	assert.match(text, /X holds/);
	assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/, "every placeholder is filled");
});

test("the generated reference, when built, carries the tab section the briefing trims", { skip: !existsSync(decksCommands()) }, () => {
	const api = readFileSync(decksCommands(), "utf8");
	assert.ok(apiFor(api, { web: false }).length < api.length);
});
