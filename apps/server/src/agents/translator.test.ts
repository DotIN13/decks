import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage } from "@decks/protocol";
import { Translator, titleFor } from "./translator.ts";

/*
 * What a tool row says it was called on.
 *
 * The conversation draws a call as one line — a glyph, the name in mono, and this string —
 * so an empty return here is a row with a name and nothing else, which is the state the app
 * spent a while in for its own `stage_eval`.
 */

test("a file tool is its path, and a shell tool is its command", () => {
	assert.equal(titleFor("read", { path: "apps/web/src/App.tsx" }), "apps/web/src/App.tsx");
	assert.equal(titleFor("edit", { file: "docs/DESIGN.md" }), "docs/DESIGN.md");
	assert.equal(titleFor("bash", { command: "npm test" }), "npm test");
});

test("an MCP prefix is routing, not the tool's name", () => {
	// `mcp__decks__stage_eval` used to fall through to the default, which looks for a short
	// string argument and finds none in a program — so the row was blank.
	assert.equal(
		titleFor("mcp__decks__stage_eval", { code: 'await stage.show("boards/plan.html");\nreturn 1;' }),
		'await stage.show("boards/plan.html");',
	);
	assert.equal(titleFor("mcp__some_server__read", { path: "a.txt" }), "a.txt");
	// A name that merely contains the separator is not a prefix.
	assert.equal(titleFor("read__twice", { path: "a.txt" }), "a.txt", "the default still finds a short string");
});

test("a long argument is cut where a row would cut it anyway", () => {
	const long = `git log ${"--pretty=%h ".repeat(20)}`;
	const title = titleFor("bash", { command: long });
	assert.ok(title.length <= 72, `${title.length} characters`);
	assert.ok(title.endsWith("…"), title);
});

test("nothing to say is an empty string, not a guess", () => {
	assert.equal(titleFor("read", {}), "");
	assert.equal(titleFor("whatever", undefined), "");
	assert.equal(titleFor("whatever", { flag: true, count: 3 }), "", "only strings are ever a title");
});

test("whitespace in an argument is flattened, because a row is one line", () => {
	// Every run of it, including the two spaces `grep` joins its two halves with: a row is
	// one line and a tab in the middle of it would be a gap nobody chose.
	assert.equal(titleFor("grep", { pattern: "  needle\n\there  ", path: "src" }), "needle here src");
});

/*
 * When a reply becomes a bubble.
 *
 * A card the browser has been told about but that has nothing in it is an empty box sitting
 * in the column: for a model that thinks first, seconds of it; for a turn that opens with a
 * tool call, the whole of that call, after which the card silently disappears again. The
 * working sign already covers that state, and it covers it better.
 */

/** A translator, and everything it sent. */
function transcript(): { t: Translator; sent: ServerMessage[]; kinds: () => string[] } {
	const sent: ServerMessage[] = [];
	const t = new Translator("A", (message) => sent.push(message));
	return {
		t,
		sent,
		// Only what is said about the *reply*: a tool call is a `chat.item` too, and this is
		// not a question about tool calls.
		kinds: () =>
			sent
				.filter((message) => (message.type === "chat.item" && message.item.kind === "assistant") || message.type === "chat.delta")
				.map((message) => message.type),
	};
}

test("a reply is not a bubble until it says something", () => {
	const { t, sent, kinds } = transcript();
	t.startAssistant();

	assert.deepEqual(kinds(), [], "nothing sent for a reply that has not spoken");
	assert.ok(
		sent.some((message) => message.type === "agent.state" && message.state === "streaming"),
		"but the state says it has started, which is what the working sign reads",
	);

	t.delta("Hello");
	assert.deepEqual(kinds(), ["chat.item"], "the first thing said arrives as the item itself");
	const first = sent.find((message) => message.type === "chat.item");
	assert.equal(first?.item.kind === "assistant" && first.item.text, "Hello", "carrying that text, so it is not sent twice");

	t.delta(" again");
	assert.deepEqual(kinds(), ["chat.item", "chat.delta"], "and everything after it as an increment");
});

test("a turn that only calls tools sends no bubble at all", () => {
	const { t, kinds } = transcript();
	t.startAssistant();
	t.toolStart("c1", "read", "apps/web/src/App.tsx", { path: "a" });
	t.endAssistant();

	/*
	 * Not even at the end. It used to emit a fabricated empty item here — a message whose
	 * whole content is "the card I told you about is empty now", sent to a browser that was
	 * never told about it.
	 */
	assert.deepEqual(kinds(), [], "nothing about a reply that never happened");
	assert.deepEqual(
		t.history().map((item) => item.kind),
		["tool"],
		"and the transcript a reconnecting browser gets has only the call",
	);
});

