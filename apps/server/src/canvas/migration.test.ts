import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ServerMessage } from "@decks/protocol";
import { Registry } from "../agents/registry.ts";
import { Deck } from "../deck/loader.ts";
import type { StageService } from "../stage/service.ts";
import { CanvasStore } from "./store.ts";

/*
 * The migration as a deck actually runs it: records written by an older build, a registry
 * restoring them, and the same thing again on the next open.
 *
 * Found by running it on a copy of the live deck: six chats named "Agent" folded onto one
 * canvas, and because a dormant chat is never saved, the next open would have migrated them all
 * over again.
 */

function deckWith(records: Array<Record<string, unknown>>) {
	const root = mkdtempSync(join(tmpdir(), "decks-migration-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	for (const name of ["one.html", "two.html", "three.html"]) {
		writeFileSync(join(root, "boards", name), `<!doctype html><title>${name}</title><body class="board"></body>`);
	}
	for (const record of records) {
		const folder = join(root, ".decks", "agents", String(record.id));
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, "meta.json"), JSON.stringify({ kind: "pi", color: "#000", context: [], createdAt: 1, lastAt: 2, ...record }));
	}
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function open(root: string) {
	const deck = Deck.open(root);
	const canvases = new CanvasStore(root);
	const sent: ServerMessage[] = [];
	const registry = new Registry(deck, (message) => sent.push(message), {} as StageService, {
		port: 4329,
		defaultKind: "pi",
		canvases,
		camera: () => ({ x: 0, y: 0, zoom: 1 }),
		recordRevision: () => undefined,
		boardPathOf: () => undefined,
	});
	registry.restore();
	return { registry, canvases };
}

const OLD = [
	{ id: "a", name: "Agent", inPlay: ["boards/one.html"], positions: { "boards/one.html": { x: 1, y: 2 }, "boards/two.html": { x: 9000, y: 9000 } } },
	{ id: "b", name: "Agent", inPlay: ["boards/two.html"] },
	{ id: "c", name: "Rune", workspace: "decks", inPlay: ["boards/three.html"] },
	{ id: "d", name: "Iris", workspace: "decks", inPlay: ["boards/one.html"] },
	{ id: "e", name: "Dispatcher", role: "dispatcher", inPlay: ["boards/one.html"] },
];

test("two chats called Agent get two canvases, and the workspace's chats share one", () => {
	const { root, cleanup } = deckWith(OLD);
	const { registry, canvases } = open(root);
	assert.deepEqual(canvases.list().map((canvas) => canvas.name).sort(), ["Agent", "Agent 2", "decks"]);
	assert.notEqual(registry.get("a")?.canvas, registry.get("b")?.canvas);
	assert.equal(registry.get("c")?.canvas, registry.get("d")?.canvas);
	assert.equal(registry.get("e")?.canvas, undefined, "the dispatcher is on no canvas");
	cleanup();
});

test("the records are rewritten at once, so the next open migrates nothing", () => {
	const { root, cleanup } = deckWith(OLD);
	open(root);
	const meta = JSON.parse(readFileSync(join(root, ".decks", "agents", "a", "meta.json"), "utf8")) as Record<string, unknown>;
	assert.equal(typeof meta.canvas, "string", "the record names its canvas");
	assert.equal(meta.inPlay, undefined, "and the old fields are gone");
	assert.equal(meta.positions, undefined);
	const again = open(root);
	assert.equal(again.canvases.list().length, 3, "no Agent 3 on the second open");
	assert.equal(readdirSync(join(root, ".decks", "canvases")).length, 3);
	cleanup();
});

test("a migrated canvas carries the places of the boards on it, not the old layout's", () => {
	const { root, cleanup } = deckWith(OLD);
	const { registry, canvases } = open(root);
	assert.deepEqual(canvases.places(registry.get("a")!.canvas!), { "boards/one.html": { x: 1, y: 2 } });
	cleanup();
});
