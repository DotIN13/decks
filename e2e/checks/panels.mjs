/**
 * The floating panels: away by default, out when reached for (DESIGN §7).
 *
 * The reveal is proximity-based, so these are the one place a short fixed wait is right —
 * what is being waited on is a CSS transition, which has a duration and no event worth
 * subscribing to.
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

say("the agent list is away by default", (await isOpen(".side")) === false, JSON.stringify(await onScreen(".side")));
say("the chat is away by default", (await isOpen(".chat")) === false, JSON.stringify(await onScreen(".chat")));
const sliver = await onScreen(".side");
say("a sliver of the agent list is still visible", sliver.visibleWidth > 4 && sliver.visibleWidth < 40, `${sliver.visibleWidth}px showing`);

await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
say("reaching the left edge brings out the agent list", await isOpen(".side"));

await page.mouse.move(700, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "false", null, { timeout: 4000 });
say("moving away puts it back", (await isOpen(".side")) === false);

// The palette must not sit under the panel that appears when you reach for the edge.
await page.evaluate(() => document.querySelector(".rail-item")?.click());
await page.waitForSelector(".palette", { state: "visible", timeout: 8000 });
const palette = await onScreen(".palette");
say("the palette sits clear of the agent list", palette.left > 220, JSON.stringify(palette));

/*
 * Every icon-only button still says what it is.
 *
 * The chrome's controls used to be text glyphs — `▹`, `+`, `×`, `◉` — which were their
 * own accessible names, badly. Now they are Lucide SVGs, and an SVG has no name at all
 * unless one is given: `aria-hidden` is Lucide's default, so a button with nothing but an
 * icon in it reads as blank to a screen reader and matches nothing in a check. This runs
 * with the agent list out and the palette up, so it covers the pin, the `+`, the tools
 * and the zoom bar in one pass.
 */
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
const nameless = await page.evaluate(() =>
	[...document.querySelectorAll("button")]
		.filter((button) => button.textContent.trim() === "" && button.querySelector("svg"))
		.filter((button) => !button.getAttribute("aria-label") && !button.getAttribute("title"))
		.map((button) => button.className || button.outerHTML.slice(0, 60)),
);
say("every icon-only button has an accessible name", nameless.length === 0, nameless.join(" | "));

// A closed panel takes no clicks, so each press reaches for the edge first — which is
// what a hand has to do too.
const pressPin = async () => {
	await page.mouse.move(6, 480);
	await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
	await page.locator(".chats .pin").click();
	await settle(page, 200);
};

await pressPin();
await page.mouse.move(900, 480);
await settle(page, 400);
say("a pinned panel stays when the cursor leaves", await isOpen(".side"));

await pressPin();
await page.mouse.move(900, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "false", null, { timeout: 4000 });
say("unpinning lets it hide again", (await isOpen(".side")) === false);
say("the pin is remembered", (await page.evaluate(() => localStorage.getItem("decks.panel.left"))) === "away");

/*
 * The two panel headers, which are the same design and were not the same code.
 *
 * `.chats` is `.rail`'s sibling, so `.rail .rail-head` never matched the agent list: its
 * header was a plain block with a `flex: 1` spacer that measured zero, so the label was
 * body text and all three controls crowded against it with the right half of the row empty.
 */
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
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

// The runtime chip: what `+` will create, and the width of what it says.
const chip = await page.evaluate(() => {
	const kind = document.querySelector(".chats .rail-head .kind");
	const value = kind.querySelector(".value").getBoundingClientRect();
	const icon = kind.querySelector("svg").getBoundingClientRect();
	return {
		label: kind.querySelector(".value").textContent,
		// A native select sizes to its widest option, which left a gap here.
		valueToChevron: Math.round(icon.left - value.right),
		selectCovers: (() => {
			const box = kind.getBoundingClientRect();
			const select = kind.querySelector("select").getBoundingClientRect();
			return Math.round(select.width) === Math.round(box.width) && Math.round(select.height) === Math.round(box.height);
		})(),
		named: kind.querySelector("select").getAttribute("aria-label"),
	};
});
say("the chip says what + will create", chip.label === "pi", chip.label);
say("…with the chevron against the value", chip.valueToChevron >= 0 && chip.valueToChevron <= 4, `${chip.valueToChevron}px`);
say("…and the real control still covers it", chip.selectCovers);
say("…and is still named for a screen reader", Boolean(chip.named), chip.named ?? "");

// Choosing a runtime creates an agent on it. It stays reachable by keyboard because the
// select is only invisible, not replaced.
const before = await page.evaluate(() => document.querySelectorAll(".chat-row").length);
await page.selectOption(".chats .rail-head .kind select", "claude");
await page.waitForFunction((was) => document.querySelectorAll(".chat-row").length > was, before, { timeout: 8000 });
const kinds = await page.evaluate(() => [...document.querySelectorAll(".chat-row .runtime")].map((r) => r.textContent));
say("choosing a runtime creates an agent on it", kinds.includes("claude"), kinds.join(" "));
say("…and the chip goes back to the default", (await page.evaluate(() => document.querySelector(".chats .rail-head .kind .value").textContent)) === "pi");

// The row's badge belongs with the time, not adrift after the name.
const row = await page.evaluate(() => {
	const top = document.querySelector(".chat-row .top");
	const box = top.getBoundingClientRect();
	const meta = top.querySelector(".meta").getBoundingClientRect();
	return { children: top.children.length, metaAtRight: Math.round(box.right - meta.right) };
});
say("the runtime badge is grouped with the time", row.children === 2, `${row.children} children on the row's top line`);
say("…at the right edge", Math.abs(row.metaAtRight) <= 2, `${row.metaAtRight}px`);

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
