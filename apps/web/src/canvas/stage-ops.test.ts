import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, Camera, StageCall } from "@decks/protocol";
import { runStageCall, type StageOpsHost } from "./stage-ops.ts";

/*
 * Whose view a stage call is allowed to move.
 *
 * The canvas is per conversation, and the camera has to follow the same rule or it is the one
 * part of the view an agent you are not watching can reach into. It could: a call carried no
 * agent id, so the browser could not tell whose `show` it was carrying out, and an agent
 * working in another corner of the deck flew the camera to a board that was not on screen.
 *
 * The DOM is never touched by these two operations — `highlight` is the only one that reaches
 * into a board's document, and nothing here asks for one — so this runs as a plain unit test.
 */

const board = (path: string, x: number, y: number): Board => ({ path, title: path, x, y, w: 800, h: 600, rev: 1, inContext: [] });

function host(focused: string | undefined) {
	const moved: Camera[] = [];
	const remembered: Array<{ agentId: string; camera: Camera; selected?: string }> = [];
	const selected: Array<string | undefined> = [];
	const api: StageOpsHost = {
		boards: () => [board("boards/plan.html", 0, 0), board("boards/risks.html", 6000, 0)],
		viewport: () => ({ width: 1200, height: 800 }),
		focused: () => focused,
		setCamera: (camera) => moved.push(camera),
		rememberView: (agentId, camera, select) => remembered.push({ agentId, camera, ...(select ? { selected: select } : {}) }),
		select: (path) => selected.push(path),
		reload: () => {},
		cursor: () => {},
		annotate: () => {},
		toast: () => {},
	};
	return { api, moved, remembered, selected };
}

const call = (agentId: string, op: StageCall["op"], args: unknown): StageCall => ({ id: "c1", agentId, op, args });

test("the conversation on screen moves the canvas, as it always did", () => {
	const { api, moved, remembered, selected } = host("A");
	const result = runStageCall(call("A", "show", { paths: ["boards/risks.html"] }), api) as { shown: string[]; deferred?: string };

	assert.deepEqual(result.shown, ["boards/risks.html"]);
	assert.equal(result.deferred, undefined, "nothing is waiting: it happened");
	assert.equal(moved.length, 1, "the camera moved");
	assert.deepEqual(selected, ["boards/risks.html"], "and the board it framed is selected");
	assert.deepEqual(remembered, [], "nothing to remember");
});

test("an agent you are not reading does not move it", () => {
	const { api, moved, remembered, selected } = host("A");
	const result = runStageCall(call("B", "show", { paths: ["boards/risks.html"] }), api) as { shown: string[]; deferred?: string };

	assert.equal(moved.length, 0, "your canvas stayed where it was");
	assert.deepEqual(selected, [], "and so did your selection");
	assert.deepEqual(result.shown, ["boards/risks.html"], "the boards are in play either way");
	assert.ok(result.deferred, "and it is told, rather than left to assume it worked");
});

test("…and what it asked for is kept, framed as it asked", () => {
	const { api, moved, remembered } = host("A");
	runStageCall(call("B", "show", { paths: ["boards/risks.html"] }), api);
	const kept = remembered[0];
	assert.equal(kept?.agentId, "B");
	assert.equal(kept?.selected, "boards/risks.html", "including the selection, which is part of the view");

	// The same call with B on screen produces the identical camera: remembered, not refitted.
	const focused = host("B");
	runStageCall(call("B", "show", { paths: ["boards/risks.html"] }), focused.api);
	assert.deepEqual(kept?.camera, focused.moved[0]);
	assert.equal(moved.length, 0);
});

test("setting the camera follows the same rule as showing", () => {
	const wanted = { x: 400, y: 250, zoom: 0.8 };

	const mine = host("A");
	runStageCall(call("A", "camera", wanted), mine.api);
	assert.deepEqual(mine.moved, [wanted]);
	assert.deepEqual(mine.remembered, []);

	const theirs = host("A");
	const result = runStageCall(call("B", "camera", wanted), theirs.api) as { camera: Camera; deferred?: string };
	assert.deepEqual(theirs.moved, [], "not your canvas to move");
	assert.deepEqual(theirs.remembered[0]?.camera, wanted, "kept against the agent that asked");
	assert.ok(result.deferred);
});

test("a call with no agent behind it still works, because the id is newer than the ops", () => {
	// A frame from an older server, or a hand-fed one. Better to carry it out than to
	// silently do nothing: the reason for the rule is *another* conversation, and a call
	// that names none is not that.
	const { api, moved } = host("A");
	runStageCall({ id: "c1", agentId: "", op: "camera", args: { x: 1, y: 2, zoom: 1 } }, api);
	assert.equal(moved.length, 1);
});
