import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTE_RADIUS } from "../pen/look.ts";
import { FRAME_PAD, FRAME_RADIUS, NOTE_CORNER } from "./core/ops.ts";

/** Core cannot import the page's look; this holds its copy of a note's corner to it. */
test("a made frame's corner is a note's corner plus its padding", () => {
	assert.equal(NOTE_CORNER, NOTE_RADIUS);
	assert.equal(FRAME_RADIUS, NOTE_RADIUS + FRAME_PAD);
});
