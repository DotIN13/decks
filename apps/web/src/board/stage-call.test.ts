import assert from "node:assert/strict";
import { test } from "node:test";
import { stageCallOf } from "./stage-call.ts";

/**
 * A board's button asking this page to call a verb (`stage-call.ts`). The page names the board by
 * the frame the message came from, so the guard is what decides which board that is: a message from
 * any other window is not a call at all, and a verb that is not a name cannot reach another route.
 */

const frame = () => ({ contentWindow: {} }) as unknown as HTMLIFrameElement;
const ask = (data: unknown, source?: unknown) => ({ source, data });
const call = { decks: "stage.call", id: "c1", verb: "canvas.read", args: [] };

test("a call from the board's own frame is passed on", () => {
	const one = frame();
	assert.deepEqual(stageCallOf(ask(call, one.contentWindow), one), call);
});

test("a call from another window, or none, is ignored", () => {
	assert.equal(stageCallOf(ask(call, {}), frame()), undefined);
	assert.equal(stageCallOf(ask(call, undefined), frame()), undefined);
	assert.equal(stageCallOf(ask(call, null), { contentWindow: null } as unknown as HTMLIFrameElement), undefined, "a frame with no window");
});

test("a verb that is not a verb's name is refused, so it cannot climb out of /api/v1", () => {
	const one = frame();
	for (const verb of ["../relay", "canvas/../../upload", "canvas.read?x=1", "", ".hidden", "a..b"]) {
		assert.equal(stageCallOf(ask({ ...call, verb }, one.contentWindow), one), undefined, verb);
	}
	assert.equal(stageCallOf(ask({ ...call, args: "nope" }, one.contentWindow), one), undefined, "arguments not a list");
	assert.equal(stageCallOf(ask({ ...call, id: 7 }, one.contentWindow), one), undefined, "no id to answer");
});

test("what the board says about itself is not kept: only the call", () => {
	const one = frame();
	assert.deepEqual(stageCallOf(ask({ ...call, board: "boards/other.html", headers: { "x-decks-person": "1" } }, one.contentWindow), one), call);
});