test("thinking counts as saying something, and text after it is still a delta", () => {
	const { t, sent, kinds } = transcript();
	t.startAssistant();
	t.thinking("weighing it up");
	assert.deepEqual(kinds(), ["chat.item"], "a reply that is only thinking is worth drawing");

	t.delta("Here is the answer.");
	assert.deepEqual(kinds(), ["chat.item", "chat.delta"]);
	const delta = sent.find((message) => message.type === "chat.delta");
	assert.equal(delta?.type === "chat.delta" && delta.field, "text");
});

test("a reply that did say something is still ended the way it always was", () => {
	const { t, sent } = transcript();
	t.startAssistant();
	t.delta("Done.");
	t.endAssistant();

	const items = sent.filter((message) => message.type === "chat.item");
	assert.equal(items.length, 2, "the announcement, and the final shape");
	const last = items.at(-1);
	assert.equal(last?.item.kind === "assistant" && last.item.streaming, false, "which is what takes the caret off it");
	assert.equal(last?.item.kind === "assistant" && last.item.text, "Done.");
});

/*
 * Taking back a reply that was not one.
 *
 * A Claude turn whose whole content is "another process is refreshing the login" is about to
 * be retried (`claude/transient.ts`), so leaving it in the column would give the reader two
 * error paragraphs and then the answer. The items are the display copy on disk, so this has
 * to really remove it.
 */
test("the last reply can be taken back, and only the last one", () => {
	const t = new Translator("A", () => {});
	t.user("first");
	t.startAssistant();
	t.delta("an answer");
	t.endAssistant();
	t.user("second");
	t.startAssistant();
	t.delta("another process is refreshing it");
	t.endAssistant();

	assert.equal(t.dropLastAssistant(), true);
	assert.deepEqual(
		t.history().map((item) => `${item.kind}:${"text" in item ? item.text : ""}`),
		["user:first", "assistant:an answer", "user:second"],
		"the failed reply is gone and the earlier one is not",
	);

	// And again takes the *earlier* answer — so a caller that dropped twice would be deleting
	// history rather than a failure. One call per turn is the contract, and it is the
	// backend's `retryTransient` that keeps it.
	assert.equal(t.dropLastAssistant(), true);
	assert.deepEqual(
		t.history().map((item) => item.kind),
		["user", "user"],
	);
	assert.equal(t.dropLastAssistant(), false, "and nothing to take back is not an error");
});

/*
 * The far end of the window (DESIGN §6.2).
 *
 * The transcript is capped, and what falls off used to be gone for good — so a
 * conversation of a thousand messages could only ever be scrolled back through five
 * hundred of them. The rows now leave through `onEvict`, which is what `agents/store.ts`
 * appends to its log, and the two properties that matter are that **every** evicted row is
 * handed over and that each is handed over **once**: a row delivered twice is drawn twice
 * when the reader scrolls back, and one missed is a hole in the middle of a conversation.
 */

test("rows that fall out of the window are handed over, in order and exactly once", () => {
	const evicted: string[] = [];
	const translator = new Translator(
		"a1",
		() => {},
		undefined,
		undefined,
		(items) => evicted.push(...items.map((item) => item.id)),
	);

	// 500 is the window, so the first 500 stay and the next 60 push that many out.
	for (let i = 0; i < 560; i++) translator.user(`message ${i}`);

	assert.equal(translator.history().length, 500, "the window is still a window");
	assert.equal(evicted.length, 60);
	assert.equal(new Set(evicted).size, 60, "no row was handed over twice");
	// The oldest went first, and what was evicted is exactly what the window no longer has.
	const held = new Set(translator.history().map((item) => item.id));
	assert.equal(
		evicted.filter((id) => held.has(id)).length,
		0,
		"a row in both places would be drawn twice when the reader scrolled back",
	);
	assert.equal(evicted[0], "a1:u1", "the first thing said is the first thing archived");
	assert.equal(evicted.at(-1), "a1:u60");
});

test("a conversation inside the window evicts nothing", () => {
	let calls = 0;
	const translator = new Translator("a2", () => {}, undefined, undefined, () => calls++);
	for (let i = 0; i < 40; i++) translator.user(`message ${i}`);
	assert.equal(calls, 0, "and so a short chat writes no log and offers no scrollback");
});
