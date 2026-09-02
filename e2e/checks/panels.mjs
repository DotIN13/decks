/**
 * The chrome down the left: two panels, one at a time, and pills when neither is up (§7).
 *
 * The panels are **toggled**, not reached for. They used to appear when the cursor came
 * within 26px of the left edge, which was a good trick while the panel was the only way to
 * see an agent and is incompatible with what replaced that — hiding the list leaves pills in
 * the same corner, so a panel arriving on a stray cursor movement would cover the very thing
 * hiding it was for. What is asserted here is the toggle, the mutual exclusion, and that the
 * pills stand in for the list rather than beside it.
 *
 * The rest of this file is the chat list's own design — the row, the mark, the unread dot,
 * the close button — which the split did not change. It just has to be opened with a button
 * now.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

const isOpen = (selector) => page.evaluate((s) => document.querySelector(s)?.dataset.open === "true", selector);
const onScreen = (selector) =>
	page.evaluate((s) => {
		const element = document.querySelector(s);
		if (!element) return null;
		const box = element.getBoundingClientRect();
		return {
			left: Math.round(box.left),
			right: Math.round(box.right),
			visibleWidth: Math.round(Math.min(box.right, innerWidth) - Math.max(box.left, 0)),
		};
	}, selector);
const AGENTS = '.titlebar button[title="The agents"]';
const CONTEXT = '.titlebar button[title="Boards this agent is holding"]';
const ALL = '.titlebar button[title="Every board in the deck"]';
const agentsPanel = ".side:not(.context)";
const toggle = async (selector, wanted) => {
	await page.locator(selector).click();
	await page.waitForFunction(
		([panel, want]) => document.querySelector(panel)?.dataset.open === String(want),
		[selector === CONTEXT ? ".side.context" : agentsPanel, wanted],
		{ timeout: 4000 },
	);
	await settle(page, 220);
};

// --- 1. away by default, and nothing is hiding at an edge --------------------------

await page.mouse.move(700, 480);
await settle(page, 260);
say("the agent list is away by default", (await isOpen(agentsPanel)) === false, JSON.stringify(await onScreen(agentsPanel)));
say("the boards panel is away too", (await isOpen(".side.context")) === false);
say("the conversation is away by default", (await isOpen(".chat-float")) === false);

/*
 * Closed means *gone*, not a sliver.
 *
 * There used to be 10px of panel left on screen, because a cursor needs something to aim
 * at. A button needs nothing to aim at, so the panel is fully off — and a strip of chrome
 * down the edge of a canvas that no longer does anything is just a strip of chrome.
 */
const away = await onScreen(agentsPanel);
say("and nothing of it is left on screen", away.visibleWidth <= 0, `${away.visibleWidth}px showing`);

/*
 * Reaching the edge does nothing at all now, which is the assertion that would have caught
 * the old behaviour surviving the rewrite.
 */
await page.mouse.move(4, 480);
await settle(page, 500);
say("reaching the left edge no longer summons anything", (await isOpen(agentsPanel)) === false);
await page.mouse.move(700, 480);
await settle(page, 200);

// --- 2. the buttons, and one corner between them ----------------------------------

await toggle(AGENTS, true);
say("the agents button brings the list out", await isOpen(agentsPanel));
say("…and it stays when the cursor leaves", await (async () => {
	await page.mouse.move(900, 700);
	await settle(page, 400);
	return isOpen(agentsPanel);
})());
say("…and says so on the button", (await page.locator(AGENTS).getAttribute("aria-pressed")) === "true");

await page.locator(CONTEXT).click();
await page.waitForFunction(() => document.querySelector(".side.context")?.dataset.open === "true", null, { timeout: 4000 });
await settle(page, 220);
say("the boards button brings the boards out", await isOpen(".side.context"));
say("…and closes the agents, because it is the same 200px", (await isOpen(agentsPanel)) === false);
say("the choice is remembered", (await page.evaluate(() => localStorage.getItem("decks.panel.context"))) === "open");

await page.locator(CONTEXT).click();
await page.waitForFunction(() => document.querySelector(".side.context")?.dataset.open === "false", null, { timeout: 4000 });
await settle(page, 220);
say("pressing it again puts it away", (await isOpen(".side.context")) === false);

// --- 3. the pills, which are what a closed list leaves behind ---------------------

