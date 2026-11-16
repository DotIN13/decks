/**
 * An app item the person placed is duplicated (⌘D) and deleted then brought back (⌘Z) in the canvas frame,
 * on the frame's pass, which the pass guard allows because the canvas already places that app.
 *   node tools/checks/run.mjs tools/checks/compat/app-duplicate.mjs
 */
import { API, asPerson, canvasFrame, focusCanvas, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);
await settle(page, 900);
const link = await socket();
const agentId = await until(async () => link.last("agents")?.focused);
const canvas = await until(async () => link.last("stages")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);
const made = await call("apps.create", ["e2e-dup", { title: "E2E dup", starter: "static" }]);
const placed = await call("canvas.insert", [made.value?.item, { canvas, at: { x1: 0, y1: 0 } }]);
const id = placed.value?.id;
say("the person places an app", !!id, JSON.stringify(placed).slice(0, 160));
await call("view.focus", [id, { canvas }]);
await settle(page, 1500);
const cv = () => canvasFrame(page);
const apps = () => cv().then((c) => c.evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).filter((n) => n.metadata?.type === "decks.app" || String(n.url ?? "").startsWith("/app/")).length));
say("the frame draws it", (await until(async () => (await apps()) === 1)) === true, String(await apps()));

// Calibration: the same marquee and ⌘D on a plain rectangle the person drew.
await call("canvas.insert", [{ type: "rectangle", id: "dup-rect", width: 200, height: 120, fill: "#4c8bf5" }, { canvas, at: { x1: 1400, y1: 0 } }]);
await call("view.move", [{ x: 1500, y: 60, zoom: 1 }]);
await settle(page, 900);
const rects = () => cv().then((c) => c.evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).filter((n) => n.type === "rectangle").length));
const rb = await until(() => cv().then((c) => c.evaluate(() => globalThis.__decksProbes?.penBox?.("dup-rect")?.toJSON())), 4000);
if (rb) {
	await page.mouse.move(rb.x - 40, rb.y - 40);
	await page.mouse.down();
	await page.mouse.move(rb.x + rb.width + 40, rb.y + rb.height + 40, { steps: 8 });
	await page.mouse.up();
	await settle(page, 300);
	await focusCanvas(page);
	await page.keyboard.press("ControlOrMeta+d");
}
say("calibration: a marquee, focusCanvas and ⌘D duplicate a rectangle", (await until(async () => (await rects()) === 2, 4000)) === true, `${await rects()} rectangles; box ${JSON.stringify(rb)}`);

// Select it with a marquee from bare canvas around it (its middle is the app's own page), then ⌘D.
await call("view.move", [{ x: 550, y: 380, zoom: 0.5 }]);
await settle(page, 900);
const box = await until(() => cv().then((c) => c.evaluate((id) => globalThis.__decksProbes?.penBox?.(id)?.toJSON(), id)), 4000);
await page.mouse.move(box.x - 40, box.y - 40);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40, { steps: 6 });
await page.mouse.up();
await settle(page, 400);
const selected = await cv().then((c) => c.evaluate(() => document.querySelectorAll(".pen-handle").length));
say("a marquee around it selects it", selected > 0, `${selected} handles`);
// The pill's Duplicate, then ⌘D with the focus put on the canvas: either makes a copy.
const pill = (await cv()).locator('[aria-label="Duplicate"]').first();
const pillThere = await pill.isVisible().catch(() => false);
if (pillThere) await pill.click();
const copied = { two: await until(async () => (await apps()) === 2, 4000) };
say("the pill's Duplicate copies the app item on the pass", copied.two === true, `pill ${pillThere ? "shown" : "not shown"}; ${await apps()} app items`);
if (!copied.two) {
	await focusCanvas(page);
	await page.keyboard.press("ControlOrMeta+d");
	copied.two = await until(async () => (await apps()) === 2);
}
say("⌘D duplicates the app item on the pass", copied.two === true, `${await apps()} app items`);
// Delete the copy (it is selected after a duplicate), then ⌘Z brings it back.
await page.keyboard.press("Backspace");
const back1 = await until(async () => (await apps()) === 1);
say("deleting it takes it off", back1 === true, `${await apps()} app items`);
await focusCanvas(page);
await page.keyboard.press("ControlOrMeta+z");
const back2 = await until(async () => (await apps()) === 2);
say("⌘Z brings the deleted app item back", back2 === true, `${await apps()} app items`);
say("no errors on the page", errors.filter((e) => !/favicon/.test(e)).length === 0, errors.slice(0, 3).join(" | "));
link.close();
await browser.close();
