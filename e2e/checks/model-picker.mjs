/**
 * The composer's model picker, now that it is a popover rather than a `<select>`.
 *
 * The old check read `optgroup` labels and called `selectOption`, which is the right way to
 * test a native control and no way at all to test this one. What it was really asserting
 * survives the change and is asserted here: the provider is a heading rather than a second
 * label beside the chip, every model sits under one, and switching is recorded in the
 * conversation — because which model said a thing is part of what happened.
 *
 * The last of those is the one worth keeping most. A long chat can span three models, and
 * the chip only ever shows the one in use *now*, so without a line in the transcript the
 * reply above a switch and the reply below it look like the same voice.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1600, height: 1000 });

/** The chip that says the model. The last labelled control in the row; attach is first. */
const chip = () => page.locator(".dockrow .chipbtn").last();
const openPicker = async () => {
	if ((await page.locator(".popover").count()) === 0) {
		await chip().click();
		await page.waitForSelector(".popover", { timeout: 6000 });
	}
};

await page.waitForFunction(() => document.querySelectorAll(".dockrow .chipbtn").length > 0, null, { timeout: 15000 });
const chipText = (await chip().innerText()).trim();
say("the chip says the model rather than sitting beside a label for it", chipText.length > 0, chipText);
say("no separate provider label in the box", (await page.locator(".dockbox .provider").count()) === 0);

await openPicker();
const shape = await page.evaluate(() => {
	const pop = document.querySelector(".popover");
	const rows = [...pop.querySelectorAll("[data-row]")];
	const groups = [...pop.querySelectorAll(".group")].map((g) => g.textContent.trim());
	return {
		rows: rows.length,
		groups,
		providers: [...new Set(rows.map((r) => r.querySelector(".pv")?.textContent?.trim()).filter(Boolean))].sort(),
		current: rows.filter((r) => r.dataset.current === "true").length,
		search: Boolean(pop.querySelector("input")),
		/* Every row has a name as well as a provider. */
		named: rows.every((r) => (r.querySelector("span:not(.pv)")?.textContent ?? "").trim().length > 0),
		/*
		 * The provider pill, and its width. It is capped at 72px because it is the *shorter* of
		 * the two names on the row and should not be able to take the longer one's room — but
		 * the cap is a ceiling above every real provider name (`opencode-go`, the longest in
		 * play, is 68px), so it bites only on a slug with a path in it.
		 */
		chips: rows.filter((r) => r.querySelector(".pv")).length,
		chipWidths: [...new Set(rows.map((r) => r.querySelector(".pv")).filter(Boolean).map((c) => Math.round(c.getBoundingClientRect().width)))],
		clipped: [...pop.querySelectorAll(".pv")].filter((c) => c.scrollWidth > c.clientWidth + 1).length,
		/* Whatever the cap does take, the title still has. */
		titled: [...pop.querySelectorAll(".pv")].every((c) => (c.title ?? "").length > 0),
		/* The row height, which a capped flex list used to shrink — 30px became 19. */
		heights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
		/* The list scrolls rather than squeezing its rows to fit. */
		scrolls: (() => {
			const box = [...pop.children].find((c) => c.className.includes("max-h"));
			return box ? box.scrollHeight > box.clientHeight + 1 : null;
		})(),
		popover: Math.round(pop.getBoundingClientRect().height),
		window: window.innerHeight,
	};
});
say("the popover lists the models", shape.rows >= 1, JSON.stringify(shape));
say("…with a search field over them", shape.search);
say("…and exactly one marked as the session's model", shape.current === 1, String(shape.current));
say("…and every row names its model", shape.named);
/*
 * The provider is on *every* row, whether or not more than one is signed in.
 *
 * It was briefly conditional, and that was the wrong trade: which provider a turn is billed
 * to is the kind of fact you check because you cannot remember it, and a chip that comes and
 * goes with the shape of the list is one you cannot rely on being there. The cost it was
 * hidden to avoid is paid by capping it instead.
 */
say("the provider is on every row", shape.chips === shape.rows, `${shape.chips} of ${shape.rows}`);
say(
	"…capped so the model's own name keeps the room",
	shape.chipWidths.every((w) => w <= 72),
	JSON.stringify(shape.chipWidths),
);
/*
 * And the cap is above every provider name that actually exists, so a real one is never
 * elided: `opencode-go` is the longest in play at 68px. A cap that clips the names it was
 * sized for is a cap that was guessed at.
 */
