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

test("agents on one canvas hold what the canvas holds, taken-off boards included", () => {
	const { deck, cleanup } = deckOn();
	const { one, two } = pair(deck);
	one.useCanvas("work");
	two.useCanvas("work");
	one.setInPlay(["boards/plan.html", "boards/notes.html"], { place: true });
	one.setInPlay(["boards/plan.html"]);
	assert.deepEqual([...two.context], ["boards/plan.html", "boards/notes.html"], "one canvas, one context");
	two.useCanvas("elsewhere");
	assert.deepEqual([...two.context], [], "moving rooms is reading the new room's boards");
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
	// `Canvas 1`, and not the chat's name — the room is not the agent's, and both are renamed
	// as soon as there is something to name them after.
	assert.equal(canvases.list()[0]?.name, "Canvas 1");
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
	const names = canvases.list().map((canvas) => canvas.name);
	assert.equal(names.length, 2);
	assert.equal(new Set(names).size, 2, `two canvases, two names: ${names.join(", ")}`);
	assert.deepEqual([...names].sort(), ["Canvas 1", "Canvas 2"], names.join(", "));
	assert.deepEqual(one.inPlay, ["boards/plan.html"], "neither sees the other's board");
	cleanup();
});

/*
 * Membership, which is what the pill's "here" section and a canvas card's faces are drawn
 * from. An agent joins a room by working in it and does not leave it by going next door:
 * there is no agent address any more, so "which canvas is Sable on" has to be allowed more
 * than one answer.
 */
test("an agent is on every canvas it has worked on, and the current one is the last it joined", () => {
	const { deck, cleanup } = deckOn();
	const { one } = pair(deck);
	assert.deepEqual(one.canvasIds, [], "nothing worked on, no rooms");
	one.useCanvas("political-llm");
	one.setInPlay(["boards/plan.html"], { place: true });
	one.useCanvas("decks");
	one.setInPlay(["boards/notes.html"], { place: true });

	assert.equal(one.canvasIds.length, 2, "both rooms");
	assert.equal(one.canvas, one.canvasIds[1], "the current one is where the next board lands");
	assert.deepEqual(one.inPlay, ["boards/notes.html"], "and only that one's boards are its in-play set");
	cleanup();
});

test("a canvas that is deleted drops out of the rooms an agent is in", () => {
	const { deck, cleanup } = deckOn();
	const { one, canvases } = pair(deck);
	one.useCanvas("first");
	const first = one.canvas as string;
	one.useCanvas("second");
	assert.deepEqual(one.canvasIds.length, 2);
	canvases.remove(first);
	assert.deepEqual(
		one.canvasIds.map((id) => canvases.get(id)?.name),
		["second"],
	);
	cleanup();
});

/*
 * A workspace is the agent's own, and a canvas belongs to one.
 *
 * The cases that would show as a wrong heading: an agent moving into a project and not
 * landing in its room, a join adopting a project the agent never named, and a project's
 * first room being made twice.
 */
test("declaring a workspace moves the agent into the project's first canvas, made and named after it when there is none", () => {
	const { deck, cleanup } = deckOn();
	const { one, canvases } = pair(deck);
	assert.equal(one.setWorkspace("Political LLM"), "political-llm", "slugged, and the slug is what comes back");
	assert.equal(one.workspace, "political-llm");
	const room = canvases.get(one.canvas);
	assert.equal(room?.workspace, "political-llm", "the room is filed under the project");
	assert.equal(room?.name, "political-llm", "the first room of a project is named after it");
	// A second agent moving in lands in the same room, not a second one.
	const { two } = pair(deck);
	two.setWorkspace("political-llm");
	assert.equal(two.canvas, one.canvas, "the project's first canvas, not a new one");
	cleanup();
});

test("a canvas an agent joins by name is made in its workspace, and visiting a room does not move house", () => {
	const { deck, cleanup } = deckOn();
	const { one, two, canvases } = pair(deck);
	one.setWorkspace("decks");
	one.useCanvas("Camera");
	assert.equal(canvases.get(one.canvas)?.workspace, "decks", "made in the agent's own project");
	assert.equal(one.workspace, "decks");
	// Two, in another project, visits the same room and stays in its own project.
	two.setWorkspace("political-llm");
	two.useCanvas("Camera");
	assert.equal(two.canvas, one.canvas, "one room by that name in the deck");
	assert.equal(two.workspace, "political-llm", "visiting is not moving house");
	cleanup();
});

test("an agent in no workspace adopts the project of the room it steps into", () => {
	const { deck, cleanup } = deckOn();
	const { one, two } = pair(deck);
	one.setWorkspace("decks");
	one.useCanvas("Camera");
	two.useCanvas("Camera");
	assert.equal(two.workspace, "decks");
	cleanup();
});

/*
 * Where an agent is working now travels with it, because it is where pressing the agent goes:
 * its row in the Agents tab and its face in the toolbar both land on this canvas. Moving with
 * `stage.canvas(name)` is heard on the wire at once, not on the next list.
 */
test("the chat row and context.changed name the canvas an agent is working on now", () => {
	const { deck, cleanup } = deckOn();
	const canvases = new CanvasStore(deck.path);
	const heard: Array<{ type: string; canvas?: string }> = [];
	const agent = new DeckAgent(
		deck,
		(message) => heard.push(message as { type: string; canvas?: string }),
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
		},
		{ name: "Sable", color: "#3b5cf6", kind: "pi", snapshots: new AgentStateStore(), store: new AgentStore(deck), canvases },
	);
	assert.equal(agent.chat().canvas, undefined, "on no canvas until it has one");

	agent.useCanvas("political-llm");
	const first = agent.canvas as string;
	assert.equal(agent.chat().canvas, first);
	assert.equal(heard.filter((message) => message.type === "context.changed").at(-1)?.canvas, first, "the move is said at once");

	agent.useCanvas("decks");
	assert.notEqual(agent.canvas, first);
	assert.equal(agent.chat().canvas, agent.canvas, "the row follows it to the next one");
	assert.equal(heard.filter((message) => message.type === "context.changed").at(-1)?.canvas, agent.canvas);
	cleanup();
});
