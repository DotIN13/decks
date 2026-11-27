import assert from "node:assert/strict";
import { test } from "node:test";
import { Deck } from "../deck/loader.ts";
import { compacted } from "../runtimes/antigravity/backend.ts";
import { agentBriefing, deckContext } from "./context.ts";

/*
 * What every agent is told once: an index of what to do, pointing at skills and `decks help`, short
 * enough to read whole. The same words for every runtime (`agentBriefing`).
 */
const deck = Deck.open("../../e2e/fixture/decks");
const tool = (web: boolean, guidelines: string[] = []) => ({ tool: { webShared: () => web, guidelines } });

test("the briefing is an index: short, every placeholder filled, pointing at the skills and decks help", () => {
	const text = agentBriefing(deck, tool(false));
	assert.ok(text.length < 9000, `under 9,000 characters (about 2,000 tokens): ${text.length}`);
	assert.doesNotMatch(text, /\{\{/, "no placeholder left");
	for (const pointer of ["decks help", "canvas-authoring", "card-authoring", "app-building", "decks-basics", "progress"]) assert.match(text, new RegExp(pointer), pointer);
	assert.doesNotMatch(text, /canvas\.insert\(item: Item/, "no command reference pasted in: decks help has it");
});

test("the shared tab is mentioned only while one is shared", () => {
	assert.match(deckContext(deck, { web: true }), /sharing a Chrome tab/);
	assert.doesNotMatch(deckContext(deck, { web: false }), /Chrome tab/);
});

test("extra guidelines follow the index as a list, and none adds nothing", () => {
	assert.equal(agentBriefing(deck, tool(false)), deckContext(deck, { web: false }));
	assert.match(agentBriefing(deck, tool(false, ["Try this."])), /\n\n- Try this\.$/);
});

test("antigravity takes a halved context for a compaction and briefs again", () => {
	const usage = (contextTokens: number) => ({ contextTokens, contextWindow: 0, cost: 0 });
	assert.equal(compacted(usage(80000), usage(30000)), true);
	assert.equal(compacted(usage(80000), usage(70000)), false, "a shorter turn is not a compaction");
	assert.equal(compacted(usage(9000), usage(2000)), false, "a small context is left alone");
	assert.equal(compacted(null, usage(2000)), false);
});
