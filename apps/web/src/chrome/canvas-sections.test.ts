import assert from "node:assert/strict";
import { test } from "node:test";
import type { Canvas } from "@decks/protocol";
import { canvasSections, firstCanvasIn, workspaceNames } from "./canvas-sections.ts";

/*
 * The cases a reader of either list would notice: a canvas under the wrong heading, the
 * room's project not leading, "No workspace" wandering into the alphabet, and the first
 * canvas of a project being the wrong one.
 */

const canvas = (id: string, name: string, changedAt: number, workspace?: string): Canvas => ({
	id,
	name,
	...(workspace ? { workspace } : {}),
	boards: [],
	links: [],
	groups: [],
	changedAt,
	agents: [],
});

const canvases = [
	canvas("d1", "Decks", 500, "decks"),
	canvas("d2", "Canvas camera", 300, "decks"),
	canvas("p1", "Political LLM", 900, "political-llm"),
	canvas("p2", "Neutral image", 100, "political-llm"),
	canvas("c1", "Cross-interviewer", 700, "cross-interviewer"),
	canvas("n1", "Tech Week", 800),
	canvas("n2", "Scratch", 50),
];

test("workspaces A to Z, No workspace last, newest change first inside each", () => {
	const sections = canvasSections({ canvases });
	assert.deepEqual(
		sections.map((section) => [section.label, section.rows.map((row) => row.id)]),
		[
			["cross-interviewer", ["c1"]],
			["decks", ["d1", "d2"]],
			["political-llm", ["p1", "p2"]],
			["No workspace", ["n1", "n2"]],
		],
	);
	assert.ok(sections.every((section) => !section.here), "no room on the dashboard, so nothing leads");
});

test("the room's workspace leads, marked, and the rest keep their order", () => {
	const sections = canvasSections({ canvases, current: "p2" });
	assert.deepEqual(
		sections.map((section) => section.label),
		["political-llm", "cross-interviewer", "decks", "No workspace"],
	);
	assert.equal(sections[0]?.here, true);
	assert.ok(sections.slice(1).every((section) => !section.here));
});

test("a room with no workspace lifts nothing", () => {
	const sections = canvasSections({ canvases, current: "n2" });
	assert.deepEqual(sections.map((section) => section.label), ["cross-interviewer", "decks", "political-llm", "No workspace"]);
	assert.ok(sections.every((section) => !section.here));
});

test("a search matches the name and the workspace, and drops empty headings", () => {
	assert.deepEqual(
		canvasSections({ canvases, query: "camera" }).map((section) => [section.label, section.rows.map((row) => row.id)]),
		[["decks", ["d2"]]],
	);
	assert.deepEqual(
		canvasSections({ canvases, query: "political" }).map((section) => section.rows.map((row) => row.id)),
		[["p1", "p2"]],
		"the workspace word finds every canvas in it",
	);
});

test("the first canvas in a workspace is its newest change, and none is a workspace too", () => {
	assert.equal(firstCanvasIn(canvases, "decks")?.id, "d1");
	assert.equal(firstCanvasIn(canvases, "political-llm")?.id, "p1");
	assert.equal(firstCanvasIn(canvases, undefined)?.id, "n1");
	assert.equal(firstCanvasIn(canvases, "nowhere"), undefined);
});

test("the workspaces on offer are what the canvases and the agents say, once each", () => {
	const identities = {
		a: { name: "Ada", color: "#000", workspace: "decks" },
		b: { name: "Bea", color: "#000", workspace: "zeta-check" },
		c: { name: "Cy", color: "#000" },
	};
	assert.deepEqual(workspaceNames(canvases, identities), ["cross-interviewer", "decks", "political-llm", "zeta-check"]);
});
