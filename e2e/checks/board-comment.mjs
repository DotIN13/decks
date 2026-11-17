/**
 * A comment on words selected in a card.
 *
 * A board is only its picture on the canvas now, so words are selected in a card (`decks.card`, drawn
 * in the canvas frame in a root of its own): selected words offer a comment by them, a small button
 * that opens the box in the frame, and a kept comment goes over the input bar on the page for the
 * next message, a draft that is never sent on its own.
 */
import { API, asPerson, canvasFrame, flyToCard, focusCanvas, open, openHistory, pressCardAction, resetStage, rest, say, selectCard, settle } from "../harness.mjs";

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
await canvas.waitForFunction((id) => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).some((one) => one.id === id), made.value?.id, { timeout: 10000 });
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
	// The page draws the box, where the frame says (`pageComments`): its Send now is a press of yours.
	const popup = page.locator(".comment-popup");
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
			/*
			 * A press that starts in the box is the box's wherever it ends: a drag from the field that runs out
			 * over the card's words, the button let go there, leaves the box as it was, open with what was
			 * typed. The card heard the press end over its words, read the words still selected in it and
			 * offered them again, and the box began anew, shut and empty.
			 */
			await field.fill("Typed, then dragged out of");
			const typed = await field.boundingBox();
			const around = await popup.boundingBox();
			const clearOfBox = (at) => at.x < around.x - 12 || at.x > around.x + around.width + 12 || at.y < around.y - 12 || at.y > around.y + around.height + 12;
			// On the card's words, clear of the box: the selected line itself, or the heading over it.
			const out = [{ x: line.x + line.w / 2, y: line.y }, { x: line.x + line.w / 2, y: line.y - 34 }, { x: line.x - 60, y: line.y }].find(clearOfBox);
			say("there are words on the card clear of the box", !!out, JSON.stringify({ line, around }));
			if (out) {
				await page.mouse.move(typed.x + typed.width - 30, typed.y + 14);
				await page.mouse.down();
				await page.mouse.move(out.x, out.y, { steps: 10 });
				await page.waitForTimeout(150);
				await page.mouse.up();
				await settle(page, 500);
				say("a press in the field, dragged out over the card's words and let go, leaves the box open with what was typed", (await field.isVisible().catch(() => false)) && (await field.inputValue().catch(() => "")) === "Typed, then dragged out of", JSON.stringify({ out, field: await field.isVisible().catch(() => false), start: await popup.locator(".comment-start").isVisible().catch(() => false) }));
			}
			await field.fill("A note on these words");
			await page.keyboard.press("Enter");
			const kept = await until(async () => !(await popup.isVisible().catch(() => false)) && (await page.locator(".dock").innerText().catch(() => "")).includes(quote.trim().slice(0, 12)));
			say("kept, it goes over the input bar with the next message", kept, await page.locator(".dock").innerText().catch(() => ""));


		}
	}
}

// The card's pill has Comment too, which opens the box at once; and Send now sends it to the agent as a message of its own.
await focusCanvas(page);
await page.keyboard.press("Escape");
await selectCard(page, made.value?.card);
await pressCardAction(page, "Comment");
const box = page.locator(".comment-popup");
const field = box.locator(".comment-field");
const boxOpen = await until(() => field.isVisible().catch(() => false));
say("the pill's Comment opens the box at once, drawn by the page", !!boxOpen);
if (boxOpen) {
	await field.fill("Sent straight away");
	await box.locator('.comment-act[data-primary="true"]').click();
	await openHistory(page);
	// Sent as the composer sends a comment with no words beside it: a message of its own, holding the comment's pill, named for the card.
	const sent = await until(() => page.locator('.stream .stream-mine [data-kind="comment"][data-mention-name="Words"]').count().then((n) => n > 0), 10000);
	say("Send now sends it to the agent at once, as a message of its own", !!sent, JSON.stringify(await page.locator(".stream .stream-mine").allInnerTexts().catch(() => [])).slice(0, 300));
	say("…and the box goes", !(await box.isVisible().catch(() => false)));
}

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
