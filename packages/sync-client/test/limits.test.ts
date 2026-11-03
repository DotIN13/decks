import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serialize } from "@decks/pen";
import { Live, MemoryStore, syncHandler, type Who } from "@decks/hub";
import { nodeHandler } from "@decks/hub/node";
import { HarnessSync } from "../src/index.ts";

/*
 * Studio takes so many files a minute from a harness (Studio's `uploadsPerMinute`) and answers the
 * next with 429 and a Retry-After. A harness with more to send than that keeps syncing what it can:
 * every canvas's drawing goes up whatever the files' backlog, files wait for the Retry-After and go
 * up on their own once it is over, a file Studio refuses for itself is skipped and said once, and a
 * canvas whose name Studio refuses never stops the rest.
 */
let root = "";
let url = "";
let server: Server;
const store = new MemoryStore();
const live = new Live(store);
const keys = new Map<string, Who>([["mini", { user: { id: "ada", name: "Ada Lovelace" }, harness: { id: "h-mini", name: "mini" } }]]);
/** Two files a second, as Studio's limit is so many a minute. */
const LIMIT = 2;
let window = { from: 0, taken: 0 };
const refusals = { limited: 0, file: 0 };

before(async () => {
	root = mkdtempSync(join(tmpdir(), "sync-limits-"));
	store.name("ada", "Ada Lovelace");
	const handle = nodeHandler(syncHandler({ store, live, who: (req) => keys.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "") }));
	server = createServer(async (req, res) => {
		const at = new URL(req.url ?? "/", "http://studio");
		if (req.method === "PUT" && /\/files$/.test(at.pathname)) {
			if (at.searchParams.get("path")?.includes("refused")) {
				refusals.file++;
				return void res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Your space is full." }));
			}
			if (Date.now() - window.from > 1000) window = { from: Date.now(), taken: 0 };
			if (window.taken >= LIMIT) {
				refusals.limited++;
				return void res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" }).end(JSON.stringify({ error: "Too many files a minute. Wait 1 s and try again." }));
			}
			window.taken++;
		}
		if (!(await handle(req, res))) res.writeHead(404).end();
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
	server.closeAllConnections();
	server.close();
	rmSync(root, { recursive: true, force: true });
});

const write = (path: string, text: string) => {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
};
const drawing = (id: string, content: string) => serialize({ version: "2.14", children: [{ id, type: "note", content, x: 0, y: 0 }] } as never);
const until = async (test: () => boolean, ms = 8000) => {
	const end = Date.now() + ms;
	while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
	return test();
};

test("a backlog of files waits for Studio's Retry-After and goes up by itself, while every drawing and the other canvases go up at once", async () => {
	const deck = join(root, "mini");
	const lines: string[] = [];
	const sync = new HarnessSync({ deck, studio: url, key: "mini", log: (line) => lines.push(line) });
	for (const n of [1, 2, 3, 4, 5]) write(join(deck, "canvases", "plan", "files", `f${n}.txt`), `file ${n}`);
	write(join(deck, "canvases", "plan", "files", "refused.txt"), "too big for the space left");
	write(join(deck, "canvases", "plan", "canvas.pen"), drawing("n1", "the plan"));
	write(join(deck, "canvases", "later", "canvas.pen"), drawing("n2", "a later canvas"));
	// A name Studio refuses: a space in it.
	write(join(deck, "canvases", "has space", "canvas.pen"), drawing("n3", "not taken"));

	await sync.sync();
	const canvases = () => store.canvases("ada");
	assert.deepEqual(canvases().map((c) => c.name).sort(), ["later", "plan"], "both canvases up, the refused name skipped");
	const plan = canvases().find((c) => c.name === "plan")!;
	assert.equal(store.canvas(plan.id)!.pen.children?.length, 1, "the drawing went up with the files waiting");
	const files = () => store.canvasFiles(plan.id).filter((f) => f.path.startsWith("files/")).length;
	assert.equal(files(), LIMIT, "as many files as Studio took");
	assert.equal(refusals.limited, 1, "one 429, then no more asks until the wait is over");
	assert.ok(lines.some((l) => /asked for no more files for 1 s/.test(l)), lines.join("\n"));
	assert.ok(lines.some((l) => /did not upload canvas has space/.test(l)));

	// No pass is called: the harness sends the rest when the wait is over, without another refusal for each file.
	assert.ok(await until(() => files() === 5), `all five files up by themselves (${files()})`);
	assert.ok(refusals.limited <= 3, `a 429 a wait at most (${refusals.limited})`);
	assert.equal(refusals.file, 1, "the refused file asked once");
	assert.equal(lines.filter((l) => /did not upload files\/refused.txt/.test(l)).length, 1);

	// An edit meanwhile goes up on the next pass however many files wait.
	write(join(deck, "canvases", "later", "canvas.pen"), drawing("n2", "edited"));
	await sync.sync();
	const later = canvases().find((c) => c.name === "later")!;
	assert.equal((store.canvas(later.id)!.pen.children?.[0] as { content?: string }).content, "edited");
	assert.equal(refusals.file, 1, "the same refused bytes are not sent again");
	assert.equal(lines.filter((l) => /did not upload canvas has space/.test(l)).length, 1, "the refused canvas said once");
	await sync.stop();
});
