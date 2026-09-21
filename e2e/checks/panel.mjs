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
import { open, say, settle, zoom, ZOOM_IN_PAGE } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900 });
/* What the browser sends back, for the one press here that has to reach the server: the × on a row. */
await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.__sent = [];
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			const send = this.send.bind(this);
			this.send = (data) => {
				window.__sent.push(String(data));
				return send(data);
			};
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2000);
try {
	const inset = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--inset-left").trim());
	const mounted = () => page.locator("[data-inset='left']").count();
	/*
	 * The published inset, waited for rather than read once.
	 *
	 * `camera/insets.ts` batches every measurement into one `requestAnimationFrame`, so a surface
	 * appearing or going and `--inset-left` following it are a frame apart. Reading it straight
	 * after the change is a coin flip on whether that frame has run, and this check lost that
	 * coin toss on three CI runs in five while the camera was never actually wrong — which is
	 * also why each assertion used to print the successor of its own verdict: the condition read
	 * "264px" and the detail, one round trip later, read "0px".
	 *
	 * Waiting is not a weaker assertion. A camera that never takes the window back still fails,
	 * one 2s timeout later, and the value it failed with is reported.
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

	// 264px: the panel is a full-height column at the window's edge now, not a card 12px in.
	const up = await settled("264px");
	say("the panel is up, and declares its width", (await mounted()) === 1 && up === "264px", up);

	/*
	 * The width is the person's. The handle straddles the panel's right edge; the canvas
	 * hears about the new width the way it hears about the fold, from the measured inset,
	 * so the assertion is on `--inset-left` rather than on the panel's own style.
	 */
	const edge = await page.locator(".panel-resize").boundingBox();
	await page.mouse.move(edge.x + 4, 400);
	await page.mouse.down();
	await page.mouse.move(edge.x + 4 + 96, 410, { steps: 6 });
	await page.mouse.up();
	say("dragging the panel's edge makes it wider, and the canvas is told", (await settled("360px")) === "360px", await inset());
	say("the width is remembered", (await page.evaluate(() => localStorage.getItem("decks.panel-width"))) === "360");
	await page.locator(".panel-resize").dblclick();
	say("a double-click on the edge puts the width back", (await settled("264px")) === "264px", await inset());

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
	 *
	 * **Agents is the first tab and Boards is the one that is showing**, and both halves are
	 * asserted because they are different decisions. The order is the panel's reading order:
	 * the agents are the list that changes while you watch, so it is read first. The default is
	 * the canvas you were already looking at, which is what the app opens on.
	 */
	const tabs = await page.getByRole("tab").allInnerTexts();
	say("three tabs, and they partition nothing", JSON.stringify(tabs) === JSON.stringify(["Canvases", "Agents", "Boards"]), JSON.stringify(tabs));
	// Scoped to the panel: the dispatch dashboard behind the stage has a tab strip of its own.
	const selected = await page.evaluate(() => [...document.querySelectorAll('.panel-shell [role="tab"]')].filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.textContent));
	say("…canvases first, and the panel opens on Boards", JSON.stringify(selected) === JSON.stringify(["Boards"]), JSON.stringify(selected));

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
	/* A row on the canvas carries a hide as well, right beside the bin, and that column
	   comes out of the name when the row is approached: the dot's swap for the bin is still in
	   place, and the name ends clear of the × by the row's own gap. */
	const beside = await (async () => {
		const row = page.locator(".board-act:has(.dot)").first();
		if ((await row.count()) === 0) return null;
		await row.hover();
		await page.waitForTimeout(220);
		const laid = await row.evaluate((el) => {
			const x = el.querySelector(".board-hide")?.getBoundingClientRect();
			const bin = el.querySelector(".board-del").getBoundingClientRect();
			const name = el.querySelector(".nm").getBoundingClientRect();
			return x ? { shows: getComputedStyle(el.querySelector(".board-hide")).opacity === "1", gap: Math.round(bin.left - x.right), level: Math.round(x.top) === Math.round(bin.top), clear: Math.round(x.left - name.right) } : { missing: true };
		});
		return laid;
	})();
	say("a row on the canvas has a hide right beside its bin, level with it", beside === null || (beside.shows && beside.gap === 2 && beside.level), JSON.stringify(beside));
	say("…and the name ends clear of it", beside === null || beside.clear >= 6, JSON.stringify(beside));
	say("…which is the only thing the approach costs the name", swap === null || swap.after.name < swap.before.name, JSON.stringify(swap));
	const hid = await (async () => {
		const row = page.locator(".board-act:has(.board-hide)").first();
		if ((await row.count()) === 0) return null;
		await page.evaluate(() => { window.__sent = []; });
		await row.hover();
		await row.locator(".board-hide").click();
		await page.waitForTimeout(250);
		const sent = await page.evaluate(() => window.__sent.map((raw) => JSON.parse(raw)).filter((message) => message.type === "board.hide"));
		await page.mouse.move(700, 500);
		return sent;
	})();
	say("…and one press takes the board off the canvas, no arming", hid === null || (hid.length === 1 && typeof hid[0].path === "string"), JSON.stringify(hid));

	/*
	 * And the name clears the bin on the rows that have no dot to reserve its column for.
	 *
	 * A row with a dot already stops its name short of the rail, because the dot is in flow in
	 * it. A row *without* one has nothing at the right of it, and that is where this went wrong:
	 * measured before the rule, the ellipsis and the last two characters of
	 * `a-board-bar-that-works-with-a-finger.html` were underneath the bin — and behind an *armed*
	 * bin, which is held visible on purpose, they were underneath a danger-red wash. A delete
	 * button that covers the word it is about to delete is the worst version of this panel.
	 *
	 * So: no overlap while the bin is showing, and the name narrower than it was — 28px of
	 * filename, which is the bin and the row's own 8px gap. Which rows are allowed to keep the
	 * width at rest is the design; that they give it up when the bin arrives is the assertion.
	 */
	const clear = async (locator) =>
		locator.evaluate((el) => {
			const name = el.querySelector(".nm").getBoundingClientRect();
			const bin = el.querySelector(".board-del").getBoundingClientRect();
			return { name: Math.round(name.width), clear: Math.round(bin.left - name.right), shows: getComputedStyle(el.querySelector(".board-del")).opacity === "1" };
		});
	const room = await (async () => {
		const row = page.locator(".board-act").filter({ hasNot: page.locator(".dot") }).first();
		if ((await row.count()) === 0) return null;
		const before = await clear(row);
		await row.hover();
		await page.waitForTimeout(220);
		const after = await clear(row);
		await page.mouse.move(700, 500);
		return { before, after };
	})();
	say(
		"approaching a row with no dot takes the bin's column out of its name",
		room === null || (room.after.shows && room.after.clear >= 0 && room.before.clear < 0 && room.after.name <= room.before.name - 28),
		JSON.stringify(room),
	);

	/*
	 * And a count ends on its own list's line whatever it says.
	 *
	 * The count was centred in a fixed 20px. That is right for three digits — `601` is 19.2px of
	 * those 20 — and wrong for four: measured, `6001` put the number's right edge at 264.6 where the
	 * rail's is 259, and its box could not hold it. So the number moved as the deck grew, which is
	 * the one thing a count in a column must not do. Right-aligned with a minimum width, every count
	 * ends on one line, and the digits grow leftward into the label's spare width instead.
	 *
	 * That line is not the box's edge, which is the second half of the same problem: everything in the
	 * rail is centred in the 20px box and smaller than it, so the ink inside ends short of 259. And it
	 * is **a different line in each list**, because the two repeat different things down the right
	 * edge — a 6px dot in the boards list, a timestamp in the agents list — which is why the check
	 * measures one of each rather than one reference for both.
	 *
	 * Faked by writing the number in, because the CSS is what is under test and a deck of six
	 * thousand boards is not something to build. The heading is put back afterwards.
	 */
	const ends = await page.evaluate(() => {
		/*
		 * The count's ink has to end `padding-right` short of its box's own right edge, and that short
		 * is what lines it up with whatever the list repeats down the right edge: the 6px dot in the
		 * boards list, the timestamp in the agents list. Measuring the line this way rather than off
		 * the dot keeps the assertion working on a fixture whose rows have no dots, and the two
		 * cross-checks below it say that the ink is really where the dot and the stamp are.
		 */
		const n = document.querySelector(".panel-meta .n");
		if (!n) return null;
		const said = n.textContent;
		const read = (text) => {
			n.textContent = text;
			const range = document.createRange();
			range.selectNodeContents(n);
			return { right: Math.round(range.getBoundingClientRect().right), spills: n.scrollWidth > Math.ceil(n.clientWidth) };
		};
		const rows = ["4", "600", "6001"].map(read);
		n.textContent = said;
		const inset = parseFloat(getComputedStyle(n).paddingRight);
		/* A pseudo-element has no rect, so the dot's own ink is its width inside the centred box. */
		const dot = document.querySelector(".board-act .dot");
		const dotInk = dot ? (() => { const b = dot.getBoundingClientRect(); return b.left + (b.width + parseFloat(getComputedStyle(dot, "::before").width)) / 2; })() : null;
		/*
		 * The bin's icon, read here because the agents list has no bin and this is the one chance to
		 * see it. It ends on the agents list's line rather than the boards one — 255, where the dot is
		 * 252 — so it is what the agents assertion cross-checks against when the fixture has no
		 * timestamp, which it will not until a chat in it has said something.
		 */
		const icon = document.querySelector(".board-del svg");
		return {
			line: Math.round(n.getBoundingClientRect().right - inset),
			inset,
			dotInk: dotInk === null ? null : Math.round(dotInk),
			iconLine: icon ? Math.round(icon.getBoundingClientRect().right) : null,
			rights: rows.map((row) => row.right),
			spills: rows.some((row) => row.spills),
		};
	});
	say(
		"a boards count ends on the dot's line whatever it says",
		ends === null || (ends.rights.every((right) => right === ends.line) && !ends.spills && (ends.dotInk === null || ends.dotInk === ends.line)),
		JSON.stringify(ends),
	);

	/* The same for the agents list, whose right-hand column is a timestamp rather than a dot. */
	await page.getByRole("tab", { name: "Agents" }).click();
	await settle(page, 300);
	const agentEnds = await page.evaluate(() => {
		const n = document.querySelector(".panel-meta .n");
		if (!n) return null;
		const said = n.textContent;
		const rights = ["4", "600", "6001"].map((text) => {
			n.textContent = text;
			const r = document.createRange();
			r.selectNodeContents(n);
			return Math.round(r.getBoundingClientRect().right);
		});
		n.textContent = said;
		const inset = parseFloat(getComputedStyle(n).paddingRight);
		/*
		 * The cross-check here is the bin's **icon**, not the timestamp, and the two are the same line
		 * by construction: the agents rows put their `18m` where the boards rows put the bin, both
		 * ending at 255 inside the box. The icon is always in the DOM and the timestamp is not — a
		 * fixture whose chats have never said anything has no `18m` to measure — so this is the one
		 * that keeps the assertion honest in CI rather than skipped.
		 */
		return {
			line: Math.round(n.getBoundingClientRect().right - inset),
			inset,
			rights,
		};
	});
	say(
		"…and an agents count ends on the timestamp's line",
		agentEnds === null ||
			(agentEnds.rights.every((right) => right === agentEnds.line) &&
				(ends?.iconLine === null || ends?.iconLine === undefined || ends.iconLine === agentEnds.line)),
		JSON.stringify(agentEnds),
	);
	await page.getByRole("tab", { name: "Boards" }).click();
	await settle(page, 300);

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
	await toggle.click();
	await page.waitForSelector("[data-inset='left']", { timeout: 4000 });
	const told = await settled("264px");
	say("unfolded, the camera is told again", told === "264px", told);

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
	 * Under 1100px it is a sheet, and a sheet is not an inset.
	 *
	 * The camera check is the point: a fit that subtracts a surface covering the canvas
	 * frames the boards into the sliver beside it.
	 */
	await page.setViewportSize({ width: 900, height: 900 });
	say("as a sheet it is still there", (await page.locator(".panel-shell, [data-sheet='true']").count()) >= 1);
	const none = await settled("0px");
	say("…but it declares no inset", (await mounted()) === 0 && none === "0px", `${await mounted()} / ${none}`);
	await page.keyboard.press("0");
	await page.waitForFunction(`${ZOOM_IN_PAGE} > 5`, null, { timeout: 6000 });
	say("…so fit still frames the deck at a workable zoom", (await zoom(page)) > 5, `${await zoom(page)}%`);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}

