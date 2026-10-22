import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Board } from "@decks/protocol";
import { readZip } from "../../../web/src/connections/zip.ts";
import { buildBundle } from "./bundle.ts";
import { zip } from "./zip.ts";

test("a zip written here is read back by the browser's reader, stored and deflated alike", async () => {
	const text = "a board ".repeat(500);
	const random = crypto.getRandomValues(new Uint8Array(2048));
	const files = readZip(new Uint8Array(zip([{ name: "deck/boards/é.html", data: Buffer.from(text) }, { name: "pictures/x.webp", data: random }])).buffer);
	assert.deepEqual(files.map((one) => one.name), ["deck/boards/é.html", "pictures/x.webp"]);
	assert.equal(new TextDecoder().decode(await files[0]!.bytes()), text);
	assert.deepEqual(await files[1]!.bytes(), random);
});

function board(path: string, extra: Partial<Board> = {}): Board {
	return { path, title: path, x: 0, y: 0, w: 1000, h: 400, rev: 1, ...extra } as Board;
}

test("a bundle carries the stage, its boards, what they name, lib, and pictures, and leaves out other boards", async () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-bundle-"));
	for (const dir of ["boards", "assets", "lib", "canvases/plan"]) mkdirSync(join(deck, dir), { recursive: true });
	writeFileSync(join(deck, "lib/board.css"), "body{}");
	writeFileSync(join(deck, "assets/chart.png"), "png");
	writeFileSync(join(deck, "assets/font.woff2"), "font");
	writeFileSync(join(deck, "assets/style.css"), "@font-face{src:url('font.woff2')}");
	writeFileSync(join(deck, "boards/a.html"), '<link href="../lib/board.css"><link href="../assets/style.css"><img src="../assets/chart.png"><a href="b.html">b</a><a href="other.html">o</a><img src="https://x.test/y.png">');
	writeFileSync(join(deck, "boards/b.md"), "# B");
	writeFileSync(join(deck, "boards/other.html"), "<p>not on the canvas</p>");
	writeFileSync(join(deck, "canvases/plan/canvas.pen"), "{}");
	writeFileSync(join(deck, "canvases/plan/photo.jpg"), "jpg");
	const picture = join(deck, "pic.webp");
	writeFileSync(picture, "webp");
	const records: Record<string, Board> = { "boards/a.html": board("boards/a.html", { lastWrittenBy: "agent-1", namedAt: Date.now() }), "boards/b.md": board("boards/b.md", { shell: "content" }) };

	const { manifest, bytes } = await buildBundle({
		deckPath: deck,
		deckName: "decks",
		board: (path) => records[path],
		stage: { dir: join(deck, "canvases/plan"), title: "Plan", rev: 3, doc: { version: "2.9", children: [{ type: "rectangle", id: "r", fill: { type: "image", url: "photo.jpg" } }] } as never, boards: [{ path: "boards/a.html", x: 10, y: 20, w: 1000, h: 400 }, { path: "boards/b.md", x: 1200, y: 20, w: 800, h: 300 }] },
		picture: async (one, scheme) => (one.path === "boards/a.html" && scheme === "light" ? picture : undefined),
	});
	const names = readZip(new Uint8Array(bytes).buffer).map((one) => one.name);
	for (const wanted of ["manifest.json", "deck/boards/a.html", "deck/boards/b.md", "deck/lib/board.css", "deck/assets/chart.png", "deck/assets/style.css", "deck/assets/font.woff2", "deck/canvases/plan/canvas.pen", "deck/canvases/plan/photo.jpg", "served/boards/b.md", "pictures/light/boards/a.html.webp"]) {
		assert.ok(names.includes(wanted), `${wanted} is in the bundle`);
	}
	assert.ok(!names.includes("deck/boards/other.html"), "a board that is only linked to stays out");
	assert.deepEqual(manifest.boards.map(({ path, x, y }) => ({ path, x, y })), [{ path: "boards/a.html", x: 10, y: 20 }, { path: "boards/b.md", x: 1200, y: 20 }]);
	assert.deepEqual(manifest.served, ["boards/b.md"]);
	const first = manifest.boards[0]!;
	assert.ok(first.lastWrittenBy === undefined && first.namedAt === undefined && (first.seenAt ?? 0) > 0, "a board arrives read, with nobody's byline");
	assert.equal(manifest.pen.base, "canvases/plan/");
	assert.deepEqual(manifest.pictures, { "boards/a.html": { light: "pictures/light/boards/a.html.webp" } });
});