/*
 * A pill per agent that is working, plus the focused agent's newest reply until it is waved
 * away. With no agent running and nothing said, there is nothing to report — which is the
 * state a fresh check starts in, so what is asserted is the *rule*: the pills and the list
 * are never both up.
 */
await toggle(AGENTS, true);
say("no pills while the list is up", (await page.locator(".pill").count()) === 0);
await toggle(AGENTS, false);
const pills = await page.locator(".pill").count();
say("the pills stand in for the list, not beside it", pills >= 0, `${pills} pill(s) with the list closed`);

// --- 4. every board in the deck, searchable --------------------------------------

await page.locator(ALL).click();
await page.waitForSelector(".all-boards", { timeout: 5000 });
await settle(page, 600);
const boards = await page.locator(".all-boards .rail-item").count();
say("the modal lists the whole deck", boards >= 2, `${boards} boards`);
const term = await page.evaluate(() => document.querySelector(".all-boards .rail-item .file")?.textContent?.replace("boards/", "").slice(0, 4) ?? "");
await page.locator(".all-boards input").fill(term);
await settle(page, 300);
const narrowed = await page.locator(".all-boards .rail-item").count();
say("searching narrows it", narrowed > 0 && narrowed <= boards, `“${term}” → ${narrowed} of ${boards}`);
await page.locator(".all-boards input").fill("zzzzz");
await settle(page, 250);
say("and it says so when nothing matches", (await page.locator(".all-boards").innerText()).includes("Nothing in the deck matches"));
await page.keyboard.press("Escape");
await settle(page, 300);
say("Escape closes it", (await page.locator(".all-boards").count()) === 0);

// --- 5. the palette must not sit under a panel that can appear over it ------------

await page.evaluate(() => document.querySelector(".rail-item")?.click());
await page.waitForSelector(".palette", { state: "visible", timeout: 8000 });
const palette = await onScreen(".palette");
say("the palette sits clear of the panels", palette.left > 220, JSON.stringify(palette));

/*
 * Every icon-only button still says what it is.
 *
 * The chrome's controls used to be text glyphs — `▹`, `+`, `×` — which were their own
 * accessible names, badly. Now they are Lucide SVGs, and an SVG has no name at all unless
 * one is given: `aria-hidden` is Lucide's default, so a button with nothing but an icon in it
 * reads as blank to a screen reader and matches nothing in a check. This runs with the agent
 * list out and the palette up, so it covers the three panel buttons, the `+`, the tools and
 * the zoom bar in one pass.
 */
await toggle(AGENTS, true);
const nameless = await page.evaluate(() =>
	[...document.querySelectorAll("button")]
		.filter((button) => button.textContent.trim() === "" && button.querySelector("svg"))
		.filter((button) => !button.getAttribute("aria-label") && !button.getAttribute("title"))
		.map((button) => button.className || button.outerHTML.slice(0, 60)),
);
say("every icon-only button has an accessible name", nameless.length === 0, nameless.join(" | "));

/*
 * The two panel headers, which are the same design and were not the same code.
 *
 * `.chats` is `.rail`'s sibling, so `.rail .rail-head` never matched the agent list: its
 * header was a plain block with a `flex: 1` spacer that measured zero, so the label was
 * body text and all three controls crowded against it with the right half of the row empty.
 */
await settle(page, 300);

const heads = await page.evaluate(() => {
	const read = (selector) => {
		const head = document.querySelector(selector);
		if (!head) return null;
		const style = getComputedStyle(head);
		const label = head.firstElementChild;
		const labelStyle = getComputedStyle(label);
		const box = head.getBoundingClientRect();
		/*
		 * The *last control*, not the group that holds it. A `display: flex` group is
		 * block-level, so with the header laid out as a block its own right edge is in the
		 * right place while everything inside it sits left — which is the bug, and this
		 * assertion passed straight through it until it looked one level deeper.
		 */
		const controls = head.lastElementChild;
		const last = (controls.lastElementChild ?? controls).getBoundingClientRect();
		return {
			display: style.display,
			// How much empty room is left to the right of the last control.
			trailing: Math.round(box.right - parseFloat(style.paddingRight) - last.right),
			labelSize: labelStyle.fontSize,
			labelTransform: labelStyle.textTransform,
			labelLeft: Math.round(label.getBoundingClientRect().left - box.left),
		};
	};
	return { agents: read(".chats .rail-head"), boards: read(".rail .rail-head") };
});

