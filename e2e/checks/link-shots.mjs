/**
 * Pictures of links on a canvas, for looking at, not for asserting on: chips to a canvas, a card and
 * an app beside a drawn card whose words hold a link, in light and dark. `LOOK_SHOTS=<dir>` names
 * where they go. Run only when named.
 */
import { mkdirSync } from "node:fs";
import { API, CANVAS, asPerson, canvasFrame, card, open, resetStage, rest, say, settle } from "../harness.mjs";

const OUT = process.env.LOOK_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const notes = (await call("canvas.create", ["Research notes"])).value?.name;
await call("apps.create", ["budget", { title: "Budget", starter: "static" }]);
const made = await call("canvas.batch", [
	[
		{ op: "insert", item: { type: "link", id: "chip-canvas", to: notes }, at: { x1: 0, y1: -420 } },
		{ op: "insert", item: { type: "link", id: "chip-card", to: card("plan") }, at: { x1: 0, y1: -356 } },
		{ op: "insert", item: { type: "link", id: "chip-app", to: "budget" }, at: { x1: 0, y1: -292 } },
		{ op: "insert", item: { type: "text", id: "words", content: `The numbers are in [the budget](#app/budget), and the interviews are in [Research notes](#canvas/${notes}).`, fontSize: 18, textGrowth: "fixed-width", width: 330, metadata: { type: "decks.markdown" } }, at: { x1: 330, y1: -410 } },
	],
	{ canvas: CANVAS },
]);
const shots = [];
for (const scheme of ["light", "dark"]) {
	const { browser, page } = await open({ width: 1300, height: 760, scheme });
	await rest(page, { start: 0 });
	await page.locator('.panel-shell [aria-label="Hide the side panel"]').first().click();
	for (let tries = 0; tries < 4; tries++) {
		await call("view.focus", [["chip-canvas", "chip-card", "chip-app", "words"], { canvas: CANVAS }]);
		const go = (await canvasFrame(page)).locator("button", { hasText: /^Go$/ }).first();
		if (await go.isVisible().catch(() => false)) await go.click();
		await settle(page, 900);
		const box = await (await canvasFrame(page)).evaluate(() => globalThis.__decksProbes?.penBox?.("chip-canvas")?.toJSON());
		if (box && box.y > 60 && box.y < 500) break;
	}
	if (OUT) await page.screenshot({ path: `${OUT}/${scheme}-links.png` });
	shots.push(scheme);
	await browser.close();
}
say("the pictures were taken", made.ok === true && shots.length === 2, JSON.stringify(made).slice(0, 200));
