import assert from "node:assert/strict";
import { test } from "node:test";
import { smallName, thumbName, webpWidth } from "./thumbs.ts";

test("a smaller copy is named beside its whole picture, keeping the look", () => {
	const whole = thumbName("boards/a.html", 7, "light", "whole");
	assert.match(whole, /-whole-l\d+\.webp$/);
	assert.equal(smallName(whole, 192), whole.replace("-whole-", "-whole-w192-"));
	assert.equal(smallName("/x/abc-7-light-720-whole.webp", 480), "/x/abc-7-light-720-whole-w480.webp");
});

test("a WebP's width is read from its header, and anything else has none", () => {
	const vp8x = new Uint8Array(30);
	vp8x.set([...Buffer.from("RIFF")], 0);
	vp8x.set([...Buffer.from("WEBP")], 8);
	vp8x.set([...Buffer.from("VP8X")], 12);
	// 2000 wide, stored as width minus one in three bytes.
	vp8x.set([1999 & 0xff, (1999 >> 8) & 0xff, 0], 24);
	assert.equal(webpWidth(vp8x), 2000);
	assert.equal(webpWidth(new Uint8Array([0xff, 0xd8, 0xff])), undefined);
});
