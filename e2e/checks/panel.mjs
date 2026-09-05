/**
 * The one boards panel: one list, a button, and folded means gone.
 *
 * It replaced three surfaces — a floating context rail, a floating agents panel that could
 * not be open at the same time, and a full-screen browser over the canvas — and then, for a
 * while, it had a tab strip of its own. That is gone too: Context and Deck were the same
 * list with a line through it, so what this asserts is the *absence* of the strip and the
 * presence of all three sections in one scroller.
 *
 * The other half is the camera. A panel *beside* the canvas declares `data-inset="left"`
 * and the camera subtracts it; a sheet *over* the canvas must not, because subtracting one
 * once fitted a 1600px board into the strip beside it at 3.7%. Both are checked, because
 * the difference is invisible until a fit goes wrong.
 */
import { open, say, zoom, ZOOM_IN_PAGE } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900 });
try {
	const inset = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--inset-left").trim());
	const mounted = () => page.locator("[data-inset='left']").count();

	say("the panel is up, and declares its width", (await mounted()) === 1 && (await inset()) === "276px", await inset());

	/*
	 * A tab strip, and it is not the one that was removed.
	 *
	 * **Context** and **Deck** were one collection with a line drawn through it: everything
	 * in Context was also in Deck, so finding a board began by guessing which side the app
	 * had put it on this second. That is why that strip went, and the assertion here used to
	 * be `no tab strip: there is one list`.
	 *
	 * **Boards** and **Agents** overlap in nothing — no agent is in the boards list and no
	 * board is in the agents list. So the invariant that actually mattered, every item
	 * appearing exactly once, holds trivially rather than by argument; it is still checked
	 * below, on the boards list, because that is where it could still break.
	 */
	const tabs = await page.getByRole("tab").allInnerTexts();
	say("two tabs, and they partition nothing", JSON.stringify(tabs) === JSON.stringify(["Boards", "Agents"]), JSON.stringify(tabs));

	/*
	 * The header is 32px, both controls, which is `--control-md` — the height a labelled chip
	 * in the dock already is. It was 28px (`--field`), a value meant for a box inside a row,
	 * and it read short against the rest of the chrome. Checked because a header that drifts
	 * back to 28 is exactly the kind of regression nobody files.
	 */
	const header = await page.evaluate(() => ({
		strip: Math.round(document.querySelector(".panel-shell .seg")?.getBoundingClientRect().height ?? 0),
		field: Math.round(document.querySelector(".panel-shell .field")?.getBoundingClientRect().height ?? 0),
		label: Math.round(document.querySelector(".panel-meta")?.getBoundingClientRect().height ?? 0),
	}));
	say("the strip and the field are both 32px", header.strip === 32 && header.field === 32, JSON.stringify(header));
	say("…and the section labels grew with them", header.label === 22, `${header.label}px`);

	/*
	 * Every board is in it, whoever is holding what. A fresh agent holds nothing, so this is
	 * the deck section on its own — which is the point of the change: the panel is never a
	 * list of nothing with the rest of the deck one tab away.
	 */
	const rows = await page.locator(".board-row").count();
	say("the list is the whole deck", rows >= 4, String(rows));
	/*
	 * The headings, and the two things worth asserting about them: they are in the one order
	 * — what you are looking at, what is held for you, then the rest — and between them they
	 * account for every board exactly once. Which headings are *present* depends on what the
	 * agent happens to hold, so that is not the assertion; this fixture's agent holds every
	 * board and puts them all in play, so "On the canvas" alone is a correct picture of it.
	 */
	const kinds = await page.evaluate(() => [...document.querySelectorAll(".panel-section")].map((section) => section.dataset.kind));
	const order = ["canvas", "held", "deck"];
	say(
		"the sections are in canvas → held → deck order",
		kinds.every((kind, index) => index === 0 || order.indexOf(kind) > order.indexOf(kinds[index - 1])),
		kinds.join(" → ") || "(none)",
	);
	const once = await page.evaluate(() => [...document.querySelectorAll(".panel-list .board-row .nm")].map((n) => n.textContent));
	say("…and every board is under exactly one of them", once.length === new Set(once).size && once.length === rows, `${once.length} rows, ${new Set(once).size} distinct`);

	/*
	 * One column down the right edge: a section's count, a row's on-canvas dot and its delete
	 * all stand in the same 20px. The bin used to be a flex sibling, which cost the row its
	 * width and put the dot 24px inboard of the counts above it.
	 *
	 * And the swap: approaching a row hides the dot and shows the bin *in its place*, so the
	 * name beside them does not move. That last part is the assertion that matters — a row
	 * that reflows under the cursor is a row you cannot aim at.
	 */
	const column = await page.evaluate(() => {
		const mid = (el) => { const b = el.getBoundingClientRect(); return Math.round((b.left + b.right) / 2); };
		const row = document.querySelector(".board-act:has(.dot)") ?? document.querySelector(".board-act");
		return {
			count: mid(document.querySelector(".panel-meta .n")),
			dot: row.querySelector(".dot") ? mid(row.querySelector(".dot")) : null,
			bin: mid(row.querySelector(".board-del")),
		};
	});
	say(
		"the count, the dot and the bin share one column",
		column.count === column.bin && (column.dot === null || column.dot === column.bin),
		JSON.stringify(column),
	);

	const swap = await (async () => {
		const row = page.locator(".board-act:has(.dot)").first();
		if ((await row.count()) === 0) return null;
		const read = () => row.evaluate((el) => ({
			dot: getComputedStyle(el.querySelector(".dot"), "::before").opacity,
			bin: getComputedStyle(el.querySelector(".board-del")).opacity,
			name: Math.round(el.querySelector(".nm").getBoundingClientRect().width),
		}));
		const before = await read();
		await row.hover();
		await page.waitForTimeout(220);
		const after = await read();
		return { before, after };
	})();
	say(
		"approaching a row swaps the dot for the bin, in the same place",
		swap === null || (swap.before.dot === "1" && swap.before.bin === "0" && swap.after.dot === "0" && swap.after.bin === "1"),
		JSON.stringify(swap),
	);
	say("…and nothing under the cursor moves", swap === null || swap.before.name === swap.after.name, JSON.stringify(swap));

	await page.locator('[data-inset="left"] input').fill("risk");
	await page.waitForTimeout(250);
	say("the one field filters the whole list", (await page.locator(".board-row").count()) === 1, String(await page.locator(".board-row").count()));
	await page.locator('[data-inset="left"] input').fill("");

	/*
	 * Folded means gone, and the camera is told.
	 *
	 * There is no 40px strip: it existed because a hover-summoned panel needed something to
	 * aim at, and a button is that something.
	 *
	 * "Gone" is now a slide rather than an unmount — the element has to survive in order to
	 * animate out, and a panel that vanishes is a panel with no exit. So the assertions are
	 * about the two things that actually matter and *were* previously guaranteed by the
	 * unmount: it declares no inset, so the camera takes the whole window back, and it takes
	 * no clicks, so a board along the left edge is still reachable through where it was.
	 */
	const toggle = page.locator('.pill button[aria-label$="the boards panel"]').first();
	await toggle.click();
	await page.waitForFunction(() => !document.querySelector("[data-inset='left']"), null, { timeout: 4000 });
	say("folded, it declares no inset", (await mounted()) === 0);
	say("…and the camera has the whole window back", (await inset()) === "0px", await inset());
	say(
		"…and it takes no clicks where it used to be",
		await page.evaluate(() => getComputedStyle(document.querySelector(".panel-shell")).pointerEvents === "none"),
	);
	say("no 40px strip left behind", (await page.locator(".panel-strip, .strip").count()) === 0);

	/*
	 * And it comes back, inset and all.
	 *
	 * This is the regression the slide introduced and the reason it is asserted separately:
	 * measured by its painted rect, a panel that had just been asked to open was still
	 * translated off-screen when its `data-inset` returned, so the camera recorded nothing —
	 * and a transform is not a resize, so nothing measured it again. The canvas kept the
	 * whole window for the rest of the session.
	 */
	await toggle.click();
	await page.waitForSelector("[data-inset='left']", { timeout: 4000 });
	await page.waitForTimeout(300);
	say("unfolded, the camera is told again", (await inset()) === "276px", await inset());

	// ⌘K brings it back with the cursor in the field: what the modal became, minus the tab.
	await page.keyboard.press("Meta+k");
	await page.waitForSelector("[data-inset='left']", { timeout: 4000 });
	const focused = await page.evaluate(() => document.activeElement?.getAttribute("placeholder") ?? "");
	say("⌘K opens it with the cursor in the search field", /search/i.test(focused), focused);

	/*
	 * Under 1100px it is a sheet, and a sheet is not an inset.
	 *
	 * The camera check is the point: a fit that subtracts a surface covering the canvas
	 * frames the boards into the sliver beside it.
	 */
	await page.setViewportSize({ width: 900, height: 900 });
	await page.waitForTimeout(400);
	say("as a sheet it is still there", (await page.locator(".panel-shell, [data-sheet='true']").count()) >= 1);
	say("…but it declares no inset", (await mounted()) === 0 && (await inset()) === "0px", `${await mounted()} / ${await inset()}`);
	await page.keyboard.press("0");
	await page.waitForFunction(`${ZOOM_IN_PAGE} > 5`, null, { timeout: 6000 });
	say("…so fit still frames the deck at a workable zoom", (await zoom(page)) > 5, `${await zoom(page)}%`);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
