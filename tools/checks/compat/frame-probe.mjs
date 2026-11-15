#!/usr/bin/env node
// In compat/ because it reads today's canvas page by its old class names. Proves the frame feature: the page opens with /canvas-frame.html taken from
// Decks-local's server/frame (its build), the frame draws the fixture canvas, and a nudge of a
// card in it reaches the drawing's file. Needs server/frame/dist (node server/frame/build.mjs).
// A heavy job: node tools/heavy.mjs --wait -- node tools/checks/compat/frame-probe.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { runPrograms } from "../run.mjs";

const card = "canvases/auth-refresh/cards/plan/index.html";
const xOf = (deck) => JSON.parse(readFileSync(join(deck, "canvases/auth-refresh/canvas.pen"), "utf8")).children.find((n) => n.metadata?.path === "cards/plan/index.html")?.x;

const result = await runPrograms(async ({ ports, deck }) => {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const served = [];
	const said = [];
	page.on("console", (m) => m.type() !== "debug" && said.push(`${m.type()}: ${m.text().slice(0, 200)}`));
	page.on("pageerror", (e) => said.push(`pageerror: ${e.message.slice(0, 200)}`));
	page.on("requestfailed", (r) => said.push(`failed: ${r.url().slice(0, 160)} ${r.failure()?.errorText ?? ""}`));
	page.on("response", (r) => r.status() >= 400 && said.push(`${r.status()}: ${r.url().slice(0, 160)}`));
	page.on("request", (r) => r.method() === "POST" && said.push(`post: ${r.url().slice(0, 120)} ${(r.postData() ?? "").slice(0, 160)}`));
	page.on("websocket", (ws) => {
		ws.on("framesent", (f) => String(f.payload).includes("line.call") && said.push(`sent: ${String(f.payload).slice(0, 220)}`));
		ws.on("framereceived", (f) => String(f.payload).includes("call.answered") && said.push(`got: ${String(f.payload).slice(0, 220)}`));
	});
	// The page's own /canvas-frame.html is replaced by the one server/frame serves.
	// Sent on to Decks-local rather than fulfilled here: a fulfilled answer has no address, and
	// the browser then treats the frame as a public page that may not reach loopback.
	await page.route("**/canvas-frame.html*", async (route) => {
		served.push(new URL(route.request().url()).port);
		await route.continue({ url: `http://127.0.0.1:${ports.server}/canvas-frame.html` });
	});
	await page.goto(`http://127.0.0.1:${ports.web}/`);
	let frame;
	for (let i = 0; i < 200 && !frame; i++) {
		frame = page.frames().find((f) => f.url().includes("canvas-frame.html"));
		if (frame && !(await frame.evaluate(() => !!document.querySelector(".stage")).catch(() => false))) frame = undefined;
		if (!frame) await page.waitForTimeout(150);
	}
	if (!frame) throw new Error(`the frame never showed its stage (frame page asked ${served.length} times)\n${said.slice(0, 30).join("\n")}`);
	const before = xOf(deck);
	// Selected as today's checks select a card (e2e/harness.mjs selectCard: a spot on it, clear of the
	// page's chrome), the focus given to the canvas, then nudged with the arrows.
	process.env.DECKS_E2E_WEB = `http://127.0.0.1:${ports.web}`;
	const { focusCanvas, selectCard } = await import("../../../e2e/harness.mjs");
	const drawn = await selectCard(page, card).then(() => true, () => false);
	await page.waitForTimeout(400);
	await focusCanvas(page);
	for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
	let after = before;
	for (let i = 0; i < 40 && after === before; i++) {
		await page.waitForTimeout(150);
		after = xOf(deck);
	}
	await browser.close();
	return { frame: served, drawn, before, after, moved: after !== before, said: said.filter((l) => !l.startsWith("warning")).slice(-12) };
});
console.log(JSON.stringify(result));
process.exitCode = result.moved ? 0 : 1;
