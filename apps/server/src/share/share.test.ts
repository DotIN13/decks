import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Page } from "@decks/protocol";
import { readZip } from "../../../web/src/connections/zip.ts";
import { buildBundle } from "./bundle.ts";
import { zip } from "./zip.ts";

test("a zip written here is read back by the browser's reader, stored and deflated alike", async () => {
	const text = "a card ".repeat(500);
	const random = crypto.getRandomValues(new Uint8Array(2048));
	const files = readZip(new Uint8Array(zip([{ name: "deck/pages/é.html", data: Buffer.from(text) }, { name: "pictures/x.webp", data: random }])).buffer);
	assert.deepEqual(files.map((one) => one.name), ["deck/pages/é.html", "pictures/x.webp"]);
	assert.equal(new TextDecoder().decode(await files[0]!.bytes()), text);
	assert.deepEqual(await files[1]!.bytes(), random);
});

function card(path: string, extra: Partial<Page> = {}): Page {
	return { path, title: path, x: 0, y: 0, w: 1000, h: 400, rev: 1, ...extra } as Page;
}

test("a bundle carries the canvas, its cards, what they name, lib, and pictures, and leaves out other canvases' cards", async () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-bundle-"));
	const A = "canvases/plan/cards/a/index.html";
	const B = "canvases/plan/cards/b/index.html";
	for (const dir of ["assets", "lib", "canvases/plan/cards/a", "canvases/plan/cards/b", "canvases/other/cards/o"]) mkdirSync(join(deck, dir), { recursive: true });
	writeFileSync(join(deck, "lib/card.css"), "body{}");
	writeFileSync(join(deck, "assets/chart.png"), "png");
	writeFileSync(join(deck, "assets/font.woff2"), "font");
	writeFileSync(join(deck, "assets/style.css"), "@font-face{src:url('font.woff2')}");
	writeFileSync(join(deck, A), '<link href="../../lib/card.css"><link href="../../../../assets/style.css"><img src="../../../../assets/chart.png"><a href="../b/index.html">b</a><a href="../../../other/cards/o/index.html">o</a><img src="https://x.test/y.png">');
	writeFileSync(join(deck, "canvases/plan/cards/a/chart.js"), "export default 1;");
	writeFileSync(join(deck, B), "<h1>B</h1>");
	writeFileSync(join(deck, "canvases/other/cards/o/index.html"), "<p>not on the canvas</p>");
	writeFileSync(join(deck, "canvases/plan/canvas.pen"), "{}");
	writeFileSync(join(deck, "canvases/plan/photo.jpg"), "jpg");
	const picture = join(deck, "pic.webp");
	writeFileSync(picture, "webp");
	const records: Record<string, Page> = { [A]: card(A, { lastWrittenBy: "agent-1", namedAt: Date.now() }), [B]: card(B) };

	const { manifest, bytes } = await buildBundle({
		deckPath: deck,
		deckName: "decks",
		card: (path) => records[path],
		canvas: { dir: join(deck, "canvases/plan"), title: "Plan", rev: 3, doc: { version: "2.9", children: [{ type: "rectangle", id: "r", fill: { type: "image", url: "photo.jpg" } }] } as never, cards: [{ path: A, x: 10, y: 20, w: 1000, h: 400 }, { path: B, x: 1200, y: 20, w: 760, h: 300 }] },
		picture: async (one, scheme) => (one.path === A && scheme === "light" ? picture : undefined),
	});
	const names = readZip(new Uint8Array(bytes).buffer).map((one) => one.name);
	for (const wanted of ["manifest.json", `deck/${A}`, "deck/canvases/plan/cards/a/chart.js", `deck/${B}`, "deck/lib/card.css", "deck/assets/chart.png", "deck/assets/style.css", "deck/assets/font.woff2", "deck/canvases/plan/canvas.pen", "deck/canvases/plan/photo.jpg", `pictures/light/${A}.webp`]) {
		assert.ok(names.includes(wanted), `${wanted} is in the bundle`);
	}
	assert.ok(!names.includes("deck/canvases/other/cards/o/index.html"), "a card of another canvas that is only linked to stays out");
	assert.deepEqual(manifest.cards.map(({ path, x, y }) => ({ path, x, y })), [{ path: A, x: 10, y: 20 }, { path: B, x: 1200, y: 20 }]);
	const first = manifest.cards[0]!;
	assert.ok(first.lastWrittenBy === undefined && first.namedAt === undefined && (first.seenAt ?? 0) > 0, "a card arrives read, with nobody's byline");
	assert.equal(manifest.pen.base, "canvases/plan/");
	assert.deepEqual(manifest.pictures, { [A]: { light: `pictures/light/${A}.webp` } });
});
