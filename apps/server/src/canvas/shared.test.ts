import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Deck } from "../deck/loader.ts";
import { AgentStateStore } from "../agents/agent-state.ts";
import { DeckAgent } from "../agents/session.ts";
import { AgentStore } from "../agents/store.ts";
import type { StageService } from "../stage/service.ts";
import { CanvasStore } from "./store.ts";

/*
 * Two agents, one canvas.
 *
 * This is the behaviour the whole move is for, and it could not be written before: what is up
 * and where it sits were a copy per chat, so two agents working on one thing had two answers
 * to "where is that board". Here they have one, and each still keeps its own reading.
 */

function deckOn() {
	const root = mkdtempSync(join(tmpdir(), "decks-shared-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	for (const name of ["plan.html", "notes.html"]) {
		writeFileSync(join(root, "boards", name), `<!doctype html><title>${name}</title><body class="board"></body>`);
	}
	return { deck: Deck.open(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function pair(deck: Deck) {
	const canvases = new CanvasStore(deck.path);
	const told: string[] = [];
	const agents: DeckAgent[] = [];
	const make = (name: string, color: string) =>
		new DeckAgent(
			deck,
			() => {},
			{} as StageService,
			{
				port: 4329,
				camera: () => ({ x: 0, y: 0, zoom: 1 }),
				agents: () => [],
				send: () => ({ queued: true as const, position: 1 }),
				queue: () => [],
				report: () => {},
				brief: (task: string) => task,
				recordRevision: () => undefined,
				boardPathOf: () => undefined,
				// What the registry does: everybody else on that canvas is told.
				canvasChanged: (canvasId: string, except: string) => {
					for (const other of agents) {
						if (other.id === except || other.canvas !== canvasId) continue;
						told.push(other.id);
						other.canvasMoved();
					}
				},
			},
			{ name, color, kind: "pi", snapshots: new AgentStateStore(), store: new AgentStore(deck), canvases },
		);
	const one = make("Sable", "#3b5cf6");
	const two = make("Rune", "#2eaf5a");
	agents.push(one, two);
	return { one, two, canvases, told };
}

test("a board one agent shows is on the canvas for the other", () => {
	const { deck, cleanup } = deckOn();
	const { one, two, told } = pair(deck);
	one.useCanvas("Political LLM");
	two.useCanvas("political-llm");
	assert.equal(one.canvas, two.canvas, "one name, however it is spelled, is one canvas");

	one.setInPlay(["boards/plan.html"], { place: true });
	assert.deepEqual(two.inPlay, ["boards/plan.html"]);
	assert.equal(told.includes(two.id), true, "and its browser is told");
	cleanup();
});

test("a board dragged by one agent is in the same place for the other", () => {
	const { deck, cleanup } = deckOn();
	const { one, two } = pair(deck);
	one.useCanvas("work");
	two.useCanvas("work");
	one.setInPlay(["boards/plan.html"], { place: true });
	one.setPosition("boards/plan.html", 640, 320);
	assert.deepEqual(two.positions()["boards/plan.html"], { x: 640, y: 320 });
	cleanup();
});

test("what each agent has read stays its own", () => {
	const { deck, cleanup } = deckOn();
	const { one, two } = pair(deck);
	one.useCanvas("work");
	two.useCanvas("work");
	one.setContext(["boards/plan.html", "boards/notes.html"]);
	assert.deepEqual([...two.context], [], "reading is private; the canvas is shared");
	cleanup();
});

test("agents on different canvases do not disturb each other", () => {
	const { deck, cleanup } = deckOn();
	const { one, two } = pair(deck);
	one.useCanvas("mine");
	two.useCanvas("yours");
	one.setInPlay(["boards/plan.html"], { place: true });
	assert.deepEqual(two.inPlay, []);
	cleanup();
});

test("an agent nobody has given work to is on no canvas until it shows something", () => {
	const { deck, cleanup } = deckOn();
	const { one, canvases } = pair(deck);
	assert.equal(one.canvas, undefined);
	assert.deepEqual(canvases.list(), []);
	one.setInPlay(["boards/plan.html"], { place: true });
	assert.equal(canvases.list().length, 1, "showing a board makes the canvas it lands on");
	assert.equal(canvases.list()[0]?.name, "Sable", "named after the chat, which is where its work was");
	cleanup();
});

test("two chats with the same name each get a canvas of their own when they first show a board", () => {
	const { deck, cleanup } = deckOn();
	const { one, two, canvases } = pair(deck);
	one.rename("Agent");
	two.rename("Agent");
	one.setInPlay(["boards/plan.html"], { place: true });
	two.setInPlay(["boards/notes.html"], { place: true });
	assert.notEqual(one.canvas, two.canvas);
	assert.deepEqual(canvases.list().map((canvas) => canvas.name).sort(), ["Agent", "Agent 2"]);
	assert.deepEqual(one.inPlay, ["boards/plan.html"], "neither sees the other's board");
	cleanup();
});
