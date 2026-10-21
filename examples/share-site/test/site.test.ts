import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdits, diff, parse, serialize, type PenDocument, type PenEdit } from "@decks/pen";
import { HarnessSync } from "@decks/sync-client";
import { CanvasFollower } from "@decks/hub/follower";
import { LiveEvent, type EditsAnswer } from "@decks/sync-protocol";
import WebSocket from "ws";
import { startSite } from "../src/server.ts";

/*
 * The example works end to end: two people's pages (their sync, with no browser) and Ada's harness
 * keep one canvas in step through the site. It runs in CI, so a change that breaks the public
 * packages for a site like this breaks the build.
 */
const site = await startSite({ people: { "ada-key": { id: "ada", name: "Ada" }, "bob-key": { id: "bob", name: "Bob" } }, harnesses: { "ada-mini": { person: "ada", name: "Mac mini" } } });
const root = mkdtempSync(join(tmpdir(), "share-site-"));
after(() => {
	site.close();
	rmSync(root, { recursive: true, force: true });
});

/** A page as `src/page.ts` runs it: a drawing, the follower, the live socket. */
async function page(key: string, id: string) {
	const call = async (method: string, path: string, body?: unknown) => (await fetch(site.url + path, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
	const opened = await call("GET", `/sync/v1/canvases/${id}`);
	let doc = opened.pen as PenDocument;
	const f = new CanvasFollower({ doc: () => doc, show: (d) => (doc = d), changes: (since) => call("GET", `/sync/v1/canvases/${id}/changes?since=${since}`), whole: async () => { const c = await call("GET", `/sync/v1/canvases/${id}`); return { rev: c.rev, pen: c.pen }; } }, opened.rev, `page-${key}`);
	const ws = new WebSocket(`${site.url.replace("http", "ws")}/sync/v1/live?key=${key}`);
	ws.on("message", (m) => { const e = LiveEvent.safeParse(JSON.parse(String(m))); if (e.success && e.data.type === "canvas" && e.data.id === id) f.heard(e.data); });
	await new Promise((r) => ws.once("open", r));
	return {
		doc: () => doc,
		async edit(change: (d: PenDocument) => void) {
			const next = structuredClone(doc);
			change(next);
			const edits = diff(doc, next);
			doc = applyEdits(doc, edits);
			f.answered((await call("POST", `/sync/v1/canvases/${id}/edits`, f.sending(edits as PenEdit[]))) as EditsAnswer);
		},
		settled: () => f.settled(),
		close: () => ws.close(),
	};
}
const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(ok()); };

test("two pages and a harness keep one canvas in step through the site", async () => {
	// Ada's harness has a canvas: it goes up, and is shared with Bob, as everyone edits in this example.
	const deck = join(root, "ada-mini");
	mkdirSync(join(deck, "canvases", "plan"), { recursive: true });
	writeFileSync(join(deck, "canvases", "plan", "canvas.pen"), serialize({ version: "2.14", children: [{ id: "n1", type: "note", content: "from the harness", x: 0, y: 0 }] } as never));
	const harness = new HarnessSync({ deck, studio: site.url, key: "ada-mini", log: () => {} });
	await harness.sync();
	const id = site.store.canvases("bob")[0]!.id;

	const ada = await page("ada-key", id), bob = await page("bob-key", id);
	assert.equal((bob.doc().children[0] as { content: string }).content, "from the harness");

	// Ada edits; Bob's page hears it live. Bob adds a note; Ada's page hears it.
	await ada.edit((d) => ((d.children[0] as { content: string }).content = "Ada changed it"));
	await until(() => (bob.doc().children[0] as { content: string }).content === "Ada changed it");
	await bob.edit((d) => d.children.push({ id: "n2", type: "note", content: "Bob's note", x: 0, y: 200 } as never));
	await until(() => ada.doc().children.length === 2);

	// The harness brings both into its deck folder.
	await harness.sync();
	const onDisk = parse(readFileSync(join(deck, "canvases", "plan", "canvas.pen"), "utf8"));
	assert.equal((onDisk.children[0] as { content: string }).content, "Ada changed it");
	assert.equal(onDisk.children.length, 2);
	ada.close(); bob.close();
});
