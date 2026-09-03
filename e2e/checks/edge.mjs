/**
 * Who owns the right edge — the newest rule in the app and the easiest to get wrong.
 *
 * The conversation and the inspector both want that edge and only one may have it. The rule
 * is one sentence — *the most recent explicit act owns it* — and it is a bit of state rather
 * than a condition because of the cases a condition gets wrong. Each of those is a case
 * here, and each was a real bug at some point in the writing:
 *
 * - yielding is not closing, so deselecting brings the conversation back;
 * - closing it while yielded is permanent, because what matters is whether it is *wanted*;
 * - taking the edge back must not cost the selection.
 *
 * There is unit coverage of the state machine. This is here because the machine was right
 * and the app was still wrong: one Escape hit two listeners, and the first changed the
 * condition the second read, so a single press dismissed the inspector *and* a conversation
 * that had never been asked to go.
 */
import { open, say } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900 });
try {
	const button = page.locator('.pill button[title^="Conversation"]').first();
	const state = async () => ({
		button: (await button.getAttribute("data-on")) ?? "off",
		shown: (await page.locator("[data-shown='true']").count()) > 0,
		inspector: (await page.locator(".inspector").count()) > 0,
		insetRight: await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--inset-right").trim()),
	});

	say("at rest the edge is empty", JSON.stringify(await state()) === JSON.stringify({ button: "off", shown: false, inspector: false, insetRight: "0px" }), JSON.stringify(await state()));

	await button.click();
	await page.waitForSelector("[data-shown='true']", { timeout: 4000 });
	let now = await state();
	say("the button shows the conversation", now.button === "true" && now.shown, JSON.stringify(now));
	// It floats, so it is deliberately *not* subtracted from the canvas: a surface you
	// summoned may overlap, and one that arrives on its own may not.
	say("…and floating means it is not an inset", now.insetRight === "0px", now.insetRight);

	// Selecting is also an explicit act, and it is the more recent one.
	await page.locator('.board-node[data-path="boards/plan.html"] .chrome').first().click();
	await page.keyboard.press("1");
	await page.waitForTimeout(900);
	await page.frameLocator('.board-node[data-path="boards/plan.html"] iframe').locator("[data-id]").first().click();
	await page.waitForSelector(".inspector", { timeout: 6000 });
	now = await state();
	say("selecting hands the edge to the inspector", now.inspector && !now.shown, JSON.stringify(now));
	say("…and the button says yielded, not off", now.button === "yield", now.button);
	say("…and the inspector *is* an inset, because it arrived on its own", now.insetRight !== "0px", now.insetRight);

	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-shown='true']", { timeout: 4000 });
	now = await state();
	say("deselecting gives the edge back — one press, one thing", now.shown && !now.inspector && now.button === "true", JSON.stringify(now));

	await page.keyboard.press("Escape");
	await page.waitForTimeout(400);
	now = await state();
	say("a second press closes the conversation", !now.shown && now.button === "off", JSON.stringify(now));

	/*
	 * And the case that needs the extra bit: press the button while something is selected.
	 * The conversation wins, the inspector yields, and **the selection survives** — losing a
	 * selected box because you wanted to read the chat would be a bad trade.
	 */
	await page.frameLocator('.board-node[data-path="boards/plan.html"] iframe').locator("[data-id]").first().click();
	await page.waitForSelector(".inspector", { timeout: 6000 });
	await button.click();
	await page.waitForSelector("[data-shown='true']", { timeout: 4000 });
	now = await state();
	say("the most recent act wins, and the inspector yields", now.shown && !now.inspector, JSON.stringify(now));
	await page.locator("[data-shown='true'] button[aria-label*='lose'], [data-shown='true'] button[title*='lose']").first().click().catch(() => page.keyboard.press("Escape"));
	await page.waitForTimeout(500);
	now = await state();
	say("…and closing it hands the edge straight back, selection intact", now.inspector && !now.shown, JSON.stringify(now));

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