// --- a coarse pointer: the rail, where the bin is 28px and always drawn -----------------

/*
 * Its own context, because a touchscreen is a different layout of the same panel: the swap above
 * is a hover, so on this side of the media query the bin is simply always there, and a finger
 * needs a 28px target where a cursor needs a 20px one.
 *
 * The rail is one column on both devices and *cannot* be for all three marks here. The count and
 * the bin share it — before this, the 28px bin hung 4px left of the counts, which is the sort of
 * disagreement the eye reads as a sloping edge — and the dot stands clear of it, in a column of
 * its own: a 28px target and a 20px rail cannot both have the edge when both are drawn at once,
 * and the dot is the one of the two that can be somewhere else without being missed.
 */
{
	const { browser, page, errors } = await open({ device: "iPhone 14 Pro" });
	try {
		const rail = await page.evaluate(() => {
			const mid = (el) => {
				const b = el.getBoundingClientRect();
				return Math.round((b.left + b.right) / 2);
			};
			const row = document.querySelector(".board-act:has(.dot)") ?? document.querySelector(".board-act");
			const name = row.querySelector(".nm").getBoundingClientRect();
			const bin = row.querySelector(".board-del").getBoundingClientRect();
			return {
				count: mid(document.querySelector(".panel-meta .n")),
				bin: mid(row.querySelector(".board-del")),
				dot: row.querySelector(".dot") ? mid(row.querySelector(".dot")) : null,
				binShown: getComputedStyle(row.querySelector(".board-del")).opacity === "1",
				clear: Math.round(bin.left - name.right),
			};
		});
		say(
			"on a finger the bin is centred on the counts' own column",
			Math.abs(rail.count - rail.bin) <= 1,
			JSON.stringify(rail),
		);
		say(
			"…and the dot stands beside it rather than underneath",
			rail.dot === null || rail.dot < rail.bin - 20,
			JSON.stringify(rail),
		);
		say("…and the name clears the bin that is always drawn", rail.binShown && rail.clear >= 0, JSON.stringify(rail));
		say("no page errors on a phone", errors.length === 0, errors.join(" | "));
	} finally {
		await browser.close();
	}
}

