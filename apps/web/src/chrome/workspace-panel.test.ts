import { test } from "node:test";
import assert from "node:assert/strict";
import type { Board, Identity } from "@decks/protocol";
import { relativeTime, WORKSPACE_NONE, workspaceDigests } from "./workspace-panel.ts";

const identity = (workspace?: string, name?: string): Identity => ({
	name: name ?? workspace ?? "An agent",
	color: "#000",
	...(workspace ? { workspace } : {}),
});

const board = (path: string, modifiedAt: number, lastWrittenBy?: string): Board => ({
	path,
	title: path.replace("boards/", ""),
	format: "board",
	x: 0,
	y: 0,
	w: 100,
	h: 100,
	rev: 1,
	inContext: [],
	modifiedAt,
	...(lastWrittenBy ? { lastWrittenBy } : {}),
});

test("a workspace's boards are the ones its agents hold, latest first", () => {
	const old = board("boards/old.html", 100);
	const fresh = board("boards/fresh.html", 200);
	const digests = workspaceDigests(
		[old, fresh],
		{ a: identity("political-llm", "Ada") },
		{ a: ["boards/old.html", "boards/fresh.html"] },
	);
	assert.equal(digests.length, 1);
	assert.deepEqual(digests[0]!.boards.map((b) => b.path), ["boards/fresh.html", "boards/old.html"]);
	assert.equal(digests[0]!.latestAt, 200);
});

test("two workspaces holding the same board both show it — the truth twice", () => {
	const shared = board("boards/shared.html", 100);
	const digests = workspaceDigests(
		[shared],
		{ a: identity("alpha", "Ada"), b: identity("beta", "Bo") },
		{ a: ["boards/shared.html"], b: ["boards/shared.html"] },
	);
	assert.equal(digests.length, 2);
	for (const section of digests) assert.deepEqual(section.boards.map((b) => b.path), ["boards/shared.html"]);
});

test("sections are A to Z, with the no-workspace catch-all last", () => {
	const digests = workspaceDigests(
		[],
		{ a: identity("zeta", "Zoe"), b: identity("alpha", "Abe"), c: identity(undefined, "Neo") },
		{},
	);
	assert.deepEqual(digests.map((section) => section.name), ["alpha", "zeta", WORKSPACE_NONE()]);
	assert.equal(digests[2]!.real, false);
});

test("the cap hides the older tail: five shown, six held", () => {
	const boards = Array.from({ length: 6 }, (_, index) => board(`boards/b${index}.html`, index));
	const digests = workspaceDigests(
		boards,
		{ a: identity("alpha", "Ada") },
		{ a: boards.map((b) => b.path) },
		5,
	);
	assert.equal(digests[0]!.boards.length, 5);
	assert.equal(digests[0]!.boards[0]!.path, "boards/b5.html"); // the newest
});

test("a workspace with agents but no boards still exists — it just has nothing yet", () => {
	const digests = workspaceDigests([], { a: identity("empty-project", "Ada") }, {});
	assert.equal(digests.length, 1);
	assert.equal(digests[0]!.name, "empty-project");
	assert.equal(digests[0]!.boards.length, 0);
});

test("a held board that was deleted is not a section's work", () => {
	const digests = workspaceDigests([board("boards/kept.html", 100)], { a: identity("alpha", "Ada") }, {
		a: ["boards/kept.html", "boards/gone.html"],
	});
	assert.deepEqual(digests[0]!.boards.map((b) => b.path), ["boards/kept.html"]);
});

test("relativeTime says what a byline wants, not what a clock says", () => {
	assert.equal(relativeTime(Date.now() - 5_000), "just now");
	assert.equal(relativeTime(Date.now() - 2 * 60_000), "2m ago");
	assert.equal(relativeTime(Date.now() - 3 * 3_600_000), "3h ago");
	assert.equal(relativeTime(Date.now() - 4 * 86_400_000), "4d ago");
});