say("the agent header is a row, not a block", heads.agents.display === "flex", heads.agents.display);
say("its controls sit at the right edge", Math.abs(heads.agents.trailing) <= 2, `${heads.agents.trailing}px of room left over`);
say(
	"both panel headers label the same way",
	heads.agents.labelSize === heads.boards.labelSize && heads.agents.labelTransform === heads.boards.labelTransform,
	`agents ${heads.agents.labelSize}/${heads.agents.labelTransform} vs boards ${heads.boards.labelSize}/${heads.boards.labelTransform}`,
);

// The runtime chip: what `+` will create, shown as that runtime's mark.
const chip = await page.evaluate(() => {
	const kind = document.querySelector(".chats .rail-head .kind");
	const mark = kind.querySelector("svg[data-agent]");
	const chevron = [...kind.querySelectorAll("svg")].find((svg) => !svg.dataset.agent);
	return {
		agent: mark?.dataset.agent,
		// The mark is the same width whichever runtime it is, so the chevron sits against
		// it — a text label showing "pi" while "claude" existed left a gap here.
		markToChevron: mark && chevron ? Math.round(chevron.getBoundingClientRect().left - mark.getBoundingClientRect().right) : null,
		selectCovers: (() => {
			const box = kind.getBoundingClientRect();
			const select = kind.querySelector("select").getBoundingClientRect();
			return Math.round(select.width) === Math.round(box.width) && Math.round(select.height) === Math.round(box.height);
		})(),
		named: kind.querySelector("select").getAttribute("aria-label"),
	};
});
say("the chip shows the mark of what + will create", chip.agent === "pi", String(chip.agent));
say("…with the chevron against it", chip.markToChevron !== null && chip.markToChevron >= 0 && chip.markToChevron <= 4, `${chip.markToChevron}px`);
say("…and the real control still covers it", chip.selectCovers);
say("…and is still named for a screen reader", Boolean(chip.named), chip.named ?? "");

// Choosing a runtime creates an agent on it. It stays reachable by keyboard because the
// select is only invisible, not replaced.
const before = await page.evaluate(() => document.querySelectorAll(".chat-row").length);
await page.selectOption(".chats .rail-head .kind select", "claude");
await page.waitForFunction((was) => document.querySelectorAll(".chat-row").length > was, before, { timeout: 8000 });
// Read from `data-agent` rather than from text: the badge is a mark now.
const kinds = await page.evaluate(() => [...document.querySelectorAll(".chat-row .runtime svg")].map((s) => s.dataset.agent));
say("choosing a runtime creates an agent on it", kinds.includes("claude"), kinds.join(" "));
say(
	"…and the chip goes back to the default",
	(await page.evaluate(() => document.querySelector(".chats .rail-head .kind svg[data-agent]")?.dataset.agent)) === "pi",
);

/*
 * The mark leads the row, and the two runtimes' marks are optically the same size.
 *
 * They are drawn in different boxes with different amounts of air — Claude's burst fills its
 * 100 box, Pi's glyph uses 59% of an 800 box — so "the same size" has to be checked as ink,
 * not as the frame each is rendered into.
 */
const row = await page.evaluate(() => {
	const top = document.querySelector(".chat-row .top");
	const kids = [...top.children].map((c) => c.className);
	const inks = [...document.querySelectorAll(".chat-row .runtime svg")].map((svg) => {
		// The *rendered* ink, not `getBBox`, which reports the geometry before the transform
		// that scales each drawing into the frame — 100 for Claude against 469 for Pi.
		const frame = svg.getBoundingClientRect();
		const drawn = svg.querySelector("g").getBoundingClientRect();
		const units = (Math.max(drawn.width, drawn.height) / frame.width) * 24;
		return { agent: svg.dataset.agent, ink: Math.round(units * 10) / 10 };
	});
	/*
	 * Where the ink sits against the text, which is the thing the eye judges.
	 *
	 * The row is `align-items: baseline` — right for the name and the time, two runs of text
	 * at different sizes — and an SVG has no baseline, so a browser sits its bottom edge on
	 * the text's and the mark rides 2.5px high. Measured as ink rather than as the frame,
	 * because the frame has air in it.
	 */
	const mark = top.querySelector(".runtime svg");
	const name = top.querySelector(".name");
	const drawn = mark.querySelector("g").getBoundingClientRect();
	const nameBox = name.getBoundingClientRect();
	const offBy = Math.abs(drawn.top + drawn.height / 2 - (nameBox.top + nameBox.height / 2));
	return {
		kids,
		inks,
		offBy: Math.round(offBy * 10) / 10,
		name: nameBox.left,
		mark: top.querySelector(".runtime")?.getBoundingClientRect().left,
	};
});
say("the mark leads the row", row.kids[0] === "runtime", row.kids.join(" · "));
/*
 * The right of a row is the × and nothing else.
 *
 * The timestamp is gone and the unread count moved onto the avatar: two things competing
 * for that corner is how a click lands on the wrong one. The count only renders when there
 * is one, so what is checked here is that its *place* is the avatar — `.face` is the
 * wrapper that exists solely to hold it, since the avatar clips to its circle.
 */
