import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanWorkspace, MAX_WORKSPACE_LENGTH, roster, sameWorkspace, type RosterEntry } from "./workspaces.ts";

/*
 * What a workspace may be called, and who ends up in which one.
 *
 * The rule itself is `slug.ts` and is exercised through tags as well; what is here is the two
 * policies on top of it — that an empty result is an *absence* rather than a name, and that the
 * roster's order is the one the panel and the dropdown both read.
 */

test("a workspace is slugged, so two spellings of one project are one workspace", () => {
	assert.equal(cleanWorkspace("Political LLM"), "political-llm");
	assert.equal(cleanWorkspace("political-llm"), "political-llm");
	assert.equal(cleanWorkspace("  IRB 84069 "), "irb-84069");
	assert.equal(cleanWorkspace("Political LLM"), cleanWorkspace("political llm"));
	assert.equal(cleanWorkspace("水墨花卉"), "水墨花卉", "an agent working on this should be able to say so");
});

test("nothing, or nothing but punctuation, means no workspace", () => {
	// One absence rather than three: the panel draws one section for all of them.
	assert.equal(cleanWorkspace(""), null);
	assert.equal(cleanWorkspace("   "), null);
	assert.equal(cleanWorkspace("!!!"), null);
	assert.equal(cleanWorkspace(null), null);
	assert.equal(cleanWorkspace(undefined), null);
	assert.equal(cleanWorkspace(42), null, "a number is not a workspace");
});

test("a long name is cut at 24, on a word boundary where there is one", () => {
	const long = cleanWorkspace("a very long description of the project we are all on");
	assert.ok(long !== null && long.length <= MAX_WORKSPACE_LENGTH, String(long));
	assert.ok(!long?.endsWith("-"), String(long));
	assert.equal(cleanWorkspace("reading the panel css and measuring it"), "reading-the-panel-css");
});

test("the same workspace twice is a no-op, and absence equals absence", () => {
	assert.equal(sameWorkspace("political-llm", "political-llm"), true);
	assert.equal(sameWorkspace(undefined, null), true, "no workspace either way is one state");
	assert.equal(sameWorkspace("political-llm", "irb-84069"), false);
	assert.equal(sameWorkspace(undefined, "irb-84069"), false);
});

const entry = (id: string, workspace?: string, context: string[] = []): RosterEntry => ({
	id,
	name: id[0]?.toUpperCase() + id.slice(1),
	state: "idle",
	tags: [],
	...(workspace ? { workspace } : {}),
	context,
});

test("biggest first, then alphabetically", () => {
	const list = roster([entry("a", "zeta"), entry("b", "zeta"), entry("c", "alpha"), entry("d", "alpha"), entry("e", "alpha")]);
	assert.deepEqual(list.map((one) => one.name), ["alpha", "zeta"]);
	assert.deepEqual(list[0]?.agents.map((one) => one.id), ["c", "d", "e"], "members keep the order they arrived in");
});

test("an agent in no workspace is in no group", () => {
	const list = roster([entry("a", "political-llm"), entry("b"), entry("c")]);
	assert.deepEqual(list.map((one) => one.name), ["political-llm"]);
	assert.deepEqual(list[0]?.agents.map((one) => one.id), ["a"]);
});

test("boards: the ones most members hold come first, ties by path", () => {
	const list = roster([
		entry("a", "p", ["boards/plan.html", "boards/risk.html"]),
		entry("b", "p", ["boards/plan.html"]),
		entry("c", "other", ["boards/plan.html"]),
	]);
	// `plan` is held by two of the three, `risk` by one — and the workspace's own list is the
	// union, not the intersection, because a board one member is working from is still the
	// workspace's board.
	assert.deepEqual(list[0]?.boards, ["boards/plan.html", "boards/risk.html"]);
});

test("…and a member holding the same board twice is one member", () => {
	const list = roster([entry("a", "p", ["boards/plan.html", "boards/plan.html"]), entry("b", "p", [])]);
	assert.deepEqual(list[0]?.boards, ["boards/plan.html"]);
});

test("two workspaces of one member each break on the name, not on the input order", () => {
	const list = roster([entry("a", "zeta"), entry("b", "alpha")]);
	assert.deepEqual(list.map((one) => one.name), ["alpha", "zeta"]);
});

test("no workspaces at all is an empty roster, not one empty group", () => {
	assert.deepEqual(roster([]), []);
	assert.deepEqual(roster([entry("a"), entry("b")]), []);
});
