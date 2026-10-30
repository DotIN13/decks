import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatItem, MessagePart, ServerMessage } from "@decks/protocol";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { cleanParts } from "./message-parts.ts";
import { Translator } from "./translator.ts";

/*
 * A message is kept with its parts (`MessagePart`): its words and its pills as data, beside the text the
 * agent gets. They come back in the history, after a restart too, and never change what the agent reads.
 */

const parts: MessagePart[] = [
	{ type: "text", text: "Keep " },
	{ type: "mention", kind: "comment", id: "c2", name: "SDK redesign decisions", from: "canvas", label: "“SDK; each”", quote: "SDK; each", note: "test note", path: "canvases/md/cards/sdk/index.html", exact: "1. canvases/md/cards/sdk/index.html\n   > SDK; each\n   test note" },
	{ type: "text", text: " and move " },
	{ type: "mention", kind: "item", id: "rect-9", name: "a square", from: "you", path: "canvases/md", exact: "@item:rect-9" },
];
const text = "A comment on a board. The quoted words are what I selected:\n\n1. canvases/md/cards/sdk/index.html\n   > SDK; each\n   test note\n\nKeep [comment 1] and move @item:rect-9";

test("parts from a browser are kept as `MessagePart`s, anything else dropped", () => {
	assert.deepEqual(cleanParts(parts), parts);
	assert.equal(cleanParts("no"), undefined);
	assert.equal(cleanParts([{ type: "text", text: "only words" }]), undefined, "no pill: the text is the message");
	const cleaned = cleanParts([
		{ type: "mention", kind: "board", id: "boards/a.html", from: "someone", extra: 1, label: 5 },
		{ type: "mention", kind: "script", id: "x" },
		{ type: "mention", kind: "file", name: "no id" },
		null,
		{ type: "text", text: "x".repeat(30_000) },
	])!;
	assert.deepEqual(cleaned[0], { type: "mention", kind: "board", id: "boards/a.html", name: "boards/a.html", from: "you" });
	assert.equal(cleaned.length, 2);
	assert.equal((cleaned[1] as { text: string }).text.length, 20_000);
});

test("a user message keeps its parts in the history and when the transcript is loaded again", () => {
	const sent: ServerMessage[] = [];
	const t = new Translator("A", (message) => sent.push(message));
	t.user(text, parts);
	t.user("plain");
	const [withParts, plain] = t.history() as Array<Extract<ChatItem, { kind: "user" }>>;
	assert.equal(withParts!.text, text, "the text is as the agent got it");
	assert.deepEqual(withParts!.parts, parts);
	assert.equal("parts" in plain!, false);
	const again = new Translator("A", () => {});
	again.load(JSON.parse(JSON.stringify(t.history())));
	assert.deepEqual((again.history()[0] as Extract<ChatItem, { kind: "user" }>).parts, parts);
});

test("a queued message keeps its parts until it is sent, and the queue row shows only its text", () => {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-parts-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	try {
		const agent = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		const prompted: Array<[string, MessagePart[] | undefined]> = [];
		(agent as unknown as { prompt: (t: string, p?: MessagePart[]) => Promise<void> }).prompt = async (t, p) => void prompted.push([t, p]);
		agent.queueMine(text, parts);
		assert.deepEqual(prompted, [[text, parts]], "idle: sent at once, with its parts");
		(agent as unknown as { translator: Translator }).translator.setState("thinking");
		agent.queueMine("again", parts);
		assert.deepEqual(Object.keys(agent.queuedMine().items[0]!), ["id", "text"]);
		agent.sendMineNow(agent.queuedMine().items[0]!.id);
		assert.deepEqual(prompted[1], ["again", parts]);
	} finally {
		app.dispose();
		rmSync(dataDir, { recursive: true, force: true });
	}
});
