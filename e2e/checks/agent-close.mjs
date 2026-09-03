/**
 * Closing a chat from the agent list — the × on a row, and Delete on it.
 *
 * There was no way to do this at all after the frontend rewrite. `agent.remove` is a live
 * protocol message and the server has always handled it, but the surface that sent it was
 * the chat list in the old left panel, and the panel went; the dropdown that replaced it
 * argued *against* a × on the grounds that Tab could not reach one. So this check covers a
 * control that is new and a message whose only caller had been deleted.
 *
 * No model needed, which is the point of asserting it here rather than in `agent-rows.mjs`:
 * a chat created by the `+` row exists and is idle whether or not anything can run in it,
 * and idle is the only state the registry will let you close.
 */
import { newAgent, open, openAgents, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1600, height: 1000 });

/** The agent rows, which are the flat ones — the `New agent` pair are rows too. */
const rowbox = () => page.locator('.popover .row-act:has([data-row][data-flat="true"][data-agent="true"])');
const names = () =>
	page.evaluate(() =>
		[...document.querySelectorAll('.popover [data-row][data-agent="true"] .lb')].map((n) => n.textContent.trim()),
	);

await openAgents(page);
const before = await names();
say("the list opens with the agents in it", before.length >= 1, before.join(" | "));

const shape = await page.evaluate(() => {
	const box = document.querySelector(".popover .row-act");
	const row = box?.querySelector("[data-row]");
	const close = box?.querySelector(".close");
	if (!box || !row || !close) return null;
	return {
		/* The × is a sibling of the row, not inside it: a button in a button is invalid
		   markup, and it is also what would make the whole row a delete button. */
		nested: row.contains(close),
		/* And not a `[data-row]` itself, or the arrow keys would step name, ×, name, ×. */
		roving: close.hasAttribute("data-row"),
		/*
		 * Not drawn at all until the row is approached — and *no slot held*, which is the
		 * difference between this list and the accounts modal: the last column of an agent row
		 * is one short status, and 22px reserved beside it is a ragged gutter down the whole
		 * list. `display`, not `opacity`, is what makes that true.
		 */
		resting: getComputedStyle(close).display,
		wordsResting: getComputedStyle(box.querySelector("[data-yield]")).display,
		labelled: close.getAttribute("aria-label") ?? "",
		title: close.getAttribute("title") ?? "",
	};
});
say("the × is beside the row rather than inside it", shape && !shape.nested, JSON.stringify(shape));
say("…and is not one of the rows the arrows rove over", shape && !shape.roving);
say("…and is not drawn until the row is approached", shape && shape.resting === "none", shape?.resting);
say("…with no slot held for it, so the words end where the row ends", shape && shape.wordsResting !== "none", shape?.wordsResting);
say("…while still naming which chat it closes", /^Close ./.test(shape?.labelled ?? ""), shape?.labelled);
say(
	"…and says the transcript survives, since there is no undo in the list",
	/stays on disk/.test(shape?.title ?? ""),
	shape?.title,
);

/*
 * A row appears on hover, which is the only way to press it — and the check has to hover the
 * *box*, not the ×, because at `opacity: 0` there is nothing under the pointer to enter.
 */
await newAgent(page);
await settle(page, 600);
await openAgents(page);
const grown = await names();
say("a new agent is a new row", grown.length === before.length + 1, grown.join(" | "));

const target = rowbox().last();
await target.hover();
await settle(page, 200);
const revealed = await page.evaluate(() => {
	const box = [...document.querySelectorAll(".popover .row-act")].at(-1);
	const close = box.querySelector(".close");
	const b = box.getBoundingClientRect();
	const c = close.getBoundingClientRect();
	return {
		close: getComputedStyle(close).display,
		words: getComputedStyle(box.querySelector("[data-yield]")).display,
		opacity: getComputedStyle(close).opacity,
		/* Inside the box, so the wash the box paints covers it — measured while it is up,
		   since a `display: none` button has no rectangle to be inside anything. */
		inside: c.right <= b.right + 0.5 && c.left >= b.left,
	};
});
say("hovering the row shows its ×", revealed.close !== "none" && revealed.opacity === "1", JSON.stringify(revealed));
/*
 * And the words stay. The slot opens beside them rather than taking their place: the status
 * is what you were reading, and swapping it for a button removes the row's only fact at the
 * moment you are deciding what to do with the row.
 */
say("…beside the words rather than in place of them", revealed.words !== "none", revealed.words);
say("…inside the box that draws the row's wash", revealed.inside);

await target.locator(".close").click();
await settle(page, 800);

/*
 * The menu is still open, and that is deliberate: `Popover` closes on a row click and the ×
 * is not a row, so closing three chats is one visit to the list rather than three.
 */
say("the menu stays open after closing a chat", (await page.locator(".popover").count()) === 1);
const after = await names();
say("the row is gone", after.length === before.length, after.join(" | "));

/*
 * Delete on the row does the same, because the × cannot be reached with Tab: `Popover`
 * treats Tab on a row as "pick this one and close", which is the completion behaviour the
 * list is built around. So the keyboard's route to closing is a key on the row itself.
 */
await newAgent(page);
await settle(page, 600);
await openAgents(page);
const before2 = await names();
await rowbox().last().locator("[data-row]").focus();
await page.keyboard.press("Delete");
await settle(page, 800);
const after2 = await names();
say("Delete on the focused row closes it too", after2.length === before2.length - 1, `${before2.length} → ${after2.length}`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
