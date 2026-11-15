import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientFor, host, type Host } from "@decks/sdk";
import { draftComments, draftForAgent, type Draft } from "./draft/model.ts";
import { messageParts, readParts } from "./pill/about.ts";

// Composer rule 5, through the real server: a message with a mention, a card and a comment
// is sent as chat.send with its parts, and the host that answers chat.send gets it whole.

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRATCH = join(ROOT, ".scratch/Scribe/send-test");
const PORT = "4690";
let server: ChildProcess | undefined;
let lock: { url: string; token: string };

before(async () => {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(SCRATCH, { recursive: true });
	const deck = join(SCRATCH, "deck");
	cpSync(join(ROOT, "tools/fixtures/deck"), deck, { recursive: true });
	server = spawn(process.execPath, ["--import", "tsx", join(ROOT, "server/main.ts"), "--deck", deck, "--port", PORT], { cwd: ROOT, stdio: "ignore" });
	const file = join(deck, ".decks/server.json");
	for (let i = 0; i < 150 && !existsSync(file); i++) await new Promise((done) => setTimeout(done, 100));
	lock = JSON.parse(readFileSync(file, "utf8"));
});

after(() => {
	server?.kill("SIGTERM");
	rmSync(SCRATCH, { recursive: true, force: true });
});

// The comment as a sent part says it; read back, it is the comment the composer holds.
const said = { type: "mention", kind: "comment", id: "c1", name: "Costs", from: "you", path: "canvases/plan/cards/costs/index.html", component: "total", quote: "about $4", note: "Is this per month?" } as const;
const comment = readParts([said])!.comments.get("c1")!;
const draft: Draft = [
	{ type: "text", text: "Ask " },
	{ type: "mention", kind: "card", id: "canvases/plan/cards/costs/index.html", label: "Costs" },
	{ type: "text", text: " and " },
	{ type: "mention", kind: "item", id: "note-4", label: "a note" },
	{ type: "text", text: " " },
	{ type: "mention", kind: "comment", id: "c1", label: "“about $4”" },
];

test("a message with a card, an item and a comment reaches the host whole", async () => {
	const heard: Array<Record<string, unknown>> = [];
	const harness: Host = await host({ url: lock.url, token: lock.token, answers: { "chat.send": (args) => (heard.push(args), { id: "u1", kind: "user", at: 1, text: String(args.text) }) } });
	try {
		const parts = messageParts(draft, [comment], { canvas: "canvases/plan/canvas.pen" });
		const page = clientFor(lock.url, lock.token);
		const sent = await page.decks.chat.send({ agent: "a1", text: draftForAgent(draft), parts });
		assert.equal(sent.id, "u1");
		assert.equal(heard.length, 1);
		assert.deepEqual(heard[0]!.parts, parts, "every part arrives as it was sent");
		assert.equal(heard[0]!.text, draftForAgent(draft));
		assert.deepEqual(draftComments(draft), ["c1"]);
		const kinds = (heard[0]!.parts as Array<{ kind?: string }>).map((part) => part.kind).filter(Boolean);
		assert.deepEqual(kinds, ["card", "item", "comment"]);
		const back = (heard[0]!.parts as Array<Record<string, unknown>>).find((part) => part.kind === "comment")!;
		for (const key of ["id", "path", "component", "quote", "note"] as const) assert.equal(back[key], said[key], key);
	} finally {
		harness.close();
	}
});
