import assert from "node:assert/strict";
import { test } from "node:test";
import { cardLoader } from "./card-load.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(answers: Array<{ ok: boolean; text?: string } | Error>) {
	const mounted: string[] = [];
	const timers: Array<() => void> = [];
	let reads = 0;
	const loader = cardLoader({
		url: () => "/api/t/T/card/canvases/c/cards/a@1/index.html?raw=1",
		read: async () => {
			const answer = answers[Math.min(reads++, answers.length - 1)]!;
			if (answer instanceof Error) throw answer;
			return { ok: answer.ok, text: async () => answer.text ?? "" };
		},
		mount: (html) => mounted.push(html),
		setTimer: (run) => timers.push(run),
		clearTimer: () => timers.splice(0),
	});
	return { loader, mounted, timers, reads: () => reads };
}

test("a card whose file came is mounted", async () => {
	const { loader, mounted } = harness([{ ok: true, text: "<p>hi</p>" }]);
	loader.load();
	await settle();
	assert.deepEqual(mounted, ["<p>hi</p>"]);
});

test("a card whose file was refused is not mounted, so its picture stays, and is asked for once more", async () => {
	const { loader, mounted, timers, reads } = harness([{ ok: false }, { ok: true, text: "<p>back</p>" }]);
	loader.load();
	await settle();
	assert.deepEqual(mounted, [], "nothing mounted: no blank paper");
	assert.equal(timers.length, 1, "one retry waiting");
	timers.shift()!();
	await settle();
	assert.equal(reads(), 2);
	assert.deepEqual(mounted, ["<p>back</p>"]);
});

test("a retry that fails too waits for the next ask, and a network error counts as a failure", async () => {
	const { loader, mounted, timers, reads } = harness([new Error("offline"), { ok: false }, { ok: true, text: "x" }]);
	loader.load();
	await settle();
	timers.shift()!();
	await settle();
	assert.equal(timers.length, 0, "only once");
	assert.deepEqual(mounted, []);
	loader.load();
	await settle();
	assert.equal(reads(), 3);
	assert.deepEqual(mounted, ["x"]);
});

test("a stopped card mounts nothing that was on its way, and makes no retry", async () => {
	const { loader, mounted, timers } = harness([{ ok: false }]);
	loader.load();
	loader.stop();
	await settle();
	assert.deepEqual(mounted, []);
	assert.equal(timers.length, 0);
});

test("a card its host has no copy of (404 with X-Decks-Missing) is said to be missing, not mounted and not asked for again", async () => {
	const mounted: string[] = [];
	const timers: Array<() => void> = [];
	let missing = 0;
	const loader = cardLoader({
		url: () => "/api/live/P/cards/a@1/index.html?raw=1",
		read: async () => ({ ok: false, status: 404, headers: new Headers({ "X-Decks-Missing": "1" }), text: async () => "" }),
		mount: (html) => mounted.push(html),
		missing: () => missing++,
		setTimer: (run) => timers.push(run),
		clearTimer: () => timers.splice(0),
	});
	loader.load();
	await settle();
	assert.equal(missing, 1);
	assert.deepEqual(mounted, []);
	assert.equal(timers.length, 0, "no retry: there is nothing to come");
});

test("a plain 404 is a failure like any other: asked for once more, not said to be missing", async () => {
	const timers: Array<() => void> = [];
	let missing = 0;
	const loader = cardLoader({
		url: () => "/api/t/T/card/canvases/c/cards/a@1/index.html?raw=1",
		read: async () => ({ ok: false, status: 404, headers: new Headers(), text: async () => "" }),
		mount: () => {},
		missing: () => missing++,
		setTimer: (run) => timers.push(run),
		clearTimer: () => timers.splice(0),
	});
	loader.load();
	await settle();
	assert.equal(missing, 0);
	assert.equal(timers.length, 1);
});
