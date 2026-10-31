import assert from "node:assert/strict";
import { test } from "node:test";
import { documentHeight, measureFrame } from "./page.ts";

test("a board is measured as its page: no named blocks needed", () => {
	// One flowing page, no `[data-id]` anywhere: the reading is the body's own height, with the
	// height board.js gave it released for the read.
	const style = { height: "auto", minHeight: "600px" };
	const body = {
		style,
		innerText: "A heading and a paragraph",
		scrollWidth: 1000,
		get scrollHeight() {
			return style.minHeight === "0" ? 412.4 : 600;
		},
	};
	const doc = { body, documentElement: { scrollWidth: 1000, clientWidth: 1000 }, defaultView: null };
	const frame = { contentDocument: doc, contentWindow: { __boardReady: true } } as unknown as HTMLIFrameElement;
	const measured = measureFrame(frame);
	assert.equal(measured?.h, 413, "a fraction of a pixel counts as a pixel, because the alternative clips");
	assert.equal(measured?.page, 413);
	assert.equal(measured?.w, 1000);
	assert.equal(measured?.at, 1000);
	assert.equal(style.minHeight, "600px", "and the floor is put back");
});

test("a board that has not finished mounting is not measured", () => {
	const frame = { contentDocument: { body: {} }, contentWindow: { __boardReady: false } } as unknown as HTMLIFrameElement;
	assert.equal(measureFrame(frame), undefined);
});

test("a page is measured with its stated height released", async () => {
	// The body's height is released for the read, or `board.js` would be answering with the
	// number in the board's <meta> tag and the board could never shrink.
	const style: { height: string } = { height: "590px" };
	const asked: string[] = [];
	const body = {
		style,
		get scrollHeight() {
			asked.push(style.height);
			return 572;
		},
	};
	assert.equal(documentHeight({ body } as unknown as Document), 572);
	assert.deepEqual(asked, ["auto"], "asked while the height was released");
	assert.equal(style.height, "590px", "and put back, so nothing on the board moves");
	assert.equal(documentHeight({ body: null } as unknown as Document), undefined);
});

test("a board with no stated height is measured without the frame's own height as its floor", async () => {
	// `board.js` gives such a board `min-height: 100vh`, the frame it is drawn in; read with it in
	// place, a new board could never come out shorter than the frame it started at.
	const style: { height: string; minHeight: string } = { height: "auto", minHeight: "100vh" };
	const asked: string[] = [];
	const body = {
		style,
		get scrollHeight() {
			asked.push(style.minHeight);
			return style.minHeight === "0" ? 410 : 750;
		},
	};
	assert.equal(documentHeight({ body } as unknown as Document), 410);
	assert.deepEqual(asked, ["0"], "asked with the floor lifted");
	assert.equal(style.minHeight, "100vh", "and the floor put back");
});
