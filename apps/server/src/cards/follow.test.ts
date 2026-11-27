import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { DeckState, ServerMessage } from "@decks/protocol";
import { Deck } from "../deck/loader.ts";
import { realPathOf } from "../deck/roots.ts";
import { followDeck, type FollowHost } from "./follow.ts";
import type { CardService } from "./service.ts";

const CARD = "canvases/plan/cards/first/index.html";

function put(file: string, data: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
}

const card = (words: string) => `<title>First</title><meta name="card" content='{"w":600}' /><div class="doc" data-id="doc"><h1>${words}</h1></div>`;

/** A deck with one card, followed: what was said to the pages, and which cards landed. Real events, so real time. */
async function following() {
	const root = realPathOf(mkdtempSync(join(tmpdir(), "decks-follow-")));
	put(join(root, CARD), card("one"));
	mkdirSync(join(root, "assets"), { recursive: true });
	const deck = Deck.open(root);
	const said: ServerMessage[] = [];
	const landed: string[] = [];
	const host: FollowHost = {
		deck: () => deck,
		cards: { recordRevision() {}, forgetCard() {}, restamp() {} } as unknown as CardService,
		send: (message) => void said.push(message),
		state: () => ({}) as DeckState,
		placed: (page) => page,
		landed: (path) => void landed.push(path),
		gone() {},
	};
	const stop = followDeck(host);
	// The watch is live a moment after it is asked for (`deck/watcher.test.ts`): a probe is written until it is heard.
	const deadline = Date.now() + 10_000;
	for (let n = 0; Date.now() < deadline && said.length === 0; n++) {
		// A file of its own each time: one written again inside the watcher's quiet time is not reported until it rests.
		put(join(root, "assets", `probe-${n}.txt`), String(n));
		await new Promise((resolve) => setTimeout(resolve, 60));
	}
	await new Promise((resolve) => setTimeout(resolve, 1300));
	said.length = 0;
	return { root, deck, said, landed, stop: () => (stop(), rmSync(root, { recursive: true, force: true })) };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a burst of the deck's other files changing is said to the pages once, not once for each file", async () => {
	const { root, said, stop } = await following();
	try {
		for (let n = 0; n < 60; n++) put(join(root, "assets", `frame-${n}.txt`), `frame ${n}`);
		await wait(1500);
		const whole = said.filter((message) => message.type === "deck.changed");
		assert.equal(whole.length, 1, `said ${whole.length} times for 60 files`);
	} finally {
		stop();
	}
});

test("a card that is named by the watcher and has not changed is not read again or said; one that changed is", async () => {
	const { root, said, landed, stop } = await following();
	try {
		// Named, with nothing about it different (a hidden file beside it is not the card's): as every card is when the deck's folder is cloned.
		const file = join(root, CARD);
		put(join(dirname(file), ".scratch"), "not the card's");
		await wait(700);
		assert.deepEqual(said.filter((message) => message.type === "card.changed"), []);
		assert.deepEqual(landed, []);

		put(file, card("one, then two"));
		const deadline = Date.now() + 4000;
		while (Date.now() < deadline && !said.some((message) => message.type === "card.changed")) await wait(40);
		const changed = said.filter((message) => message.type === "card.changed") as Array<Extract<ServerMessage, { type: "card.changed" }>>;
		assert.equal(changed.length >= 1, true, "the change was said");
		assert.equal(changed[0]!.path, CARD);
		assert.deepEqual([...new Set(landed)], [CARD]);
	} finally {
		stop();
	}
});
