import assert from "node:assert/strict";
import { test } from "node:test";
import { contentExtent } from "./extent.ts";

const box = (right: number, bottom: number) => ({ right, bottom, width: 10, height: 10 });

test("the extent is the far corner of everything on the board", () => {
	assert.deepEqual(contentExtent([box(400, 200), box(120, 900), box(360, 80)]), { w: 400, h: 900 });
});

test("an empty board has no extent, rather than an extent of nothing", () => {
	assert.equal(contentExtent([]), undefined);
	assert.equal(contentExtent([{ right: 0, bottom: 0, width: 0, height: 0 }]), undefined, "a hidden component is not content");
});

test("a fraction of a pixel counts as a pixel, because the alternative clips", () => {
	assert.deepEqual(contentExtent([box(400.2, 199.6)]), { w: 401, h: 200 });
});

test("a word budget means the same in Chinese as in English", async () => {
	const { countWords } = await import("./extent.ts");
	assert.equal(countWords("One idea per board, the title is the finding."), 9);
	// 16 Han characters carry about what ten English words do; split on spaces they were one.
	assert.equal(countWords("一块板只讲一件事，标题就是结论本身。"), 10);
	assert.equal(countWords("TrueSkill 记两个数"), 1 + Math.round(4 / 1.6));
});

test("a page is measured as a document, and a board of boxes is not", async () => {
	const { documentHeight } = await import("./extent.ts");
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
