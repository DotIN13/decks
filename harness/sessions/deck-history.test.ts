// An agent's conversation from before the rewrite, read from the deck's .decks/agents/<id>/ once and
// kept as the harness's own: the runtime's fields mapped, each item made the protocol's shape, the
// log's older items archived, and the deck's copy left alone. Made-up agents, no one's words.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fromDeck } from "./deck-history.ts";
import { Sessions, Transcripts } from "./index.ts";

const made: string[] = [];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A deck holding one agent as today's Decks wrote it, and a harness home beside it. */
function deckWith(id: string, meta: Record<string, unknown>, chat: unknown[], log: unknown[]) {
	const root = mkdtempSync(join(tmpdir(), "helm-"));
	made.push(root);
	const deck = join(root, "deck");
	const folder = join(deck, ".decks", "agents", id);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "meta.json"), JSON.stringify({ id, ...meta }));
	writeFileSync(join(folder, "chat.json"), JSON.stringify(chat));
	writeFileSync(join(folder, "chat.log"), log.map((one) => JSON.stringify(one)).join("\n") + "\n{ torn");
	return { deck, home: join(root, "home"), folder };
}

const window = [
	{ id: "u2", kind: "user", text: "Make the chart wider.", at: 20, images: [] },
	{ id: "a2", kind: "assistant", text: "Done.", thinking: "Wider by 200.", at: 21, streaming: false, extra: "dropped" },
	{ id: "t2", kind: "tool", name: "Write", title: "Write chart.js", args: { path: "chart.js" }, result: "ok", at: 22, images: ["a.png", "b.png"] },
	{ id: "t3", kind: "tool", name: "Bash", title: "Bash", state: "running" },
	{ id: "n1", kind: "notice", level: "warn", text: "Context 80% full.", at: 23 },
	{ id: "bad", kind: "assistant" },
];
const log = [{ id: "u1", kind: "user", text: "Draw a chart.", at: 10 }, { id: "a1", kind: "assistant", text: "Here it is.", at: 11 }, ...window];
const meta = { kind: "claude", resumeRef: "sess-123", model: { provider: "anthropic", model: "claude-opus", thinking: "high" }, mode: "acceptEdits", account: "work", name: "Painter", usage: { contextTokens: 1, contextWindow: 2, cost: 3 } };

test("the runtime's fields are mapped and the rest of meta.json left out", () => {
	const { deck } = deckWith("a_1", meta, window, log);
	const { saved } = fromDeck(deck, "a_1", "claude")!;
	assert.deepEqual({ ...saved, items: [] }, { id: "a_1", kind: "claude", sessionRef: "sess-123", model: meta.model, mode: "acceptEdits", account: "work", items: [] });
});

test("each item takes the protocol's shape: own fields only, pictures counted, a tool done, an unreadable one dropped", () => {
	const { deck } = deckWith("a_1", meta, window, log);
	const { saved } = fromDeck(deck, "a_1", "claude")!;
	assert.deepEqual(saved.items, [
		{ kind: "user", id: "u2", text: "Make the chart wider.", at: 20 },
		{ kind: "assistant", id: "a2", text: "Done.", at: 21, thinking: "Wider by 200." },
		{ kind: "tool", id: "t2", name: "Write", title: "Write chart.js", args: { path: "chart.js" }, result: "ok", images: 2, state: "done" },
		{ kind: "tool", id: "t3", name: "Bash", title: "Bash", state: "done" },
		{ kind: "notice", id: "n1", level: "warn", text: "Context 80% full.", at: 23 },
	]);
});

test("the log's items not in the window are the archive, oldest first, and a torn line is skipped", () => {
	const { deck } = deckWith("a_1", meta, window, log);
	assert.deepEqual(fromDeck(deck, "a_1", "claude")!.archive.map((one) => one.id), ["u1", "a1"]);
});

test("an agent of another kind than the record's, or none in the deck, reads as nothing", () => {
	const { deck } = deckWith("a_1", meta, window, log);
	assert.equal(fromDeck(deck, "a_1", "pi"), undefined);
	assert.equal(fromDeck(deck, "a_2", "claude"), undefined);
});

test("adopting the agent writes the harness's file and archive once; the deck's copy stays and is not read again", () => {
	const { deck, home, folder } = deckWith("a_1", { ...meta, kind: "pi" }, window, log);
	const transcripts = new Transcripts(home);
	const sessions = new Sessions({ url: "http://127.0.0.1:1", deckPath: deck, transcripts, host: { tell: () => {}, call: async () => ({}) } });
	sessions.start({ id: "a_1", name: "Painter", kind: "pi" });
	assert.equal(transcripts.read("a_1")?.sessionRef, "sess-123");
	assert.deepEqual(transcripts.archived("a_1").map((one) => one.id), ["u1", "a1"]);
	assert.ok(readFileSync(join(folder, "chat.json"), "utf8").includes("Make the chart wider."), "the deck's copy is left alone");
	sessions.dispose();
	writeFileSync(join(folder, "meta.json"), JSON.stringify({ id: "a_1", ...meta, kind: "pi", resumeRef: "changed" }));
	const again = new Sessions({ url: "http://127.0.0.1:1", deckPath: deck, transcripts, host: { tell: () => {}, call: async () => ({}) } });
	again.start({ id: "a_1", name: "Painter", kind: "pi" });
	assert.equal(transcripts.read("a_1")?.sessionRef, "sess-123", "the harness's own file wins once written");
	assert.deepEqual(transcripts.archived("a_1").map((one) => one.id), ["u1", "a1"], "archived once, not twice");
	again.dispose();
});

// Warden's fixture of today's deck (tools/fixtures/old-deck), read where it is: fromDeck only reads.
const OLD_DECK = fileURLToPath(new URL("../../tools/fixtures/old-deck", import.meta.url));
const ADA = "0f3c1a2e-0000-4000-8000-000000000001";
const BO = "0f3c1a2e-0000-4000-8000-000000000002";
const ADA_ANTIGRAVITY = "0f3c1a2e-0000-4000-8000-000000000003";

test("old-deck: each of the three agents reads whole, of its own kind, with every item kept", () => {
	const ada = fromDeck(OLD_DECK, ADA, "claude")!;
	assert.equal(ada.saved.sessionRef, "11111111-aaaa-4bbb-8ccc-000000000001");
	assert.deepEqual([ada.saved.mode, ada.saved.account, ada.saved.model?.model], ["auto", "default", "opus"]);
	assert.deepEqual(ada.saved.items.map((one) => one.kind), ["user", "assistant", "tool"]);
	assert.deepEqual(ada.archive.map((one) => one.id), [`${ADA}:n0`], "the log's one item before the window");
	const bo = fromDeck(OLD_DECK, BO, "pi")!;
	assert.deepEqual([bo.saved.sessionRef, bo.saved.mode, bo.saved.items.length, bo.archive.length], ["/sessions/pi-0002.jsonl", "manual", 3, 0]);
	const other = fromDeck(OLD_DECK, ADA_ANTIGRAVITY, "antigravity")!;
	assert.equal(other.saved.sessionRef, undefined, "no session to resume yet");
	assert.equal(other.saved.mode, undefined, "a mode of null is left out");
	assert.equal(other.saved.items.length, 3);
});

test("old-deck: an agent asked for as another kind, and models.json, read as nothing", () => {
	assert.equal(fromDeck(OLD_DECK, ADA, "antigravity"), undefined);
	assert.equal(fromDeck(OLD_DECK, "models.json", "claude"), undefined);
});
