/**
 * Moving between canvases keeps the canvas frame when both are yours alone, and makes a new one
 * otherwise (`frame/outside/host.tsx`, `inPlace`; `frame/inside/frame.tsx`, `reset`).
 *
 * A frame moved in place keeps the code and the engine's module it loaded, so a switch skips the
 * frame's whole start; it ends everything the old canvas started first (`life.ts`). A friend's
 * canvas runs its owner's code, which can outlive its cards, so going to one, and leaving one, makes
 * a new frame: nothing of a friend's canvas is ever in a frame with one of yours.
 *
 * What is checked: the iframe element is the same across a switch between two of your canvases, in
 * both directions, and each canvas shows its own drawing and cards after it; it is a new element on
 * the way to the friend's canvas and on the way back; the switch shows on the page before the
 * server answers is left to the timing script (`scripts/switch-timing.mjs`).
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

await pick("Switch check");
const onSecond = await until(async () => {
	const now = await drawn();
	return now.ids.includes("switch-note") ? now : undefined;
});
say("switching to your other canvas shows its drawing", !!onSecond, JSON.stringify(onSecond));
say("…in the same frame", await same(start));
say("…with none of the first canvas's cards left", onSecond?.cards === 0, String(onSecond?.cards));

await pick("Auth refresh");
const back = await until(async () => ((await drawn()).cards >= 3 ? await drawn() : undefined));
say("switching back shows the first canvas's cards again", !!back, JSON.stringify(back));
say("…still in the same frame", await same(start));
say("…without the second canvas's note", !back?.ids.includes("switch-note"), JSON.stringify(back?.ids));

await pick("Ada's old notes");
await until(async () => !(await same(start)));
say("a friend's canvas gets a frame of its own", !(await same(start)));
const friendFrame = await iframe();
await settle(page, 1500);

await pick("Auth refresh");
await until(async () => !(await same(friendFrame)));
say("…and leaving it makes a new frame again", !(await same(friendFrame)) && !(await same(start)));
const last = await until(async () => ((await drawn()).cards >= 3 ? await drawn() : undefined));
say("…which shows your canvas's cards", !!last, JSON.stringify(last));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
