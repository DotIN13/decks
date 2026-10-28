/**
 * The side panel: a full-height column at the window's left edge, beside the canvas.
 *
 * Four tabs now — Recent, Canvas, Agents, Apps (`panel/LeftPanel.tsx`, `PANEL_TABS`) — and the
 * Canvas tab is what is on this canvas, boards then drawings, as plain rows (`.v3-item`). The old
 * boards list (the whole deck in canvas → held → deck sections, a dot/bin/hide column per row,
 * a count in each heading, the finger rail) is gone with that redesign, and so are its checks.
 *
 * The other half is the camera. A panel beside the canvas declares `data-inset="left"` and the
 * camera subtracts it; folded, it declares nothing. Both are checked, because the difference is
 * invisible until a fit goes wrong.
 */
import { open, say, settle, zoom, ZOOM_IN_PAGE, ready, rest } from "../harness.mjs";

// The panel remembers its tab on this device; this check leaves it on Canvas.
const { browser, page, errors } = await open({ width: 1400, height: 900, panelTab: "canvas" });
await ready(page);
await rest(page, { start: 0 });
try {
	const inset = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--inset-left").trim());
	const mounted = () => page.locator("[data-inset='left']").count();
	/*
	 * The published inset, waited for rather than read once: `camera/insets.ts` batches every
	 * measurement into one `requestAnimationFrame`, so a surface changing and `--inset-left`
	 * following it are a frame apart. A camera that never takes the window back still fails,
	 * one 2s timeout later, with the value it failed with.
	 */
	const settled = (expected) =>
		page
			.waitForFunction(
				(want) => getComputedStyle(document.documentElement).getPropertyValue("--inset-left").trim() === want,
				expected,
				{ timeout: 2000 },
			)
			.then(() => expected)
			.catch(() => inset());

	// 360px: `PANEL_WIDTH` in `panel/panel-width.ts`.
	const up = await settled("360px");
	say("the panel is up, and declares its width", (await mounted()) === 1 && up === "360px", up);

	/*
	 * The width is the person's. The handle straddles the panel's right edge; the canvas hears
	 * about the new width from the measured inset, so the assertion is on `--inset-left`.
	 */
	const edge = await page.locator(".panel-resize").boundingBox();
	await page.mouse.move(edge.x + 4, 400);
	await page.mouse.down();
	await page.mouse.move(edge.x + 4 + 96, 410, { steps: 6 });
	await page.mouse.up();
	say("dragging the panel's edge makes it wider, and the canvas is told", (await settled("456px")) === "456px", await inset());
	say("the width is remembered", (await page.evaluate(() => localStorage.getItem("decks.panel-width"))) === "456");
	await page.locator(".panel-resize").dblclick();
	say("a double-click on the edge puts the width back", (await settled("360px")) === "360px", await inset());
	// The default is stored as nothing, so a later change to it reaches everyone who never chose.
	say("…and forgets the width it had", (await page.evaluate(() => localStorage.getItem("decks.panel-width"))) === null);

	const tabs = await page.locator('.panel-shell [role="tab"]').allInnerTexts();
	say("four tabs: Recent, Canvas, Agents, Apps", JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(["Recent", "Canvas", "Agents", "Apps"]), JSON.stringify(tabs));
	const selected = await page.evaluate(() => [...document.querySelectorAll('.panel-shell [role="tab"]')].filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.textContent.trim()));
	say("…and the panel opens on the tab it was left on", JSON.stringify(selected) === JSON.stringify(["Canvas"]), JSON.stringify(selected));

	// v3: 30px tabs and a 32px search (`styles/v3.css`, `.v3-nav-tab`, `.v3-search`).
	const header = await page.evaluate(() => ({
		strip: Math.round(document.querySelector(".panel-shell .v3-nav-tab")?.getBoundingClientRect().height ?? 0),
		field: Math.round(document.querySelector(".panel-shell .v3-search")?.getBoundingClientRect().height ?? 0),
	}));
	say("the tabs are 30px and the field 32px", header.strip === 30 && header.field === 32, JSON.stringify(header));

	/*
	 * The Canvas tab is what is on this canvas: one row per board under "Boards", and the
	 * heading's count is the rows'. The stage's own list (`__decksBoards`) is the reference.
	 */
	const listed = await page.evaluate(() => {
		const rows = [...document.querySelectorAll('.panel-list[data-tab="canvas"] .v3-item[data-kind="board"]')];
		const head = [...document.querySelectorAll('.panel-list[data-tab="canvas"] .v3-sec')].find((sec) => sec.textContent.startsWith("Boards"));
		return {
			rows: rows.length,
			names: rows.map((row) => row.textContent.trim()),
			count: Number(head?.querySelector(".v3-sec-n")?.textContent ?? NaN),
			stage: (window.__decksBoards?.() ?? []).length,
		};
	});
	say("the Canvas tab lists every board on the canvas, once", listed.rows >= 1 && listed.rows === listed.stage && new Set(listed.names).size === listed.rows, JSON.stringify(listed));
	say("…and the Boards heading counts them", listed.count === listed.rows, JSON.stringify(listed));

	// The one field filters the tab: a word from one board's name leaves that board.
	const word = (listed.names[0] ?? "").split(/[^A-Za-z]+/).filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)[0] ?? "";
	await page.locator('[data-inset="left"] input').fill(word);
	await page.waitForTimeout(250);
	const filtered = await page.locator('.panel-list[data-tab="canvas"] .v3-item').allInnerTexts();
	say("the one field filters the list", word !== "" && filtered.length >= 1 && filtered.every((name) => name.toLowerCase().includes(word.toLowerCase())), `"${word}" → ${JSON.stringify(filtered)}`);
	await page.locator('[data-inset="left"] input').fill("zzzz-nothing-is-called-this");
	await page.waitForTimeout(250);
	say("…and a word nothing has empties it", (await page.locator('.panel-list[data-tab="canvas"] .v3-item').count()) === 0);
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
	await page.locator('button[aria-label="Hide the side panel"]').first().click();
	await page.waitForFunction(() => !document.querySelector("[data-inset='left']"), null, { timeout: 4000 });
	say("folded, it declares no inset", (await mounted()) === 0);
	const freed = await settled("0px");
	say("…and the camera has the whole window back", freed === "0px", freed);
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
	await page.locator('button[aria-label="Show the side panel"]').first().click();
	await page.waitForSelector("[data-inset='left']", { timeout: 4000 });
	const told = await settled("360px");
	say("unfolded, the camera is told again", told === "360px", told);

	// ⌘K brings it back with the cursor in the field: what the modal became, minus the tab.
	await page.keyboard.press("Meta+k");
	await page.waitForSelector("[data-inset='left']", { timeout: 4000 });
	/*
	 * …and the cursor, which lands on the frame after the panel is in the document.
	 *
	 * `LeftPanel`'s own note says so: "Next frame, or there is nothing to focus yet on a panel
	 * that was closed." So the element existing and the field having the cursor are a frame
	 * apart, and reading `activeElement` once, immediately after the wait above, is the same
	 * coin toss the inset assertions used to lose — which is where this check went next, once
	 * the camera one stopped failing.
	 */
	const inField = () => page.evaluate(() => document.activeElement?.getAttribute("placeholder") ?? "");
	const focused = await page
		.waitForFunction(() => /search/i.test(document.activeElement?.getAttribute("placeholder") ?? ""), null, { timeout: 2500 })
		.then(inField)
		.catch(inField);
	say("⌘K opens it with the cursor in the search field", /search/i.test(focused), focused);

	/*
	 * Under 1100px it used to become a sheet over the canvas, declaring no inset. There is no sheet
	 * any more: a narrow window keeps the same column beside the canvas, and so it still declares
	 * its width — and fit, which subtracts it, must still frame the boards at a workable zoom.
	 */
	await page.setViewportSize({ width: 900, height: 900 });
	say("in a narrow window the panel is still there", (await page.locator(".panel-shell").count()) >= 1);
	const narrow = await settled("360px");
	say("…still a column beside the canvas, declaring its width", (await mounted()) === 1 && narrow === "360px", `${await mounted()} / ${narrow}`);
	await page.keyboard.press("0");
	await page.waitForFunction(`${ZOOM_IN_PAGE} > 5`, null, { timeout: 6000 });
	say("…so fit still frames the deck at a workable zoom", (await zoom(page)) > 5, `${await zoom(page)}%`);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}

// The coarse-pointer block (the finger rail of dot, bin and count) went with the boards list it measured.
