import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, capped, globMatcher, isText, matchLines, pathParts, Refused, searchPattern, sliceLines, type TextMatch } from "../src/text-files.ts";

test("a path is from the deck's root: never absolute, upward or hidden, and a write never reaches lib/ or the root", () => {
	assert.deepEqual(pathParts("./canvases/plan/cards/q3/index.html"), ["canvases", "plan", "cards", "q3", "index.html"]);
	assert.deepEqual(pathParts("canvases\\plan/"), ["canvases", "plan"]);
	assert.deepEqual(pathParts(""), [], "the root itself, to list");
	for (const bad of ["/etc/passwd", "C:\\x", "../x", "a/../b", "a//b", ".decks/tokens.json", "a/.git/HEAD", 7]) assert.throws(() => pathParts(bad), Refused, String(bad));
	assert.deepEqual(pathParts("lib/card.css"), ["lib", "card.css"], "lib is read");
	assert.throws(() => pathParts("lib/card.css", { write: true }), /not edited/);
	assert.throws(() => pathParts("", { write: true }), /the deck itself/);
});

test("a glob with no slash matches a file's name anywhere; one with a slash matches from the folder searched", () => {
	assert.ok(globMatcher("*.md")("canvases/plan/files/notes.md"));
	assert.ok(!globMatcher("*.md")("canvases/plan/files/notes.mdx"));
	assert.ok(globMatcher("canvases/*/cards/*/index.html")("canvases/plan/cards/q3/index.html"));
	assert.ok(!globMatcher("canvases/*/cards/*/index.html")("canvases/plan/cards/q3/deep/index.html"));
	assert.ok(globMatcher("**/index.html")("canvases/plan/cards/q3/index.html"));
	assert.ok(globMatcher("cards/*/index.html", "canvases/plan")("canvases/plan/cards/q3/index.html"));
	assert.ok(globMatcher("data-?.json")("x/data-1.json") && !globMatcher("data-?.json")("x/data-12.json"));
});

test("a read answers the whole text, or the lines asked for with how many there are and whether more follow", () => {
	const text = "one\ntwo\nthree\nfour";
	assert.deepEqual(sliceLines(text), { text, from: 1, lines: 4 });
	assert.deepEqual(sliceLines(text, { from: 2, lines: 2 }), { text: "two\nthree", from: 2, lines: 4, more: true });
	assert.deepEqual(sliceLines(text, { from: 4, lines: 10 }), { text: "four", from: 4, lines: 4 });
	assert.deepEqual(sliceLines(text, { from: -3 }), { text, from: 1, lines: 4 });
});

test("edits land in order or not at all: a find must be there, and once unless all is set", () => {
	assert.equal(applyEdits("a.md", "one two two", [{ find: "one", replace: "1" }, { find: "two", replace: "2", all: true }]), "1 2 2");
	assert.equal(applyEdits("a.md", "cost $1", [{ find: "$1", replace: "$&$1" }]), "cost $&$1", "the replacement is taken as written");
	assert.throws(() => applyEdits("a.md", "one", [{ find: "three", replace: "3" }]), /"three" is not in a\.md\. Nothing was changed\./);
	assert.throws(() => applyEdits("a.md", "two two", [{ find: "two", replace: "2" }]), /is in a\.md 2 times/);
	assert.throws(() => applyEdits("a.md", "one two", [{ find: "one", replace: "1" }, { find: "nine", replace: "9" }]), /Edit 2: "nine" is not in a\.md/);
	assert.throws(() => applyEdits("a.md", "one", []), Refused);
});

test("a search answers each matching line with its number, cut at 300 characters, up to the most asked for", () => {
	const out: TextMatch[] = [];
	const long = `x${"y".repeat(400)}`;
	assert.equal(matchLines("a.md", `alpha\nbeta\n${long}\nalphabet`, searchPattern("alpha|^x"), out, 10), false);
	assert.deepEqual(out.map((one) => [one.line, one.text.length]), [[1, 5], [3, 301], [4, 8]]);
	assert.equal(matchLines("b.md", "alpha\nalpha", searchPattern("ALPHA", { ignoreCase: true }), out, 4), true, "full at four");
	assert.equal(out.length, 4);
	assert.throws(() => searchPattern("("), /not a regular expression/);
	assert.throws(() => searchPattern(""), Refused);
});

test("text has no zero byte near its start, and a call answers 200 unless told, 2,000 at most", () => {
	assert.ok(isText(new TextEncoder().encode("plain words")));
	assert.ok(!isText(new Uint8Array([137, 80, 78, 71, 0, 0])));
	assert.deepEqual([capped(undefined), capped(50), capped(99999), capped(-1, 7)], [200, 50, 2000, 7]);
});
