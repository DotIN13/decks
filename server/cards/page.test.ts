import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "../kernel/testing.ts";
import { cards } from "./feature.ts";

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
