/**
 * Tests for the cascade gate.
 *
 * Every case here is one of the moves the restructure is about to make, shrunk to four lines
 * of CSS so the answer is knowable by reading it. The two that matter most:
 *
 * - **a rule that changes sheets without changing its neighbours keeps the same hash**, which
 *   is what makes splitting `index.css` verifiable at all;
 * - **a rule that moves past a redefinition of itself changes a tie**, and the report names
 *   the property, so the one kind of move that changes the page cannot go quiet.
 *
 *     node --test scripts/css-order.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { flatten, fingerprint, ties, changedTies, describe, signature } from "./css-order.mjs";

/** A cascade out of an in-memory map of path → text, keyed the way the resolver looks them up. */
const cascade = (files, entry = "entry.css") => flatten((path) => files[path] ?? null, entry);
const hashOf = (files, entry) => fingerprint(cascade(files, entry));

test("comments and blank lines do not move the hash", () => {
	const plain = { "entry.css": `.a { color: red }` };
	const noisy = { "entry.css": `/* why */\n\n.a {\n\t/* more */\n\tcolor: red;\n}\n` };
	assert.equal(hashOf(plain), hashOf(noisy));
});

test("a declaration's order inside the block is part of the rule", () => {
	const one = { "entry.css": `.a { background: red; background-color: blue }` };
	const two = { "entry.css": `.a { background-color: blue; background: red }` };
	assert.notEqual(hashOf(one), hashOf(two));
});

test("a rule that changes sheets keeps the hash when its neighbours keep theirs", () => {
	// The split, in miniature: `.a` is the only rule in `one.css`, and `two.css` comes after.
	const before = { "entry.css": `@import "./one.css";\n@import "./two.css";`, "one.css": `.a { color: red }`, "two.css": `.b { color: blue }` };
	const after = { "entry.css": `@import "./one.css";\n@import "./two.css";`, "one.css": `` , "two.css": `.a { color: red }\n.b { color: blue }` };
	assert.equal(hashOf(before), hashOf(after));
});

test("swapping two imports changes the hash", () => {
	const one = { "entry.css": `@import "./a.css";\n@import "./b.css";`, "a.css": `.x { color: red }`, "b.css": `.y { color: blue }` };
	const two = { "entry.css": `@import "./b.css";\n@import "./a.css";`, "a.css": `.x { color: red }`, "b.css": `.y { color: blue }` };
	assert.notEqual(hashOf(one), hashOf(two));
});

test("the position of a package import is guarded, because a utility wins from there", () => {
	const before = { "entry.css": `@import "tailwindcss";\n.a { color: red }` };
	const after = { "entry.css": `.a { color: red }\n@import "tailwindcss";` };
	assert.notEqual(hashOf(before), hashOf(after));
});

test("moving a rule later in the cascade changes the hash, and says which rule moved", () => {
	const before = { "entry.css": `.a { color: red }\n.b { color: blue }` };
	const after = { "entry.css": `.b { color: blue }\n.a { color: red }` };
	assert.notEqual(hashOf(before), hashOf(after));
	/*
	 * One move, not two: the alignment keeps `.b` where it can and says `.a` went past it.
	 * Reporting both as moved would be true and much less useful to read.
	 */
	const changes = describe(cascade(before), cascade(after));
	assert.deepEqual(changes.moved.map((m) => m.from.sel), [".a"]);
	assert.deepEqual([changes.moved[0].was, changes.moved[0].now], [0, 1]);
	assert.deepEqual([changes.moved[0].from.line, changes.moved[0].to.line], [1, 2]);
	assert.equal(changes.added.length, 0);
	assert.equal(changes.removed.length, 0);
});

test("one rule inserted in the middle is one addition, not a move of everything after it", () => {
	const before = { "entry.css": `.a { color: red }\n.b { color: blue }` };
	const after = { "entry.css": `.a { color: red }\n.x { color: pink }\n.b { color: blue }` };
	const changes = describe(cascade(before), cascade(after));
	assert.deepEqual(changes.added.map((a) => a.rule.sel), [".x"]);
	assert.equal(changes.moved.length, 0);
	assert.equal(changes.removed.length, 0);
});

