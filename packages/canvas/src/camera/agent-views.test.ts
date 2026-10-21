import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentViews, type ViewStorage } from "./agent-views.ts";

/**
 * Where you were looking, kept on the device.
 *
 * The rules worth asserting are the ones a stored value brings with it: it has to come back
 * across a "reload", it must not leak between decks or between agents, it must not grow forever
 * as conversations are closed, and a value some older build wrote has to be *no view* rather
 * than a canvas that cannot be drawn.
 */

/** A store with nothing in it, and a way to look at what was written. */
function fake(seed: Record<string, string> = {}): ViewStorage & { written: Map<string, string> } {
	const written = new Map(Object.entries(seed));
	return {
		written,
		getItem: (key) => written.get(key) ?? null,
		setItem: (key, value) => void written.set(key, value),
	};
}

const view = { camera: { x: 100, y: 200, zoom: 0.5 }, selected: "boards/plan.html" };

test("a view comes back after a reload", () => {
	const store = fake();
	createAgentViews("/decks/one", store).keep("ada", "main", view);

	// A second store over the same key is what a page load is.
	assert.deepEqual(createAgentViews("/decks/one", store).of("ada", "main"), view);
});

test("…and only for the deck it was made in", () => {
	const store = fake();
	createAgentViews("/decks/one", store).keep("ada", "main", view);
	assert.equal(createAgentViews("/decks/two", store).of("ada", "main"), undefined);
});

test("views of agents that are gone are dropped, and the rest stay", () => {
	const store = fake();
	const views = createAgentViews("/decks/one", store);
	views.keep("ada", "main", view);
	views.keep("rune", "main", view);

	views.retain(["rune"]);
	assert.equal(views.of("ada", "main"), undefined);
	assert.deepEqual(views.of("rune", "main"), view, "a closed chat takes its own view and nothing else");
	assert.deepEqual(createAgentViews("/decks/one", store).of("rune", "main"), view, "and the write went to the device");
});

test("a keep is a copy, so the camera moving on does not rewrite history", () => {
	const live = { x: 1, y: 2, zoom: 1 };
	const store = fake();
	createAgentViews("/decks/one", store).keep("ada", "main", { camera: live });
	live.x = 999;
	assert.equal(createAgentViews("/decks/one", store).of("ada", "main")?.camera.x, 1);
});

/*
 * The values a build ago wrote, a hand edit, and a browser with something else under the same
 * key. A camera of `NaN` is not a view of nowhere: it is a canvas that cannot be drawn, which is
 * why each one is checked and a bad entry is simply not a view.
 */
test("a value that is not a view is no view, and does not take the others with it", () => {
	const store = fake({
		"decks.views:/decks/one": JSON.stringify({
			broken: { camera: { x: "1", y: 2, zoom: 1 } },
			nan: { camera: { x: Number.NaN, y: 0, zoom: 1 } },
			flat: { camera: { x: 0, y: 0, zoom: 0 } },
			"not-an-object": 7,
			ada: { camera: { x: 4, y: 5, zoom: 2 } },
		}),
	});
	const views = createAgentViews("/decks/one", store);
	assert.equal(views.of("broken", "main"), undefined);
	assert.equal(views.of("nan", "main"), undefined);
	assert.equal(views.of("flat", "main"), undefined, "a zoom of zero is not a window");
	assert.equal(views.of("not-an-object", "main"), undefined);
	assert.deepEqual(views.of("ada", "main"), { camera: { x: 4, y: 5, zoom: 2 } });
});

test("unreadable JSON is no views rather than a crash", () => {
	const views = createAgentViews("/decks/one", fake({ "decks.views:/decks/one": "{" }));
	assert.equal(views.of("ada", "main"), undefined);
	views.keep("ada", "main", view);
	assert.deepEqual(views.of("ada", "main"), view, "and it recovers: the next write is a whole map");
});

test("a store that refuses to write is not an error", () => {
	// A browser with storage switched off, or one that is full. The view is lost, which is the
	// same answer a first visit gives — nothing worth interrupting anybody about.
	const refusing: ViewStorage = {
		getItem: () => null,
		setItem: () => {
			throw new Error("QuotaExceededError");
		},
	};
	const views = createAgentViews("/decks/one", refusing);
	views.keep("ada", "main", view);
	assert.deepEqual(views.of("ada", "main"), view, "still held for this session");
});

test("one agent has a view per canvas, and one canvas's view is not another's", () => {
	const store = fake();
	const views = createAgentViews("/decks/one", store);
	const other = { camera: { x: -40, y: 7, zoom: 2 } };
	views.keep("ada", "main", view);
	views.keep("ada", "sketches", other);
	assert.deepEqual(views.of("ada", "main"), view);
	assert.deepEqual(views.of("ada", "sketches"), other);
	assert.equal(views.of("ada", "never-opened"), undefined, "a canvas this device never looked at has no view");
	views.retain(["ada"]);
	assert.deepEqual(createAgentViews("/decks/one", store).of("ada", "sketches"), other, "retain keeps every canvas of a living agent");
});

test("a view kept before canvases were in the key is used once, then replaced", () => {
	const store = fake();
	store.setItem("decks.views:/decks/one", JSON.stringify({ ada: view }));
	const views = createAgentViews("/decks/one", store);
	assert.deepEqual(views.of("ada", "main"), view, "the old view answers for the canvas that asks first");
	views.keep("ada", "main", { camera: { x: 0, y: 0, zoom: 1 } });
	assert.equal(views.of("ada", "sketches"), undefined, "and is gone once the agent has a view of its own");
});
