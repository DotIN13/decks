#!/usr/bin/env node
// In compat/ because it reads today's canvas page by its old class names. Proves the frame feature: the page opens with /canvas-frame.html taken from
// Decks-local's server/frame (its build), the frame draws the fixture canvas, and an edit in it
// (a card nudged, then deleted) reaches the drawing's file. Needs server/frame/dist (node server/frame/build.mjs).
// A heavy job: node tools/heavy.mjs --wait -- node tools/checks/compat/frame-probe.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { runPrograms } from "../run.mjs";

const card = "canvases/auth-refresh/cards/plan/index.html";
const xOf = (deck) => JSON.parse(readFileSync(join(deck, "canvases/auth-refresh/canvas.pen"), "utf8")).children.find((n) => n.metadata?.path === "cards/plan/index.html")?.x ?? "gone";

const result = await runPrograms(async ({ ports, deck }) => {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const served = [];
	const said = [];
	page.on("console", (m) => m.type() !== "debug" && said.push(`${m.type()}: ${m.text().slice(0, 200)}`));
	page.on("pageerror", (e) => said.push(`pageerror: ${e.message.slice(0, 200)}`));
	page.on("requestfailed", (r) => said.push(`failed: ${r.url().slice(0, 160)} ${r.failure()?.errorText ?? ""}`));
	page.on("response", (r) => r.status() >= 400 && said.push(`${r.status()}: ${r.url().slice(0, 160)}`));
	page.on("request", (r) => r.method() === "POST" && !r.url().includes("view.move") && said.push(`post: ${r.url().slice(0, 120)} ${(r.postData() ?? "").slice(0, 160)}`));
	page.on("websocket", (ws) => {
		said.push(`ws: ${ws.url().replace(/token=[^&]+/, "token=…")}`);
		ws.on("close", () => said.push(`ws closed: ${ws.url().slice(0, 60)}`));
		ws.on("framesent", (f) => said.push(`sent: ${String(f.payload).replace(/"token":"[^"]+"/, '"token":"…"').slice(0, 220)}`));
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
	// As card-keys.mjs does it: a press on the card's words, Escape (the card stays selected),
	// then an arrow; and Backspace, which takes the card off the drawing.
	const host = await frame.evaluate((path) => {
		const r = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === path)?.querySelector(".card-host")?.getBoundingClientRect();
		return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
	}, card);
	const drawn = !!host;
	if (host) {
		const box = await (await frame.frameElement()).boundingBox();
		await page.mouse.click(box.x + host.x + host.w * 0.5, box.y + host.y + host.h * 0.6);
		await page.waitForTimeout(400);
		await page.keyboard.press("Escape");
		await page.waitForTimeout(400);
		await page.keyboard.press("ArrowRight");
		await page.waitForTimeout(800);
		await page.keyboard.press("Backspace");
	}
	let after = before;
	for (let i = 0; i < 40 && after === before; i++) {
		await page.waitForTimeout(150);
		after = xOf(deck);
	}
	const gone = !readFileSync(join(deck, "canvases/auth-refresh/canvas.pen"), "utf8").includes("cards/plan/index.html");
	await browser.close();
	return { frame: served, drawn, before, after, moved: after !== before, gone, said: said.filter((l) => !l.startsWith("warning")).slice(-25) };
});
console.log(JSON.stringify(result));
process.exitCode = result.gone ? 0 : 1;
