import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "../kernel/testing.ts";
import { cards } from "./feature.ts";
import { passMayRead, scopedMayRead } from "./page.ts";

// Rule 14 through the real HTTP door: a card's page and module, with card.url's pass.

test("a card's page and its module are served with the pass card.url gives", async () => {
	const s = await testServer({ features: [cards()], deck: { "canvases/a/canvas.pen": "{}" } });
	const ann = callers.agent("ann", "a");
	const { path } = await s.value<{ path: string }>("card.create", { title: "Page" }, ann);
	const address = await s.value<string>("card.url", { card: path }, ann);
	const served = await s.listen(4640);
	try {
		const page = await fetch(served.url + address);
		assert.equal(page.status, 200);
		const html = await page.text();
		assert.match(html, /index\.html\.m0\.js\?pass=/);
		const module = await fetch(served.url + address.replace("index.html?", "index.html.m0.js?"));
		assert.equal(module.status, 200);
		assert.match(await module.text(), /export default function \(card\)/);
		assert.equal((await fetch(served.url + "/files/" + path)).status, 401);
	} finally {
		await served.close();
		await s.close();
	}
});

test("rule 14: a pass reads its canvas's folder, assets/ and lib/ under /files, nothing else", () => {
	assert.equal(scopedMayRead("a", "canvases/a/cards/x/index.html"), true);
	assert.equal(scopedMayRead("a", "canvases/a/files/s.txt"), true);
	assert.equal(scopedMayRead("a", "assets/libs/x.js"), true);
	assert.equal(scopedMayRead("a", "lib/card.css"), true);
	assert.equal(scopedMayRead("a", "canvases/b/files/secret.txt"), false);
	assert.equal(scopedMayRead("a", "canvases/ab/files/secret.txt"), false);
	assert.equal(scopedMayRead("a", "docs/notes.md"), false);
});

test("rule 14: a pass's /files address is decoded and fenced before the folder test", () => {
	const scope = { canvas: "a", until: Date.now() + 1000 };
	assert.equal(passMayRead(scope, "/files/canvases/a/cards/x/index.html"), true);
	assert.equal(passMayRead(scope, "/files/assets/..%2fcanvases%2fb%2ffiles%2fs.txt"), false);
	assert.equal(passMayRead(scope, "/files/assets/%252e%252e/canvases/b/files/s.txt"), false);
	assert.equal(passMayRead(scope, "/files/canvases/b/files/s.txt"), false);
	assert.equal(passMayRead({ until: Date.now() + 1000 }, "/files/assets/a.png"), false, "a pass with no canvas reads nothing here");
});

test("rule 14: a pass also reads a page its canvas already places from the deck root, and nothing new", () => {
	const scope = { canvas: "a", until: Date.now() + 1000 };
	const placed = () => new Set(["pages/apps/review.html"]);
	assert.equal(passMayRead(scope, "/files/pages/apps/review.html", placed), true);
	assert.equal(passMayRead(scope, "/files/pages/apps/other.html", placed), false);
	assert.equal(passMayRead(scope, "/files/pages/apps/..%2f..%2fcanvases%2fb%2fx", placed), false);
});