say("the row's top line is the mark and the name", row.kids.join(" ") === "runtime name", row.kids.join(" · "));
const right = await page.evaluate(() => {
	const wrap = document.querySelector(".chat-row-wrap");
	const face = wrap.querySelector(".face");
	const avatar = wrap.querySelector(".avatar");
	/*
	 * Asked as "what is at the right", not "whose box reaches the right".
	 *
	 * `.who` and `.name` are stretched containers — they reach the edge by design and paint
	 * nothing there — so measuring boxes flagged them and said nothing about what a person
	 * sees or clicks. What matters is that the × is the only thing there to hit, and that
	 * the two things that used to be are gone.
	 */
	const rightmost = [...wrap.querySelectorAll("button")].sort(
		(a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right,
	)[0];
	return {
		timestamps: wrap.querySelectorAll(".when").length,
		unreadOutsideAvatar: [...wrap.querySelectorAll(".unread")].filter((el) => !face?.contains(el)).length,
		rightmostIsClose: rightmost?.classList.contains("close") ?? false,
		buttons: [...wrap.querySelectorAll("button")].map((b) => b.className).join(" · "),
		faceHoldsTheBadgeSlot: Boolean(face) && face.contains(avatar) && getComputedStyle(face).position === "relative",
	};
});
say("no timestamp is left in a row", right.timestamps === 0);
say("the × is the rightmost thing to click", right.rightmostIsClose, right.buttons);
say("no unread count sits outside the avatar", right.unreadOutsideAvatar === 0);
say("the unread count's place is the avatar", right.faceHoldsTheBadgeSlot);

/*
 * The dot must not cover the face it reports on.
 *
 * Injected rather than earned with a real turn, because this is about geometry: a numbered
 * badge here was 16px on a 26px avatar, which is what "obscuring" meant. The dot's own
 * rendering with a real unread count is checked by hand.
 */
const dot = await page.evaluate(() => {
	const face = document.querySelector(".chat-row .face");
	const probe = document.createElement("span");
	probe.className = "unread";
	face.append(probe);
	const box = probe.getBoundingClientRect();
	const avatar = face.querySelector(".avatar").getBoundingClientRect();
	const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	const radius = avatar.width / 2;
	const from = Math.hypot(centre.x - (avatar.left + radius), centre.y - (avatar.top + radius));
	probe.remove();
	return {
		size: Math.round(box.width),
		avatar: Math.round(avatar.width),
		coverage: Math.round(((box.width * box.height) / (Math.PI * radius * radius)) * 100),
		// Sat on the arc: its centre a hair from the edge, so half of it is off the face.
		offArc: Math.round(Math.abs(from - radius) * 10) / 10,
		empty: probe.textContent === "",
	};
});
say("the unread mark is a dot, not a badge", dot.size <= 10, `${dot.size}px on a ${dot.avatar}px avatar`);
say("…covering little of the avatar", dot.coverage <= 15, `${dot.coverage}% of the face`);
say("…and sitting on its edge rather than over it", dot.offArc <= 2, `${dot.offArc}px off the arc`);
say("…with no number in it", dot.empty);
say("…before the name", row.mark !== undefined && row.name !== undefined && row.mark < row.name);
const claudeInk = row.inks.find((i) => i.agent === "claude")?.ink;
const piInk = row.inks.find((i) => i.agent === "pi")?.ink;
say("the mark's ink centres on the name beside it", row.offBy <= 1, `${row.offBy}px off the text's centre`);
say(
	"the two marks are drawn to their own optical sizes",
	claudeInk !== undefined && piInk !== undefined && claudeInk > piInk && claudeInk / piInk < 1.3,
	`claude ${claudeInk} vs pi ${piInk} units of a 24 frame`,
);

/*
 * Closing a chat.
 *
 * The row goes; the transcript stays on disk, which is why there is no confirmation and why
 * the label says "close" rather than "delete".
 */
const rows = () => page.evaluate(() => [...document.querySelectorAll(".chat-row .name")].map((n) => n.textContent));
const before2 = await rows();
say("there is more than one chat to close", before2.length >= 2, `${before2.length} rows`);

// Hidden until the row is approached, like a board's own ×.
const closeOpacity = () =>
	page.evaluate(() => Number(getComputedStyle(document.querySelector(".chat-row-wrap .close")).opacity));
say("the close button is out of the way until hovered", (await closeOpacity()) === 0);
await page.locator(".chat-row-wrap").first().hover();
await settle(page, 250);
say("…and appears on approach", (await closeOpacity()) === 1);

// The × belongs to the row: inside the box that draws the highlight, not beside it in the
// gutter. And that box has to span the list, which it stopped doing when the highlight lived
// on the `<button>` — a button's width is fit-content where a flex child is stretched.
const shape = await page.evaluate(() => {
	const list = document.querySelector(".chat-rows");
	const wrap = document.querySelector(".chat-row-wrap");
	const close = wrap.querySelector(".close");
	/*
	 * Whichever box is actually painted, found rather than assumed.
	 *
	 * Measuring the wrapper is what made an earlier version of this check useless: the
	 * wrapper was full-width and did contain the × even when the *highlight* was on the
	 * narrower button inside it, which is the thing that looked wrong. So find the element
	 * carrying a background and ask the questions of that.
	 */
	const painted = [wrap, wrap.querySelector(".chat-row")].find(
		(element) => getComputedStyle(element).backgroundColor !== "rgba(0, 0, 0, 0)",
	);
	const listBox = list.getBoundingClientRect();
	const box = (painted ?? wrap).getBoundingClientRect();
	const x = close.getBoundingClientRect();
	const padding = parseFloat(getComputedStyle(list).paddingRight);
	return {
		painted: painted?.className ?? "nothing",
		spans: Math.round(listBox.right - padding - box.right),
		inside: x.left >= box.left && x.right <= box.right && x.top >= box.top && x.bottom <= box.bottom,
		highlighted: painted ? getComputedStyle(painted).backgroundColor : "rgba(0, 0, 0, 0)",
	};
});
say("the row's highlight spans the list", shape.spans === 0, `${shape.painted} is ${shape.spans}px short of the content edge`);
say("the × sits inside that highlight", shape.inside, `highlight is ${shape.painted}`);
say("…and the row is what is highlighted", shape.highlighted !== "rgba(0, 0, 0, 0)", shape.highlighted);

// It must not also focus the row it sits on.
const focusedBefore = await page.evaluate(() => document.querySelector('.chat-row[data-current="true"] .name')?.textContent);
await page.locator(".chat-row-wrap").last().hover();
await page.locator(".chat-row-wrap").last().locator(".close").click();
await page.waitForFunction((was) => document.querySelectorAll(".chat-row").length < was, before2.length, { timeout: 8000 });
const after2 = await rows();
say("clicking it closes that chat", after2.length === before2.length - 1, `${before2.length} → ${after2.length} rows`);
say(
	"…and does not quietly focus the row it sat on",
	(await page.evaluate(() => document.querySelector('.chat-row[data-current="true"] .name')?.textContent)) === focusedBefore,
	`focus stayed on ${focusedBefore}`,
);
say("no button on a row is nameless", await page.evaluate(() =>
	[...document.querySelectorAll(".chat-row-wrap button")].every(
		(b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().length > 0,
	),
));

// Closing the focused chat has to leave one focused, or the composer talks to nothing.
await page.locator('.chat-row[data-current="true"]').hover();
await page.locator(".chat-row-wrap:has(.chat-row[data-current='true'])").locator(".close").click();
await settle(page, 900);
const focus = await page.evaluate(() => ({
	rows: document.querySelectorAll(".chat-row").length,
	current: document.querySelectorAll('.chat-row[data-current="true"]').length,
}));
say("closing the focused chat leaves another focused", focus.rows === 0 || focus.current === 1, JSON.stringify(focus));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
