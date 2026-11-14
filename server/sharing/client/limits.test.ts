import assert from "node:assert/strict";
import { test } from "node:test";
import { serialize } from "@decks/pen";
import type { Caller } from "../../../protocol/index.ts";
import { MemoryDeck } from "../../kernel/memory-deck.ts";
import { toDeckPath } from "../../kernel/types.ts";
import { memoryStore, memoryStudio } from "../testing.ts";
import { DeckSync } from "./sync.ts";

// Studio takes so many files a second and answers the next with 429 and a
// Retry-After. Drawings and other canvases go up at once; the files wait and
// go up by themselves; a file Studio refuses is said once; a bad name is skipped.

const me: Caller = { kind: "person", id: "ada", name: "Ada" };
const LIMIT = 2;
const drawing = (id: string, content: string) => serialize({ version: "2.14", children: [{ id, type: "note", content, x: 0, y: 0 }] } as never);
const write = (deck: MemoryDeck, path: string, text: string) => deck.write(toDeckPath(path), new TextEncoder().encode(text), me);
const until = async (ok: () => boolean, ms = 6000) => {
	const end = Date.now() + ms;
	while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
	return ok();
};

test("a backlog of files waits for Retry-After and goes up by itself, while drawings go up at once", async () => {
	const window = { from: 0, taken: 0 };
	const refusals = { limited: 0, file: 0 };
	const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
	const studio = memoryStudio((req) => {
		const url = new URL(req.url);
		if (req.method !== "PUT" || !url.pathname.endsWith("/files")) return undefined;
		if (url.searchParams.get("path")?.includes("refused")) return (refusals.file++, json(403, { error: "Your space is full." }));
		if (Date.now() - window.from > 1000) Object.assign(window, { from: Date.now(), taken: 0 });
		if (window.taken >= LIMIT) return (refusals.limited++, json(429, { error: "Too many files." }, { "Retry-After": "1" }));
		window.taken++;
		return undefined;
	});
	studio.keys.set("mini", { user: { id: "ada", name: "Ada" }, harness: { id: "h-mini", name: "mini" } });
	const deck = new MemoryDeck();
	const lines: string[] = [];
	const sync = new DeckSync({ deck, store: memoryStore(), url: studio.url, key: "mini", transport: studio.transport, log: (l) => lines.push(l) });
	for (const n of [1, 2, 3, 4, 5]) await write(deck, `canvases/plan/files/f${n}.txt`, `file ${n}`);
	await write(deck, "canvases/plan/files/refused.txt", "too big");
	await write(deck, "canvases/plan/canvas.pen", drawing("n1", "the plan"));
	await write(deck, "canvases/later/canvas.pen", drawing("n2", "later"));
	await write(deck, "canvases/has space/canvas.pen", drawing("n3", "not taken"));

	await sync.sync();
	const canvases = () => studio.hub.canvases("ada");
	assert.deepEqual(canvases().map((c) => c.name).sort(), ["later", "plan"]);
	const plan = canvases().find((c) => c.name === "plan")!;
	assert.equal(studio.hub.canvas(plan.id)!.pen.children?.length, 1, "the drawing went up with files waiting");
	const files = () => studio.hub.canvasFiles(plan.id).length;
	assert.equal(files(), LIMIT);
	assert.equal(refusals.limited, 1, "one 429, then no asks until the wait is over");
	assert.ok(lines.some((l) => /no more files for 1 s/.test(l)), lines.join("\n"));
	assert.ok(lines.some((l) => /did not upload canvas has space/.test(l)));

	assert.ok(await until(() => files() === 5), `all five files up by themselves (${files()})`);
	assert.ok(refusals.limited <= 3, `a 429 a wait at most (${refusals.limited})`);
	assert.ok(await until(() => refusals.file === 1));
	await write(deck, "canvases/later/canvas.pen", drawing("n2", "edited"));
	await sync.sync();
	const later = canvases().find((c) => c.name === "later")!;
	assert.equal((studio.hub.canvas(later.id)!.pen.children?.[0] as { content?: string }).content, "edited");
	assert.equal(refusals.file, 1, "the refused bytes are not sent again");
	assert.equal(lines.filter((l) => /did not upload files\/refused.txt/.test(l)).length, 1);
	assert.equal(lines.filter((l) => /did not upload canvas has space/.test(l)).length, 1);
	await sync.stop();
});
