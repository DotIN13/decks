import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";
import { chromium } from "./browser.ts";
import { picturesFeature } from "./feature.ts";

// The real Chromium on the fixture deck, heavy: run with DECKS_HEAVY=1 under
// node tools/heavy.mjs --wait. Skipped otherwise.

const HEAVY = process.env.DECKS_HEAVY === "1";
const ROOT = new URL("../../tools/fixtures/deck/", import.meta.url).pathname;
const CARD = "canvases/auth-refresh/cards/risks/index.html";
const PNG = [137, 80, 78, 71];

function fixture(dir = ""): Record<string, Uint8Array> {
	const out: Record<string, Uint8Array> = {};
	for (const name of readdirSync(join(ROOT, dir))) {
		const rel = dir ? `${dir}/${name}` : name;
		if (statSync(join(ROOT, rel)).isDirectory()) Object.assign(out, fixture(rel));
		else out[rel] = readFileSync(join(ROOT, rel));
	}
	return out;
}

test("card.fit and canvas.screenshot in a real browser, on the fixture deck", { skip: HEAVY ? false : "heavy: set DECKS_HEAVY=1 and run under tools/heavy.mjs" }, async () => {
	const browser = chromium();
	const s = await testServer({ features: [...features(), picturesFeature({ browser })], deck: fixture() as never });
	const served = await s.listen();
	s.setUrl(served.url);
	const ann = callers.agent("ann", "auth-refresh");
	try {
		await s.value("item.update", { id: "risks", size: { h: 2000 } }, ann);
		const fitted = await s.call("card.fit", { card: CARD }, ann);
		assert.ok(fitted.ok, JSON.stringify(fitted));
		const box = (fitted.value as { box: { y1: number; y2: number } }).box;
		const h = box.y2 - box.y1;
		assert.ok(h > 300 && h < 1500, `the content's height, not the 2000 set before: ${h}`);
		assert.match(fitted.notes.join(" "), /This card is \d+ words.*smallest text is \d+px/);
		const shot = await s.value<{ file: string; size: { w: number; h: number } }>("canvas.screenshot", {}, ann);
		const bytes = await s.deck.read(shot.file as never);
		assert.deepEqual([...bytes.slice(0, 4)], PNG);
		assert.ok(Math.max(shot.size.w, shot.size.h) <= 1600);
		const card = await s.value<{ file: string }>("canvas.screenshot", { of: CARD, format: "jpeg", to: "exports/risks.jpg" }, ann);
		assert.deepEqual([...(await s.deck.read(card.file as never)).slice(0, 2)], [0xff, 0xd8]);
	} finally {
		await served.close();
		await s.close();
		await browser.close();
	}
});
