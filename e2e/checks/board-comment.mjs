/**
 * A comment on words selected in a card.
 *
 * A board is only its picture on the canvas now, so words are selected in a card (`decks.card`, drawn
 * in the canvas frame in a root of its own): selected words offer a comment by them, a small button
 * that opens the box in the frame, and a kept comment goes over the input bar on the page for the
 * next message, a draft that is never sent on its own.
 */
import { API, asPerson, canvasFrame, flyToCard, focusCanvas, open, resetStage, rest, say, settle } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const made = await call("canvas.insert", [{ type: "card", title: "Words", html: "<h1>Notes on the plan</h1><p>The refresh token rotates every hour, and the old one is refused at once.</p>", width: 640, height: 360 }]);
say("a card to select words in", made.ok === true, JSON.stringify(made).slice(0, 200));

const { browser, page, errors } = await open({ width: 1400, height: 900 });
let canvas = await canvasFrame(page);
await canvas.waitForFunction((id) => (globalThis.__decksFrameDrawn?.().children ?? []).some((one) => one.id === id), made.value?.id, { timeout: 10000 });
// Framed as a person does: selected, then the pill's Fit (an agent's view.focus waits while the person is using the canvas).
await flyToCard(page, made.value?.card);
await settle(page, 600);
canvas = await canvasFrame(page);

// Nothing selected, so the drag below selects words rather than moving the card.
await focusCanvas(page);
await page.keyboard.press("Escape");
await settle(page, 300);
/*
 * The paragraph's words, where the card draws them: its root is closed, so they are found by where
 * they sit, a sixth of the way down under the heading, from the middle of the card's right half.
 */
const line = await until(() =>
	canvas.evaluate((path) => {
		const node = document.querySelector(`.card-node[data-path="${path}"]`);
		if (!node?.querySelector(".card-host") || node.dataset.inert === "true") return null;
		const r = node.getBoundingClientRect();
		const left = Math.max(r.x, 420);
		return { x: left + (r.right - left) * 0.3, y: r.y + r.height * 0.17, w: (r.right - left) * 0.4 };
	}, made.value?.card),
);
say("the card shows its words", !!line, line ? "" : JSON.stringify(await canvas.evaluate((path) => { const node = document.querySelector(`.card-node[data-path="${path}"]`); return { node: !!node, inert: node?.dataset.inert, host: !!node?.querySelector(".card-host"), paths: [...document.querySelectorAll(".card-node")].map((one) => one.dataset.path) }; }, made.value?.card)));
if (line) {
	await page.mouse.move(line.x, line.y);
	await page.mouse.down();
	await page.mouse.move(line.x + line.w, line.y, { steps: 8 });
	await page.mouse.up();
	const popup = canvas.locator(".comment-popup");
	const offered = await until(() => popup.isVisible().catch(() => false));
	say("selected words in a card offer a comment over them", offered);
	if (offered) {
		const start = popup.locator(".comment-start");
		if (await start.isVisible().catch(() => false)) await start.click();
		const field = popup.locator(".comment-field");
		const opened = await until(() => field.isVisible().catch(() => false));
		const quote = opened ? await popup.locator(".comment-quote").innerText().catch(() => "") : "";
		say("pressing it opens the box on those words", opened && quote.trim().length > 0, quote);
		if (opened) {
			await field.fill("A note on these words");
			await page.keyboard.press("Enter");
			const kept = await until(async () => !(await popup.isVisible().catch(() => false)) && (await page.locator(".dock").innerText().catch(() => "")).includes(quote.trim().slice(0, 12)));
			say("kept, it goes over the input bar with the next message", kept, await page.locator(".dock").innerText().catch(() => ""));
		}
	}
}

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
