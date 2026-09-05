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
import { editMode, open, say } from "../harness.mjs";

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

	/*
	 * And it is the only control that dismisses it.
	 *
	 * The column used to carry an × of its own, revealed on hover at the top of the stack.
	 * One surface with two dismiss controls is one too many — the button that opened this is
	 * the button that closes it, which is what `data-on` on it says — so the × is gone and
	 * this asserts the absence, because a hover-revealed control is exactly the kind of thing
	 * that comes back by accident. Escape and a right-swipe are the other two ways out and
	 * neither is a control; both are asserted elsewhere in this file and in `mobile.mjs`.
	 */
	const inColumn = await page.evaluate(() => document.querySelectorAll(".stream button[aria-label*='lose' i], .stream .stream-head").length);
	say("the conversation has no close button of its own", inColumn === 0, String(inColumn));
	// It floats over the boards rather than standing beside them, so it is deliberately not
	// subtracted from the canvas — see the note on the inspector below, which is the same
	// rule read the other way.
	say("…and floating means it is not an inset", now.insetRight === "0px", now.insetRight);

	/*
	 * Selecting is also an explicit act, and it is the more recent one.
	 *
	 * `[data-id="goal"]` rather than the first `[data-id]` on the board: the first is the
	 * heading, which the editor does not treat as a selectable box, so the click landed and
	 * nothing was selected. A named component is also a better failure message than an
	 * index when the fixture changes.
	 */
	await page.locator('.board-node[data-path="boards/plan.html"] .chrome').first().click();
	await page.keyboard.press("1");
	await page.waitForTimeout(900);
	/* Selecting a component is editing, and the inspector is edit-only — it is a properties
	   panel, and one whose fields cannot be applied would be lying about what it does. */
	await editMode(page);
	await page.frameLocator('.board-node[data-path="boards/plan.html"] iframe').locator('[data-id="goal"]').click();
	await page.waitForSelector(".inspector", { timeout: 6000 });
	now = await state();
	say("selecting hands the edge to the inspector", now.inspector && !now.shown, JSON.stringify(now));
	say("…and the button says yielded, not off", now.button === "yield", now.button);
	/*
	 * And the inspector is **not** an inset either, which is a change of rule.
	 *
	 * It used to be, on the argument that it arrives on its own rather than being summoned,
	 * and the conversation may overlap because you asked for it. That reading held while the
	 * panel was a full-height column beside the canvas. It is a 320px card in the top-right
	 * corner now, under the tool cluster, and subtracting its width re-centred the dock — so
	 * every click on a component slid the input bar 160px sideways to report a selection.
	 *
	 * So the rule the chrome keeps is about geometry rather than intent: a surface that
	 * stands *beside* the canvas is subtracted, one that floats over a corner of it is not.
	 * The right edge is still *yielded* to this panel, which is the assertion above and a
	 * different mechanism entirely.
	 */
	say("…and it is not an inset: it floats in a corner rather than standing beside the canvas", now.insetRight === "0px", now.insetRight);

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
	await page.frameLocator('.board-node[data-path="boards/plan.html"] iframe').locator('[data-id="goal"]').click();
	await page.waitForSelector(".inspector", { timeout: 6000 });
	await button.click();
	await page.waitForSelector("[data-shown='true']", { timeout: 4000 });
	now = await state();
	say("the most recent act wins, and the inspector yields", now.shown && !now.inspector, JSON.stringify(now));
	/*
	 * Closed with the corner button, because that is now the only control that closes it.
	 *
	 * This used to click the column's own ×, falling back to Escape if it could not find
	 * one. Both halves of that are wrong here now: the × is gone, and Escape is the *other*
	 * case — with a component selected it clears the selection and calls `preventDefault`,
	 * so the conversation's own handler stands down and this assertion would be about a
	 * selection that no longer exists. One press of the button, which is the gesture a
	 * person has.
	 */
	await button.click();
	await page.waitForTimeout(500);
	now = await state();
	say("…and closing it hands the edge straight back, selection intact", now.inspector && !now.shown, JSON.stringify(now));

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
