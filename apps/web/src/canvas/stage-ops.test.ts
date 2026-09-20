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

const board = (path: string, x: number, y: number): Board => ({ path, format: "board" as const, title: path, x, y, w: 800, h: 600, rev: 1, inContext: [] });

function host(focused: string | undefined) {
	const moved: Camera[] = [];
	/** The same calls, carrying the flag the caller asked for — see the tests at the end. */
	const animated: Array<{ camera: Camera }> = [];
	const remembered: Array<{ agentId: string; camera: Camera; selected?: string }> = [];
	const selected: Array<string | undefined> = [];
	const api: StageOpsHost = {
		boards: () => [board("boards/plan.html", 0, 0), board("boards/risks.html", 6000, 0)],
		viewport: () => ({ width: 1200, height: 800 }),
		focused: () => focused,
		setCamera: (camera, options) => {
			moved.push(camera);
			if (options?.animate) animated.push({ camera });
		},
		rememberView: (agentId, camera, select) => remembered.push({ agentId, camera, ...(select ? { selected: select } : {}) }),
		select: (path) => selected.push(path),
		reload: () => {},
		cursor: () => {},
		annotate: () => {},
		toast: () => {},
	};
	return { api, moved, animated, remembered, selected };
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

/*
 * And whether the move is one the agent asked to *watch*.
 *
 * `animate` is the agent's own request and it is off by default: an op says where to look, and
 * anything that reads the camera a frame after calling it should see what it asked for. The two
 * gestures that glide do it in `App.tsx`, where a person's hands are — this is only about the
 * flag travelling from the call to the host, which is the half a check can see without a model
 * driving it. What the browser does with the flag is `e2e/checks/glide.mjs`.
 */
test("an op that asked to arrive says so, and one that did not does not", () => {
	const plain = host("A");
	runStageCall(call("A", "show", { paths: ["boards/plan.html"] }), plain.api);
	assert.equal(plain.moved.length, 1, "show moved the camera");
	assert.equal(plain.animated.length, 0, "show without the flag moved it instantly");

	const asked = host("A");
	runStageCall(call("A", "show", { paths: ["boards/plan.html"], animate: true }), asked.api);
	assert.deepEqual(asked.animated, [{ camera: asked.moved[0]! }]);

	const place = host("A");
	runStageCall(call("A", "camera", { x: 10, y: 20, zoom: 0.5, animate: true }), place.api);
	assert.deepEqual(place.animated, [{ camera: { x: 10, y: 20, zoom: 0.5 } }]);

	const quiet = host("A");
	runStageCall(call("A", "camera", { x: 1, y: 2, zoom: 1 }), quiet.api);
	assert.deepEqual(quiet.moved, [{ x: 1, y: 2, zoom: 1 }]);
	assert.equal(quiet.animated.length, 0);
});

test("a remembered view is not animated, whatever it asked for", () => {
	// Nothing moved on this screen, so there is nothing to glide: the view waits for the chat it
	// belongs to and arrives framed the moment that chat is opened.
	const { api, moved, animated, remembered } = host("A");
	const result = runStageCall(call("B", "show", { paths: ["boards/plan.html"], animate: true }), api) as { deferred?: string };
	assert.ok(result.deferred, "expected a deferred result");
	assert.equal(moved.length, 0);
	assert.equal(animated.length, 0);
	assert.equal(remembered.length, 1);
});
