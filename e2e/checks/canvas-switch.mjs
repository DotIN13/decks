/**
 * Moving between canvases with the canvas list: which frame shows the next one (`@decks/canvas`,
 * `frame/outside/held.ts`, `chooseFrame`; `frame/inside/frame.tsx`, `reset`).
 *
 * The canvas left is not a tab of the row, so its frame is not kept. On a computer the page keeps one
 * frame spare, its code loaded and its drawing engine started: the next canvas starts in that, and the
 * frame left is taken off the page. With no spare loaded (a phone, an iPad, or a moment after one was
 * taken) the frame left moves to the next canvas in place, keeping the code and the engine's module
 * it loaded, when both canvases are yours alone. A friend's canvas runs its owner's code, which can
 * outlive its cards, so a frame is never moved to one or from one: nothing of a friend's canvas is
 * ever in a frame with one of yours.
 *
 * What is checked: with the spare loaded, your other canvas shows in the frame that was spare, with
 * its own drawing and none of the first one's cards, and the frame left is gone; going back shows
 * the first canvas's cards again, in one frame, without the other's note; the friend's canvas is in
 * a frame that showed neither of yours, and yours, after it, in a frame that did not show the
 * friend's. Which frame moves in place, and when, is `held.test.ts`'s; how long a switch takes is
 * the timing script's (`scripts/switch-timing.mjs`).
 */
import { API, asPerson, canvasFrame, open, resetStage, say, settle } from "../harness.mjs";

const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();
const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
// A second canvas of yours, with one note on it to tell it apart.
const made = await call("canvas.create", ["Switch check"]);
const second = made.value?.name;
await call("canvas.insert", [{ type: "note", id: "switch-note", content: "On the second canvas" }, { canvas: second, at: { x1: 0, y1: 0 } }]);
say("a second canvas of yours is made", !!second, JSON.stringify(made).slice(0, 160));

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await canvasFrame(page);
const iframe = () => page.$("iframe.canvas-frame");
const same = async (handle) => page.evaluate((one) => one === document.querySelector("iframe.canvas-frame"), handle);
const drawn = async () => {
	const frame = await canvasFrame(page);
	return frame.evaluate(() => ({ ids: ((globalThis.__decksProbes?.frameDrawn?.()?.children ?? [])).map((one) => one.id), cards: (globalThis.__decksProbes?.cards?.() ?? []).length }));
};
const pick = async (title) => {
	await page.locator('[data-tip="Canvases"]:visible').first().click();
	await settle(page, 300);
	const row = page.locator(".switcher-canvas", { hasText: title }).first();
	if (!(await row.count())) {
		await page.locator(".menu-find input").first().fill(title);
		await settle(page, 300);
	}
	await row.click();
};

const first = await until(async () => ((await drawn()).cards >= 3 ? await drawn() : undefined));
say("the fixture's canvas shows its cards", !!first, JSON.stringify(first));
const start = await iframe();
/** How many canvas frames show something: the one in front and any kept behind it, not the spare. */
const showing = () => page.locator("iframe.canvas-frame, iframe.canvas-frame-kept").count();
// The spare: made a moment after the page goes quiet, and loaded a moment after that.
const spare = await page.waitForSelector("iframe.canvas-frame-spare", { state: "attached", timeout: 12000 }).catch(() => undefined);
await settle(page, 2000);

await pick("Switch check");
const onSecond = await until(async () => {
	const now = await drawn();
	return now.ids.includes("switch-note") ? now : undefined;
});
say("switching to your other canvas shows its drawing", !!onSecond, JSON.stringify(onSecond));
say("…in the frame the page kept spare, which had loaded already", !!spare && (await same(spare)) && !(await same(start)));
say("…with none of the first canvas's cards left", onSecond?.cards === 0, String(onSecond?.cards));
say("…and the frame of the canvas left is off the page: it is no tab of the row", (await until(async () => ((await showing()) === 1 ? true : undefined))) === true, String(await showing()));

await pick("Auth refresh");
const back = await until(async () => ((await drawn()).cards >= 3 ? await drawn() : undefined));
say("switching back shows the first canvas's cards again", !!back, JSON.stringify(back));
say("…in one frame", (await until(async () => ((await showing()) === 1 ? true : undefined))) === true, String(await showing()));
say("…without the second canvas's note", !back?.ids.includes("switch-note"), JSON.stringify(back?.ids));
const mine = await iframe();

await pick("Ada's old notes");
await until(async () => !(await same(mine)));
say("a friend's canvas gets a frame that showed none of yours", !(await same(mine)) && !(await same(start)));
const friendFrame = await iframe();
await settle(page, 1500);

await pick("Auth refresh");
await until(async () => !(await same(friendFrame)));
say("…and leaving it, yours is in a frame that did not show the friend's", !(await same(friendFrame)));
const last = await until(async () => ((await drawn()).cards >= 3 ? await drawn() : undefined));
say("…which shows your canvas's cards", !!last, JSON.stringify(last));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