test("inserting and removing are reported as such", () => {
	const before = { "entry.css": `.a { color: red }` };
	const after = { "entry.css": `.a { color: red }\n.b { color: blue }` };
	assert.equal(describe(cascade(before), cascade(after)).added.length, 1);
	assert.equal(describe(cascade(after), cascade(before)).removed.length, 1);
});

test("a rule moved out of a media block changes the hash", () => {
	const inside = { "entry.css": `@media (pointer: coarse) { .a { color: red } }` };
	const outside = { "entry.css": `.a { color: red }` };
	assert.notEqual(hashOf(inside), hashOf(outside));
	assert.equal(signature(cascade(inside)[0]), "@media (pointer: coarse) ▸ .a{color:red}");
});

test("a redefinition is a tie, and putting the two back in the other order says which property", () => {
	const before = {
		"entry.css": `.side[data-open] { opacity: 0 }\n.other { color: red }\n.side[data-open] { opacity: 1 }`,
	};
	const after = {
		"entry.css": `.side[data-open] { opacity: 1 }\n.side[data-open] { opacity: 0 }\n.other { color: red }`,
	};
	assert.equal(ties(cascade(before)).size, 1);
	const fired = changedTies(cascade(before), cascade(after));
	assert.equal(fired.length, 1);
	assert.equal(fired[0].property, "opacity");
	assert.equal(fired[0].rules, 2);
	// The rule that won before was the third, and it is the second now: the page changed.
	assert.deepEqual(fired[0].was, { file: "entry.css", line: 3 });
	assert.deepEqual(fired[0].now, { file: "entry.css", line: 2 });
	// And the value that decides it, because a line number alone says nothing when a rule is edited in place.
	assert.deepEqual(fired[0].value, { was: "1", now: "0" });
});

test("a move that decides no tie is reported as a move and no more", () => {
	const before = { "entry.css": `.a { color: red }\n.b { color: blue }` };
	const after = { "entry.css": `.b { color: blue }\n.a { color: red }` };
	assert.deepEqual(describe(cascade(before), cascade(after)).ties, []);
});

test("two identical redefinitions passed over each other are not an alarm", () => {
	/*
	 * The app's three ties are one block written twice, which is why no reorder of them can
	 * change anything and why the alarm is about the winning *value* rather than the order.
	 */
	const before = { "entry.css": `.a { opacity: 1 }\n.b { color: red }\n.a { opacity: 1 }` };
	const after = { "entry.css": `.a { opacity: 1 }\n.a { opacity: 1 }\n.b { color: red }` };
	assert.equal(ties(cascade(before)).size, 1);
	assert.deepEqual(changedTies(cascade(before), cascade(after)), []);
});

test("editing the value a redefinition wins with is an alarm, in place", () => {
	const before = { "entry.css": `.a { opacity: 0.5 }\n.a { opacity: 1 }` };
	const after = { "entry.css": `.a { opacity: 0.5 }\n.a { opacity: 0.9 }` };
	const fired = changedTies(cascade(before), cascade(after));
	assert.deepEqual(fired.map((f) => f.value), [{ was: "1", now: "0.9" }]);
});

test("rules are reported with the line they start on", () => {
	const rules = cascade({ "entry.css": `/* one */\n\n.a { color: red }\n\n.b { color: blue }` });
	assert.equal(rules[0].line, 3);
	assert.equal(rules[1].line, 5);
});

test("a rule inside a layer counts from the top of the file, not from the brace", () => {
	/*
	 * Every sheet in the app wraps its rules in one `@layer components`, so a line number that
	 * restarts at the brace is wrong for all 976 of them by a few hundred lines — which is how
	 * the first version of this reported `.side[data-open="true"]` at 1788 instead of 2083.
	 */
	const rules = cascade({
		"entry.css": `@layer components {\n\t.a { color: red }\n\n\t@media (pointer: coarse) {\n\t\t.b { color: blue }\n\t}\n}`,
	});
	assert.deepEqual(rules.map((r) => r.line), [2, 5]);
	assert.equal(rules[1].sel, "@layer components ▸ @media (pointer: coarse) ▸ .b");
});
