import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncProgress } from "@decks/sync-client";
import { startStudio, syncWords } from "./index.ts";

const base: SyncProgress = { state: "syncing", canvases: { done: 3, total: 12 }, files: { done: 40, total: 120 }, bytes: { done: 312e6, total: 840e6 }, sent: 312e6, received: 0, skipped: 0, at: 0, now: { canvas: "plan", path: "files/film.mp4", up: true } };

test("decks studio status says how far the deck is in step, in one sentence", () => {
	assert.equal(syncWords(base), "Syncing: 312 MB of 840 MB, 40 of 120 files, now sending plan/files/film.mp4.");
	assert.match(syncWords({ ...base, state: "synced", now: undefined, syncedAt: Date.now(), skipped: 2 }), /^In step with Studio since \d\d:\d\d; 2 files are left out/);
	assert.equal(syncWords({ ...base, state: "offline", error: "Studio could not be reached." }), "Not syncing: Studio could not be reached.");
	assert.match(syncWords({ ...base, state: "held", heldUntil: Date.now() + 60_000 }), /^Studio asked for a wait until \d\d:\d\d: 312 MB of 840 MB done/);
	assert.equal(syncWords({ ...base, files: { done: 0, total: 0 }, canvases: { done: 0, total: 0 }, now: undefined }), "Syncing: checking what changed.");
});

test("the harness tells Studio how far it is, by its key, and Settings hears each change", async () => {
	const heard: unknown[] = [];
	const told: SyncProgress[] = [];
	const studio = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			const url = new URL(req.url ?? "/", "http://x");
			if (req.method === "PUT" && url.pathname === "/sync/v1/progress") {
				assert.equal(req.headers.authorization, "Bearer dsk_aaaaaaaaaaaaaaaaaaaaaaaa");
				told.push(JSON.parse(body));
				return res.writeHead(200).end("{}");
			}
			// Studio itself is out of reach in every other way: the sync says offline.
			res.writeHead(503, { "Content-Type": "application/json" }).end("{}");
		});
	});
	await new Promise<void>((r) => studio.listen(0, "127.0.0.1", r));
	const url = `http://127.0.0.1:${(studio.address() as AddressInfo).port}`;
	const deck = mkdtempSync(join(tmpdir(), "studio-progress-"));
	mkdirSync(join(deck, ".decks"), { recursive: true });
	writeFileSync(join(deck, ".decks", "studio.json"), JSON.stringify({ url, key: "dsk_aaaaaaaaaaaaaaaaaaaaaaaa" }));
	const link = startStudio(deck, {}, undefined, undefined, undefined, { progress: (p) => heard.push(p) });
	try {
		for (let i = 0; i < 50 && !told.some((p) => p.state === "offline"); i++) await new Promise((r) => setTimeout(r, 40));
		assert.ok(told.some((p) => p.state === "offline" && p.error === "Studio answered 503."), "Studio heard it, by the key");
		assert.ok(heard.some((p) => (p as SyncProgress | undefined)?.state === "offline"), "Settings heard it");
		assert.equal(link.status().sync?.state, "offline");
	} finally {
		await link.stop();
		studio.close();
		rmSync(deck, { recursive: true, force: true });
	}
});
