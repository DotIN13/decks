import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";

// The fixture deck's cards, through the canvas: read as items, written back unchanged.

const ROOT = new URL("../../tools/fixtures/deck/", import.meta.url).pathname;
const CANVAS = "canvases/auth-refresh/canvas.pen";

function fixture(dir = ""): Record<string, Uint8Array> {
	const out: Record<string, Uint8Array> = {};
	for (const name of readdirSync(join(ROOT, dir))) {
		const rel = dir ? `${dir}/${name}` : name;
		if (statSync(join(ROOT, rel)).isDirectory()) Object.assign(out, fixture(rel));
		else out[rel] = readFileSync(join(ROOT, rel));
	}
	return out;
}

test("the fixture deck's five cards read as card items and their nodes survive an edit", async () => {
	const s = await testServer({ features: features(), deck: fixture() as never });
	const ann = callers.agent("ann", "auth-refresh");
	const items = await s.value<{ type: string; card: string; title: string }[]>("item.list", { canvas: "auth-refresh" }, ann);
	assert.equal(items.filter((i) => i.type === "card").length, 5);
	assert.ok(items.every((i) => /^canvases\/auth-refresh\/cards\/[^/]+\/index\.html$/.test(i.card)));
	const titles = await s.value<{ path: string; title: string }[]>("card.list", {}, ann);
	assert.equal(titles.filter((c) => c.path.startsWith("canvases/auth-refresh/")).length, 5);
	await s.value("item.insert", { item: { type: "text", content: "hello" }, at: { x: 0, y: -400 } }, ann);
	const before = JSON.parse(readFileSync(join(ROOT, CANVAS), "utf8")) as { children: unknown[] };
	const after = JSON.parse(new TextDecoder().decode(await s.deck.read(CANVAS as never))) as { children: { type: string }[] };
	for (const node of before.children) assert.ok(after.children.some((n) => isDeepEqual(n, node)), JSON.stringify(node).slice(0, 80));
	await s.close();
});

function isDeepEqual(a: unknown, b: unknown): boolean {
	try {
		assert.deepEqual(a, b);
		return true;
	} catch {
		return false;
	}
}
