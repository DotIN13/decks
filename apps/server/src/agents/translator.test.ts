import assert from "node:assert/strict";
import { test } from "node:test";
import { titleFor } from "./translator.ts";

/*
 * What a tool row says it was called on.
 *
 * The conversation draws a call as one line — a glyph, the name in mono, and this string —
 * so an empty return here is a row with a name and nothing else, which is the state the app
 * spent a while in for its own `stage_eval`.
 */

test("a file tool is its path, and a shell tool is its command", () => {
	assert.equal(titleFor("read", { path: "apps/web/src/App.tsx" }), "apps/web/src/App.tsx");
	assert.equal(titleFor("edit", { file: "docs/DESIGN.md" }), "docs/DESIGN.md");
	assert.equal(titleFor("bash", { command: "npm test" }), "npm test");
});

test("an MCP prefix is routing, not the tool's name", () => {
	// `mcp__decks__stage_eval` used to fall through to the default, which looks for a short
	// string argument and finds none in a program — so the row was blank.
	assert.equal(
		titleFor("mcp__decks__stage_eval", { code: 'await stage.show("boards/plan.html");\nreturn 1;' }),
		'await stage.show("boards/plan.html");',
	);
	assert.equal(titleFor("mcp__some_server__read", { path: "a.txt" }), "a.txt");
	// A name that merely contains the separator is not a prefix.
	assert.equal(titleFor("read__twice", { path: "a.txt" }), "a.txt", "the default still finds a short string");
});

test("a long argument is cut where a row would cut it anyway", () => {
	const long = `git log ${"--pretty=%h ".repeat(20)}`;
	const title = titleFor("bash", { command: long });
	assert.ok(title.length <= 72, `${title.length} characters`);
	assert.ok(title.endsWith("…"), title);
});

test("nothing to say is an empty string, not a guess", () => {
	assert.equal(titleFor("read", {}), "");
	assert.equal(titleFor("whatever", undefined), "");
	assert.equal(titleFor("whatever", { flag: true, count: 3 }), "", "only strings are ever a title");
});

test("whitespace in an argument is flattened, because a row is one line", () => {
	// Every run of it, including the two spaces `grep` joins its two halves with: a row is
	// one line and a tab in the middle of it would be a gap nobody chose.
	assert.equal(titleFor("grep", { pattern: "  needle\n\there  ", path: "src" }), "needle here src");
});
