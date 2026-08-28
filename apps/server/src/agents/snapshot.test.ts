import assert from "node:assert/strict";
import { test } from "node:test";
import type { StageSnapshot } from "../stage/tool.ts";
import { SnapshotStore } from "./snapshot.ts";

const snapshot = (context: string[], name = "Agent"): StageSnapshot => ({
	context,
	inPlay: context,
	camera: { x: 0, y: 0, zoom: 1 },
	identity: { name, color: "#000" },
});

test("the newest snapshot is what a starting agent gets", () => {
	const store = new SnapshotStore();
	store.record("a", snapshot(["one.html"]), 100);
	store.record("a", snapshot(["one.html", "two.html"]), 200);
	assert.deepEqual(store.latest("a")?.context, ["one.html", "two.html"]);
	assert.equal(store.latest("b"), undefined, "an agent with no history has none");
});

test("a rewind asks what the canvas was at a moment", () => {
	const store = new SnapshotStore();
	store.record("a", snapshot(["one.html"]), 100);
	store.record("a", snapshot(["one.html", "two.html"]), 200);
	store.record("a", snapshot(["three.html"]), 300);

	assert.deepEqual(store.at("a", 250)?.context, ["one.html", "two.html"], "the newest at or before it");
	assert.deepEqual(store.at("a", 100)?.context, ["one.html"], "inclusive of the moment itself");
	assert.equal(store.at("a", 50), undefined, "before anything was recorded");
});

test("order is not assumed, because a clock is not a guarantee", () => {
	const store = new SnapshotStore();
	// Recorded out of order on purpose: `record` is called from a tool run.
	store.record("a", snapshot(["late.html"]), 300);
	store.record("a", snapshot(["early.html"]), 100);
	assert.deepEqual(store.at("a", 200)?.context, ["early.html"]);
});

test("a fork inherits its parent's canvas up to the fork point", () => {
	const store = new SnapshotStore();
	store.record("parent", snapshot(["one.html"]), 100);
	store.record("parent", snapshot(["one.html", "two.html"]), 200);
	store.record("parent", snapshot(["after-the-fork.html"]), 300);

	store.seed("parent", "child", 250);
	assert.deepEqual(store.latest("child")?.context, ["one.html", "two.html"], "as it was at the fork");
	assert.equal(store.at("child", 300)?.context.includes("after-the-fork.html"), false, "and nothing later");
	assert.deepEqual(store.latest("parent")?.context, ["after-the-fork.html"], "the parent is untouched");
});

test("seeding from an agent with no history leaves the child empty", () => {
	const store = new SnapshotStore();
	store.seed("nobody", "child", Date.now());
	assert.equal(store.latest("child"), undefined);
});

test("an agent that is gone keeps nothing", () => {
	const store = new SnapshotStore();
	store.record("a", snapshot(["one.html"]));
	store.forget("a");
	assert.equal(store.latest("a"), undefined);
});
