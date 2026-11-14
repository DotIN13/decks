import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";

// app.check in a real Chromium. A browser run is heavy: it runs only with
// DECKS_HEAVY=1, under node tools/heavy.mjs.

const heavy = process.env.DECKS_HEAVY === "1";

test("app.check finds a clean app clean and a throwing app's error", { skip: heavy ? false : "a browser run: set DECKS_HEAVY=1 under tools/heavy.mjs" }, async () => {
	const workdir = mkdtempSync(join(tmpdir(), "depot-check-"));
	const ann = callers.agent("ann", "work");
	const s = await testServer({ features: features({ appRun: workdir }), deck: new MemoryDeck({ "canvases/work/canvas.pen": '{"version":"2.14","children":[]}' }) });
	const door = await s.listen(0);
	await s.value("app.create", { name: "fine", title: "Fine" }, ann);
	const fine = await s.value<{ verdict: string; title?: string; words?: number; errors: string[] }>("app.check", { name: "fine" }, ann);
	assert.match(fine.verdict, /Loads clean/, JSON.stringify(fine.errors));
	assert.equal(fine.title, "Fine");
	assert.ok((fine.words ?? 0) > 2);
	await s.value("file.write", { path: "apps/throws/app.json", text: '{"kind":"static"}' }, ann);
	await s.value("file.write", { path: "apps/throws/index.html", text: "<title>T</title><p>hi there</p><script>throw new Error('boom')</script>" }, ann);
	const bad = await s.value<{ verdict: string; errors: string[] }>("app.check", { name: "throws" }, ann);
	assert.match(bad.verdict, /threw/);
	assert.ok(bad.errors.some((line) => /boom/.test(line)), bad.errors.join("\n"));
	await door.close();
	await s.close();
	rmSync(workdir, { recursive: true, force: true });
});
