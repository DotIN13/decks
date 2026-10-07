import assert from "node:assert/strict";
import { test } from "node:test";
import { applySplice, transformSplice as transform, transformSplices } from "./index.ts";
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

test("typing inside words an agent rewrote is kept, just after the agent's words", () => {
	const base = "The effect is really quite small in size overall.";
	const agent = [{ at: 4, before: "effect is really quite small in size overall", text: "effect is small" }];
	const after = applySplices(base, agent);
	// A key typed inside "really", which the agent's rewrite removed.
	const at = base.indexOf("really") + 3;
	const landed = land(after, [{ at, before: "", text: "!" }], agent);
	assert.deepEqual(landed.refused, []);
	assert.equal(landed.text, "The effect is small!.");
});

test("overlapping deletions remove each character once", () => {
	const base = "abcdefgh";
	const mine = { at: 2, before: "cde", text: "X" };
	const theirs = { at: 3, before: "def", text: "Y" };
	const one = applySplices(applySplices(base, [theirs]), transform(mine, theirs, true));
	const two = applySplices(applySplices(base, [mine]), transform(theirs, mine, false));
	assert.equal(one, two);
	assert.equal(one, "abXYgh");
});

test("a page's batch made on an old text lands without history by its old words", () => {
	const text = "Keep this sentence here. The rest.";
	const long = land(text, [{ at: 0, before: "Keep this sentence", text: "Kept" }], undefined);
	assert.deepEqual(long.refused, []);
	assert.ok(long.text.startsWith("Kept here."));
	const short = land(text, [{ at: 0, before: "Kee", text: "K" }], undefined);
	assert.deepEqual(short.refused, [0]);
});

test("any two edits of one text, applied in either order, give the same text", () => {
	let seed = 7;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
	const words = ["", "x", "yy", "zzz"];
	for (let n = 0; n < 20000; n++) {
		const base = "0123456789".slice(0, 3 + Math.floor(rnd() * 8));
		const make = () => {
			const at = Math.floor(rnd() * (base.length + 1));
			const len = Math.floor(rnd() * Math.min(4, base.length - at + 1));
			return { at, before: base.slice(at, at + len), text: words[Math.floor(rnd() * 4)]! };
		};
		const a = make();
		const b = make();
		const first = rnd() < 0.5;
		const ab = transform(a, b, first).reduce(applySplice, applySplice(base, b));
		const ba = transform(b, a, !first).reduce(applySplice, applySplice(base, a));
		assert.equal(ab, ba, `${base} a=${JSON.stringify(a)} b=${JSON.stringify(b)} aFirst=${first}`);
	}
});

test("sequences of edits converge the same way", () => {
	let seed = 11;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
	for (let n = 0; n < 3000; n++) {
		const base = "abcdefghijkl";
		const seq = () => {
			let text = base;
			const out = [];
			for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
				const at = Math.floor(rnd() * (text.length + 1));
				const len = Math.floor(rnd() * Math.min(3, text.length - at + 1));
				const splice = { at, before: text.slice(at, at + len), text: rnd() < 0.5 ? "" : "Q".repeat(1 + Math.floor(rnd() * 2)) };
				text = applySplice(text, splice);
				out.push(splice);
			}
			return out;
		};
		const a = seq();
		const b = seq();
		const moved = transformSplices(a, b, true);
		assert.equal(moved.a.reduce(applySplice, b.reduce(applySplice, base)), moved.b.reduce(applySplice, a.reduce(applySplice, base)));
	}
});

test("two insertions at one point keep the page's first", () => {
	assert.deepEqual(transform({ at: 3, before: "", text: "A" }, { at: 3, before: "", text: "B" }, true), [{ at: 3, before: "", text: "A" }]);
	assert.deepEqual(transform({ at: 3, before: "", text: "B" }, { at: 3, before: "", text: "A" }, false), [{ at: 4, before: "", text: "B" }]);
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
	assert.deepEqual(splices[0], { at: from.indexOf("small"), before: "small", text: "tiny" });
	assert.deepEqual(spliceDiff("The effect is small.\n", "The effect is small but reliable.\n"), [{ at: 19, before: "", text: " but reliable" }]);
	assert.equal(applySplices(from, splices), to);
});
