import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSplice as transform } from "./index.ts";
import { applySplices, invert, land, spliceDiff } from "./merge.ts";

test("a batch made on the current text lands as it was sent", () => {
	const text = "Hello world";
	const landed = land(text, [{ at: 5, before: "", text: "," }, { at: 7, before: "world", text: "there" }], []);
	assert.equal(landed.text, "Hello, there");
	assert.deepEqual(landed.refused, []);
});

test("typing lands past an agent's edit earlier in the file", () => {
	const base = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
	const agent = [{ at: 9, before: "First", text: "The first" }];
	const after = applySplices(base, agent);
	const at = base.indexOf("Second") + "Second".length;
	const landed = land(after, [{ at, before: "", text: " and last" }], agent);
	assert.equal(landed.text, "# Title\n\nThe first paragraph.\n\nSecond and last paragraph.\n");
	assert.deepEqual(landed.refused, []);
});

test("an agent's edit later in the file does not move the typing", () => {
	const base = "alpha beta gamma";
	const agent = [{ at: 11, before: "gamma", text: "delta" }];
	const landed = land(applySplices(base, agent), [{ at: 0, before: "alpha", text: "ALPHA" }], agent);
	assert.equal(landed.text, "ALPHA beta delta");
});

test("each splice of a batch is moved in the text the earlier ones left", () => {
	const base = "one two three";
	const agent = [{ at: 0, before: "", text: ">> " }];
	// Two keystrokes in a row: the second's offset counts the first.
	const batch = [{ at: 3, before: "", text: "!" }, { at: 4, before: "", text: "?" }];
	const landed = land(applySplices(base, agent), batch, agent);
	assert.equal(landed.text, ">> one!? two three");
});

test("a short collision is refused; a long one is found by its old text", () => {
	const base = "The effect is really quite small in size overall.";
	const agent = [{ at: 4, before: "effect is really quite small in size overall", text: "effect is small" }];
	const after = applySplices(base, agent);
	const short = land(after, [{ at: 4, before: "eff", text: "EFF" }], agent);
	assert.deepEqual(short.refused, [0]);
	assert.equal(short.text, after);
	const long = land("Keep this sentence here. " + after, [{ at: 0, before: "Keep this sentence", text: "Kept" }], undefined);
	assert.deepEqual(long.refused, []);
	assert.ok(long.text.startsWith("Kept here."));
});

test("two insertions at one point keep the page's first", () => {
	assert.deepEqual(transform({ at: 3, before: "", text: "A" }, { at: 3, before: "", text: "B" }, true), { at: 3, before: "", text: "A" });
	assert.deepEqual(transform({ at: 3, before: "", text: "B" }, { at: 3, before: "", text: "A" }, false), { at: 4, before: "", text: "B" });
});

test("a diff's splices turn one text into the other, and their inverse turns it back", () => {
	const seeds = ["", "a\n", "line one\nline two\nline three\n", "x\ny\nz\n"];
	let n = 0;
	for (const from of seeds) {
		for (let k = 0; k < 40; k++) {
			const lines = from.split("\n");
			const pick = (i: number) => (i * 7 + k * 13 + n++) % 5;
			const edited = lines.map((line, i) => (pick(i) === 0 ? `${line} changed ${k}` : pick(i) === 1 ? "" : line));
			if (k % 3 === 0) edited.splice(k % (edited.length + 1), 0, `inserted ${k}`);
			const to = edited.join("\n");
			const splices = spliceDiff(from, to);
			assert.equal(applySplices(from, splices), to);
			assert.equal(applySplices(to, invert(splices)), from);
		}
	}
});

test("one changed word is one splice of that word, in prose and in XML", () => {
	const from = `<w:body><w:p><w:r><w:t>Results</w:t></w:r></w:p><w:p><w:r><w:t>The effect is small.</w:t></w:r></w:p></w:body>`;
	const to = from.replace("small", "tiny");
	const splices = spliceDiff(from, to);
	assert.equal(splices.length, 1);
	assert.equal(splices[0]!.before, "small.");
	assert.equal(applySplices(from, splices), to);
});
