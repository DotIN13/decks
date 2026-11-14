import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { upgradeDeck } from "./feature.ts";
import { memoryVersion, readRecord } from "./version.ts";

// README rules: the fixture deck (its friend's canvas still holds an old board) opens and is
// recorded at the floor; an older shape is refused naming it; migrations run once, in order.

const FIXTURE = new URL("../../tools/fixtures/deck/", import.meta.url).pathname;

function fixtureFiles(dir = FIXTURE): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) Object.assign(out, fixtureFiles(path));
		else if (!/\.(pdf|png|jpg)$/.test(name)) out[relative(FIXTURE, path)] = readFileSync(path, "utf8");
	}
	return out;
}

const text = (deck: MemoryDeck, path: string) => deck.read(path as never).then((b) => new TextDecoder().decode(b));

test("the fixture deck upgrades to the floor and keeps its friend's old board", async () => {
	const deck = new MemoryDeck(fixtureFiles());
	const file = memoryVersion();
	assert.deepEqual(await upgradeDeck(deck, file), []);
	assert.equal((await readRecord(file)).version, "0.5.1");
	assert.match(await text(deck, "shared/canvases/ada/old-notes/canvas.pen"), /decks\.board/);
	assert.deepEqual(await upgradeDeck(deck, file), [], "up to date: nothing runs");
});

test("a deck older than the floor is refused, naming what is old", async () => {
	const deck = new MemoryDeck({ "stages/a/stage.pen": "{}", "boards/x.html": "<p>x</p>" });
	await assert.rejects(upgradeDeck(deck, memoryVersion()), /stages\/.*boards at the deck's root/s);
});

test("a new deck starts at the latest; migrations after the floor run once, in order", async () => {
	const fresh = memoryVersion();
	await upgradeDeck(new MemoryDeck({}), fresh);
	assert.equal((await readRecord(fresh)).version, "0.5.1");
	const ran: string[] = [];
	const deck = new MemoryDeck({ "canvases/a/canvas.pen": "{}" });
	const file = memoryVersion('{"version":"0.5.1"}');
	const migrations = [
		{ version: "0.6.0", id: "one", run: async () => void ran.push("one") },
		{ version: "0.6.1", id: "two", run: async (_d: unknown, say: (l: string) => void) => (ran.push("two"), say("two ran")) },
	];
	assert.deepEqual(await upgradeDeck(deck, file, migrations, "0.6.1"), ["two ran"]);
	await upgradeDeck(deck, file, migrations, "0.6.1");
	assert.deepEqual(ran, ["one", "two"]);
	assert.equal((await readRecord(file)).version, "0.6.1");
});

test("a failing migration stops there, the version at the last that worked", async () => {
	const deck = new MemoryDeck({ "canvases/a/canvas.pen": "{}" });
	const file = memoryVersion('{"version":"0.5.1"}');
	const migrations = [
		{ version: "0.6.0", id: "good", run: async () => undefined },
		{ version: "0.7.0", id: "bad", run: async () => { throw new Error("no room"); } },
	];
	await assert.rejects(upgradeDeck(deck, file, migrations, "0.7.0"), /bad failed: no room.*0\.6\.0/);
	assert.equal((await readRecord(file)).version, "0.6.0");
});