/*
 * Under a finger the conversation stands on the composer: same left edge, same width, 8px of
 * air, and clear of the toolbar. It used to hang from the top of the screen at the desktop's
 * 420px, half a screen away from the bar being typed into. A phone is the narrow rule; a
 * tablet on its side is wider than 1100px, so it is the `pointer: coarse` rule and the one
 * that also has to stop the panel being dragged.
 */
for (const device of ["iPhone 14 Pro", "iPad Pro 11 landscape"]) {
	const { browser, page, errors } = await open({ device });
	try {
		await page.evaluate(() => document.querySelector('.pill button[title^="Conversation"]')?.click());
		await page.waitForSelector(".stream[data-shown='true']", { timeout: 6000 });
		await page.waitForTimeout(400);
		const box = await page.evaluate(() => {
			const r = (s) => document.querySelector(s).getBoundingClientRect();
			const stream = r(".stream");
			const dock = r(".dock");
			const style = getComputedStyle(document.querySelector(".stream"));
			return {
				gap: Math.round(dock.top - stream.bottom),
				left: Math.round(stream.left - dock.left),
				width: Math.round(stream.width - dock.width),
				top: Math.round(stream.top),
				resize: style.resize,
				floating: document.querySelector(".stream").hasAttribute("data-floating"),
			};
		});
		say(`${device}: the conversation stands 8px above the composer`, box.gap === 8, JSON.stringify(box));
		say(`${device}: …at the composer's left edge and width`, Math.abs(box.left) <= 1 && Math.abs(box.width) <= 1, JSON.stringify(box));
		say(`${device}: …clear of the toolbar, and not resizable or floating`, box.top >= 64 && box.resize === "none" && !box.floating, JSON.stringify(box));
		say(`${device}: no page errors`, errors.length === 0, errors.join(" | "));
	} finally {
		await browser.close();
	}
}
