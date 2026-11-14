import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Refused } from "../../protocol/index.ts";
import { clientFor, connect, DecksError, type Heard } from "./index.ts";
import { fakeServer } from "./testing/fake-server.ts";

// The client makes typed calls, throws refusals with code, sentence and hint,
// hears events, and finds a server by the environment or the lock file.

const item = { type: "note", id: "n1", box: { x1: 0, y1: 0, x2: 10, y2: 10 } };
const handlers = {
	"item.move": (args: Record<string, unknown>) => ({ ...item, id: args.id }),
	"deck.now": () => ({ iso: "2026-11-14T14:00:00-08:00", timezone: "America/Los_Angeles", words: "now", epoch: 1 }),
	"item.get": () => {
		throw new Refused("not_found", "No item called zz.", "item.list");
	},
};

test("a typed call answers the value, and its notes reach notes()", async () => {
	const fake = await fakeServer(4601, handlers);
	try {
		const notes: string[] = [];
		const { decks } = clientFor(fake.url, fake.token, (note) => notes.push(note));
		const moved = await decks.item.move({ id: "n1", at: { x: 5, y: 5 } });
		assert.equal(moved.id, "n1");
		assert.equal((await decks.deck.now()).timezone, "America/Los_Angeles");
		assert.deepEqual(notes, ["item.move answered by the fake server.", "deck.now answered by the fake server."]);
		assert.deepEqual(fake.calls[0], { name: "item.move", args: { id: "n1", at: { x: 5, y: 5 } }, token: "test-token" });
		// @ts-expect-error id must be a string
		await assert.rejects(decks.item.move({ id: 5 }), { code: "invalid" });
	} finally {
		await fake.close();
	}
});

test("a refusal is a DecksError with its code, sentence and hint", async () => {
	const fake = await fakeServer(4602, handlers);
	try {
		const { decks, call } = clientFor(fake.url, fake.token);
		const refused = await decks.item.get({ id: "zz" }).catch((e: unknown) => e);
		assert.ok(refused instanceof DecksError);
		assert.deepEqual([refused.code, refused.message, refused.hint], ["not_found", "No item called zz.", "item.list"]);
		await assert.rejects(call("item.list"), { code: "unavailable" });
		await assert.rejects(clientFor(fake.url, "wrong").call("deck.now"), { code: "refused" });
		await assert.rejects(clientFor("http://127.0.0.1:4609", "t").call("deck.now"), { code: "unavailable" });
	} finally {
		await fake.close();
	}
});

test("events arrive over the socket until stop()", async () => {
	const fake = await fakeServer(4603);
	try {
		const heard: Heard[] = [];
		const stream = clientFor(fake.url, fake.token).events((event) => heard.push(event));
		await new Promise((resolve) => setTimeout(resolve, 150));
		fake.emit("item.changed", { canvas: "plan", ids: ["n1"], by: "ann", rev: 2 });
		await new Promise((resolve) => setTimeout(resolve, 100));
		stream.stop();
		await stream.done;
		assert.deepEqual(heard, [{ name: "item.changed", payload: { canvas: "plan", ids: ["n1"], by: "ann", rev: 2 } }]);
	} finally {
		await fake.close();
	}
});

test("connect finds the server and token in the deck's lock file, and DECKS_URL wins", async () => {
	const deck = mkdtempSync(`${tmpdir()}/decks-lock-`);
	const saved = { url: process.env.DECKS_URL, deck: process.env.DECKS_DECK, token: process.env.DECKS_TOKEN, home: process.env.DECKS_HOME };
	try {
		mkdirSync(`${deck}/.decks`);
		writeFileSync(`${deck}/.decks/server.json`, JSON.stringify({ url: "http://127.0.0.1:4604/", pid: 1, protocol: "0.3.0", started: 1, token: "lock-token" }));
		delete process.env.DECKS_URL;
		delete process.env.DECKS_TOKEN;
		process.env.DECKS_DECK = deck;
		process.env.DECKS_HOME = deck;
		const found = await connect();
		assert.deepEqual([found.url, found.token], ["http://127.0.0.1:4604", "lock-token"]);
		process.env.DECKS_URL = "http://127.0.0.1:4605";
		const other = await connect();
		assert.deepEqual([other.url, other.token], ["http://127.0.0.1:4605", undefined]);
	} finally {
		for (const [key, value] of Object.entries({ DECKS_URL: saved.url, DECKS_DECK: saved.deck, DECKS_TOKEN: saved.token, DECKS_HOME: saved.home })) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(deck, { recursive: true });
	}
});
