import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { realPathOf } from "../deck/roots.ts";
import { migrateStages, movedPath } from "./2026-10-16-stages-to-canvases.ts";

/*
 * Canvases are the deck's: `canvases/<subject>/canvas.pen`. A deck from before keeps them in
 * `stages/<agent name>/stage.pen`, and is moved once when it opens.
 */
function oldDeck() {
	const deck = realPathOf(mkdtempSync(join(tmpdir(), "decks-canvases-")));
	const pen = (boards: string) => JSON.stringify({ version: "2.11", children: [{ type: "browser", id: "b1", url: `../../${boards}`, metadata: { type: "decks.board", path: boards } }] });
	mkdirSync(join(deck, "stages", "agent-3", "boards"), { recursive: true });
	writeFileSync(join(deck, "stages", "agent-3", "stage.pen"), pen("stages/agent-3/boards/kept.html"));
	writeFileSync(join(deck, "stages", "agent-3", "stage.json"), JSON.stringify({ title: "AI persuasion papers", boards: [] }));
	writeFileSync(join(deck, "stages", "agent-3", "boards", "kept.html"), "<title>Kept</title>");
	mkdirSync(join(deck, "stages", "wren"), { recursive: true });
	writeFileSync(join(deck, "stages", "wren", "stage.pen"), pen("boards/plan.html"));
	mkdirSync(join(deck, ".decks", "agents", "a1"), { recursive: true });
	writeFileSync(join(deck, ".decks", "agents", "a1", "meta.json"), JSON.stringify({ id: "a1", stage: "agent-3", context: ["stages/agent-3/boards/kept.html", "boards/plan.html"], inPlay: [] }));
	return deck;
}

test("a deck's stages/ moves to canvases/ once: titled ones are named for their title, agents and kept boards follow", () => {
	const deck = oldDeck();
	try {
		const moved = migrateStages(deck);
		assert.deepEqual([...moved], [["agent-3", "ai-persuasion-papers"], ["wren", "wren"]]);
		assert.ok(!existsSync(join(deck, "stages")));
		const named = join(deck, "canvases", "ai-persuasion-papers");
		assert.ok(existsSync(join(named, "canvas.pen")) && existsSync(join(named, "boards", "kept.html")));
		assert.match(readFileSync(join(named, "canvas.pen"), "utf8"), /canvases\/ai-persuasion-papers\/boards\/kept\.html/, "a board kept in the folder is pointed at where it went");
		assert.equal(JSON.parse(readFileSync(join(named, "canvas.json"), "utf8")).title, "AI persuasion papers");
		const untitled = JSON.parse(readFileSync(join(deck, "canvases", "wren", "canvas.json"), "utf8"));
		assert.deepEqual([untitled.title, untitled.provisional], ["wren", true], "one with no title keeps its folder, as a name nobody chose");
		const record = JSON.parse(readFileSync(join(deck, ".decks", "agents", "a1", "meta.json"), "utf8"));
		assert.equal(record.stage, "ai-persuasion-papers");
		assert.deepEqual(record.context, ["canvases/ai-persuasion-papers/boards/kept.html", "boards/plan.html"]);
		assert.equal(migrateStages(deck).size, 0, "and it happens once");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});

test("a path written before the move still finds its canvas", () => {
	assert.equal(movedPath("stages/wren/stage.pen", new Map()), "canvases/wren/canvas.pen");
	assert.equal(movedPath("boards/plan.html", new Map()), "boards/plan.html");
});
