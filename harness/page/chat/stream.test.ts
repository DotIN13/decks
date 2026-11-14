import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientFor, host, type Heard, type Host } from "@decks-next/sdk";
import type { ChatItem } from "@decks-next/protocol";
import { askFullResult, fullResult, receiveToolResult, setToolResultSender } from "./tool/actions.ts";
import { turnCards } from "./turn/model.ts";

// Chat rules 1, 2 and 4 through the real server: a host streams chat.added, the page's
// line hears it, and the column's models fold it into one card per speaker with the tool
// call in it; opening the call asks chat.get once and holds the whole result.

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRATCH = join(ROOT, ".scratch/Scribe/stream-test");
let server: ChildProcess | undefined;
let lock: { url: string; token: string };

before(async () => {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(SCRATCH, { recursive: true });
	const deck = join(SCRATCH, "deck");
	cpSync(join(ROOT, "tools/fixtures/deck"), deck, { recursive: true });
	server = spawn(process.execPath, ["--import", "tsx", join(ROOT, "server/main.ts"), "--deck", deck, "--port", "4691"], { cwd: ROOT, stdio: "ignore" });
	const file = join(deck, ".decks/server.json");
	for (let i = 0; i < 150 && !existsSync(file); i++) await new Promise((done) => setTimeout(done, 100));
	lock = JSON.parse(readFileSync(file, "utf8"));
});

after(() => {
	server?.kill("SIGTERM");
	rmSync(SCRATCH, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const user: ChatItem = { kind: "user", id: "u1", text: "Draw the plan", at: 1, entryId: "e1" };
const reply: ChatItem = { kind: "assistant", id: "r1", text: "", at: 2, streaming: true };
const tool: ChatItem = { kind: "tool", id: "t1", name: "decks", title: "canvas insert", state: "done", result: "inserted…", full: 5000 };

/** The page's fold, as small as it can be: an item replaces its id or is added; a delta grows the text. */
function fold(items: ChatItem[], event: Heard): ChatItem[] {
	const payload = event.payload as { ids?: string[]; item?: ChatItem; delta?: string };
	if (payload.item) return items.some((one) => one.id === payload.item!.id) ? items.map((one) => (one.id === payload.item!.id ? payload.item! : one)) : [...items, payload.item];
	const entry = payload.ids?.[1];
	return items.map((one) => (one.id === entry && one.kind === "assistant" ? { ...one, text: one.text + (payload.delta ?? "") } : one));
}

test("a streamed conversation folds into a card per speaker, and a tool call opens once", async () => {
	const asked: string[] = [];
	const harness: Host = await host({
		url: lock.url,
		token: lock.token,
		answers: {
			"chat.get": (args) => (asked.push(String(args.item)), { ...tool, result: "x".repeat(5000) }),
			"chat.preview": (args) => ({ entry: args.entry, cards: { "cards/plan/index.html": "3" } }),
		},
	});
	const page = clientFor(lock.url, lock.token);
	let items: ChatItem[] = [];
	const stream = page.events((event) => (items = fold(items, event)), { events: ["chat.added"] });
	try {
		await wait(300);
		let rev = 0;
		const tell = (entry: string, rest: Record<string, unknown>) => harness.tell("chat.added", { ids: ["a1", entry], by: "a1", rev: ++rev, ...rest });
		for (const item of [user, reply]) tell(item.id, { item });
		for (const delta of ["I drew ", "the plan."]) tell("r1", { delta, field: "text" });
		tell("t1", { item: tool });
		for (let i = 0; i < 50 && items.length < 3; i++) await wait(50);
		assert.deepEqual(items.map((one) => one.id), ["u1", "r1", "t1"]);
		assert.equal((items[1] as Extract<ChatItem, { kind: "assistant" }>).text, "I drew the plan.", "the deltas grew the reply in place");
		assert.deepEqual(turnCards(items).map((card) => card.kind), ["mine", "agent"]);
		setToolResultSender((item) => (void page.decks.chat.get({ agent: "a1", item }).then((got) => receiveToolResult(item, String((got as { result?: string }).result ?? ""))), true));
		askFullResult("t1");
		askFullResult("t1");
		for (let i = 0; i < 50 && !fullResult("t1"); i++) await wait(50);
		assert.deepEqual(asked, ["t1"], "opened twice, asked once");
		assert.equal(fullResult("t1")?.length, 5000);
		const then = await page.decks.chat.preview({ agent: "a1", entry: "e1" });
		assert.deepEqual(then, { entry: "e1", cards: { "cards/plan/index.html": "3" } }, "each card as the version it was at");
	} finally {
		stream.stop();
		harness.close();
	}
});