say("…and above every name in the list, so none of them is elided", shape.clipped === 0, `${shape.clipped} clipped`);
say("…with the whole name in its title, since the cap may have taken the tail", shape.titled);

/*
 * The two ways this list has been the wrong size, both asserted at once.
 *
 * It was a flex column with a max-height, so 23 rows of 30px were *shrunk* to 19px to fit —
 * which also stopped it scrolling, since its contents then fitted. A row height is not a
 * suggestion, and a capped list either scrolls or is not capped.
 */
say("the rows keep their height", shape.heights.every((h) => h >= 28), JSON.stringify(shape.heights));
say(
	"…and a list too long for the cap scrolls instead of squeezing them",
	shape.scrolls === null || shape.rows * 30 <= shape.popover || shape.scrolls,
	JSON.stringify({ rows: shape.rows, scrolls: shape.scrolls }),
);
say(
	"…and the card is not most of the window",
	shape.popover <= shape.window * 0.6,
	`${shape.popover} of ${shape.window}`,
);

// The thinking scale lives inside the same popover, which is the point of collapsing three
// native selects into one: model and effort are one decision made in one place.
say("the thinking scale is in the same popover", (await page.locator(".popover").getByText(/thinking/i).count()) > 0);

const rows = page.locator(".popover [data-row]");
const count = await rows.count();
if (count < 2) {
	say("switching model is recorded in the conversation", false, "only one model is configured");
} else {
	/*
	 * The model's name: the row's own span, which is *not* the provider pill.
	 *
	 * There is no `.id` class — an earlier version of this check assumed one and then waited
	 * thirty seconds for it. It then read `.pv + span`, which was worse: it depended on the
	 * provider pill existing, and the pill is only drawn when more than one provider is
	 * signed in. On a deck with one it waited thirty seconds for that instead.
	 */
	const wanted = (await rows.nth(1).locator("span:not(.pv)").first().innerText()).trim();
	await rows.nth(1).click();
	await settle(page, 500);
	const after = (await chip().innerText()).trim();
	say("picking another model changes the chip", after !== chipText, `${chipText} -> ${after}`);

	/*
	 * Read from the history rather than from a toast: it is a notice in the conversation, so
	 * it lands at the point it happened and is in the copy on disk.
	 */
	await page.locator('.pill button[title^="Conversation"]').click();
	await page.waitForSelector("[data-shown='true']", { timeout: 8000 });
	await settle(page, 600);
	const notices = await page.locator("[data-shown='true'] .fnotice, [data-shown='true'] .stream-notice").allInnerTexts();
	say("the switch is recorded in the conversation", notices.some((t) => /model/i.test(t)), JSON.stringify(notices));
	/*
	 * Matched case-insensitively and loosely on purpose: the notice's wording is the
	 * server's, and a check that demands an exact sentence fails the next time somebody
	 * improves it. What must not regress is that the transcript says *which* model, because
	 * the chip only shows the one in use now — without the line, the reply above a switch
	 * and the reply below it read as the same voice.
	 */
	/*
	 * Matched on the model's first word, and that is deliberate rather than lazy.
	 *
	 * The notice names the model's **id** — `anthropic/opus[1m]` — while the row names its
	 * **label**, `Opus (1M context)`, because a label is what a person picks from and an id
	 * is what the server was told. Neither is wrong and the UI never shows the id, so there
	 * is nothing in the DOM to compare exactly against. The first word is what the two share,
	 * and what must not regress is that the transcript says *which* model rather than only
	 * that one changed.
	 */
	const token = wanted.split(/[\s(]/)[0].toLowerCase();
	say(
		"…naming the model it moved to",
		notices.some((t) => /model/i.test(t) && t.toLowerCase().includes(token)),
		`looking for "${token}" in ${JSON.stringify(notices)}`,
	);
	await page.locator('.pill button[title^="Conversation"]').click();
	await settle(page, 300);

	// Put it back: leaving the agent on a provider without credentials makes the next
	// check's turn fail instantly, which reads as a bug in the app.
	await openPicker();
	await rows.nth(0).click();
	await settle(page, 400);
	say("the model is left as it was found", (await chip().innerText()).trim() === chipText, chipText);
}

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
