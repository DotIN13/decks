/**
 * On a touch screen an app window's lights take a tap: red closes it, yellow collapses it to a link,
 * and green opens the app in a tab, each at the first tap, with the window not selected first.
 *
 * A touch screen covers an awake item until it is activated (`item-slot.tsx`, `touch-cover`), and the
 * stage's own fingers pan and pinch: the lights sit above the cover, and a tap on one is theirs alone.
 */
import { API, asPerson, canvasFrame, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

const { browser, page, errors } = await open({ device: "iPad Pro 11 landscape", scheme: "light" });
await resetStage(page);
await settle(page, 900);
const link = await socket();
const agentId = await until(async () => link.last("agent.list")?.focused);
const stageName = await until(async () => link.last("canvas.list")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);
const view = page.viewportSize();

const made = await call("apps.create", ["e2e-touch", { title: "E2E touch", starter: "static" }]);
const items = async () => (await call("canvas.read", [{ canvas: stageName, depth: 0 }])).value?.items ?? [];
const boxOf = async (id) => (await canvasFrame(page)).evaluate((path) => globalThis.__decksProbes?.cards?.().find((one) => one.path === path)?.rect.toJSON(), `item:${id}`);
/** The window at 50%, right of the side panel and the tool column, which lie over the canvas's left. */
const place = async () => {
	const id = (await call("canvas.insert", [made.value?.item, { canvas: stageName, at: { x1: 4000, y1: 4000 } }])).value?.id;
	const person = await asPerson();
	const seen = async () => {
		const box = await boxOf(id);
		return box && Math.abs(box.width - 550) < 2 && box.x > 440 && box.y > 120 && box.x + box.width < view.width ? box : undefined;
	};
	await until(() => boxOf(id), 5000);
	for (let tries = 0; tries < 4 && !(await seen()); tries++) {
		await fetch(`${API}/api/v1/view.move`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args: [{ x: 4550 - 400, y: 4380, zoom: 0.5 }] }) });
		const go = (await canvasFrame(page)).locator("button", { hasText: /^Go$/ }).first();
		if (await until(() => go.isVisible(), 1200)) await go.tap();
		await until(seen, 3000);
	}
	await settle(page, 700);
	return { id, box: await seen() };
};
const gone = (id) => until(async () => !(await items()).some((one) => one.id === id), 5000);
/** A tap in the middle of a light, as the engine paints it: 12 across, 20 apart, the first 14 from the left, in a bar 44 tall. */
const tapLight = (box, index) => page.touchscreen.tap(box.x + (20 + 20 * index) * (box.width / 1100), box.y + 22 * (box.width / 1100));

{
	const { id, box } = await place();
	say("the app's window is on screen", !!box, JSON.stringify(box));
	if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/app-window-ipad.png` });
	await tapLight(box, 0);
	say("a tap on the red light closes the window", (await gone(id)) === true);
}
{
	const { id, box } = await place();
	await tapLight(box, 1);
	say("a tap on the yellow light takes the window off", (await gone(id)) === true);
	const chip = await until(async () => (await items()).find((one) => one.type === "link" && one.to === "#app/e2e-touch"));
	say("…and leaves a link to the app", !!chip, JSON.stringify(chip));
	if (chip) await call("canvas.delete", [chip.id, { canvas: stageName }]);
}
{
	const { id, box } = await place();
	await tapLight(box, 2);
	// The window's address names what is in front: a touch screen's head bar shows one name and a count, not a row of tabs.
	const front = await until(async () => ((await page.evaluate(() => location.hash)) === "#app/e2e-touch" ? true : undefined), 6000);
	say("a tap on the green light opens the app in a tab, in front", front === true, await page.evaluate(() => location.hash));
	say("…and the window stays on the canvas", (await items()).some((one) => one.id === id));
	if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/app-window-ipad-tab.png` });
}

say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
