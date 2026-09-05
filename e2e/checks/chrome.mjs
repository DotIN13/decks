/**
 * The conversation's chrome: a run of tool calls opens to real chips, those chips keep
 * their height, the time machine lives on the user's message, and hovering a card does not
 * rebuild the column.
 *
 * Needs a model — the tool chips being measured are real tool calls.
 *
 * Written against the spine and `.turn-row` originally, and both are gone: the spine went
 * with the title bar, and the three labelled buttons under every message became one handle
 * that opens a menu. The properties are the same; only the surfaces they live on moved.
 */
import { ask, boardPath, newAgent, open, openHistory, read, say, settle, socket } from "../harness.mjs";

const plan = await boardPath("plan.html");

const { browser, page, errors } = await open();
say("the bottom history bar is gone", (await page.locator(".timeline").count()) === 0);

// A fresh agent, so this run does not inherit anyone else's turns.
await newAgent(page);
await settle(page, 1200);
await page.mouse.move(800, 500);

// Enough tool calls to overflow the column — the case that squeezed the chips.
await ask(page, "Read each of boards/plan.html, boards/risks.html and boards/sources.html with the read tool, one call each, then say 'done' and nothing else.");

// The corner's button opens the conversation; `data-shown` is the panel's own answer.
await openHistory(page);

/*
 * The tool calls are one row until asked for.
 *
 * A turn that edits files is mostly tool calls, so the history collapses a run of them to a
 * count — and the count has to open, or the output would be somewhere with no route to it
 * now that the chat column is gone.
 *
 * `[data-group]` rather than a class of its own: the group used to be a filled pill,
 * `.stream-tool-head`, and it is the same `.tool` row as its children now — same glyph, same
 * mono name, same chevron at the right end. The attribute exists so a check can say *which*
 * row it means without the row looking different to say it.
 */
say("a run of tool calls collapses to one row", (await page.locator(".stream .tool[data-group]").count()) > 0);
await page.locator(".stream .tool[data-group] > .row").first().click();
await page.waitForSelector(".stream .tool-kids .tool", { timeout: 10000 });
const nested = await page.locator(".stream .tool[data-group] .tool-kids .tool").count();
say("…that opens to the calls themselves, nested under it", nested > 0, `${nested} nested`);
/*
 * And they are the same object as the row above them. The group was a species of its own
 * while it was a pill, which showed the moment it opened: a filled header with three unfilled
 * rows hanging off it.
 */
const sameShape = await page.evaluate(() => {
	const head = document.querySelector('.stream .tool[data-group] > .row');
	const kid = document.querySelector(".stream .tool-kids .tool > .row");
	if (!head || !kid) return null;
	const read = (row) => {
		const style = getComputedStyle(row);
		const name = getComputedStyle(row.querySelector(".name"));
		return {
			height: Math.round(row.getBoundingClientRect().height),
			radius: style.borderRadius,
			mono: name.fontFamily.includes("Mono"),
			caps: name.textTransform,
			chevronLast: row.lastElementChild?.classList.contains("twist") ?? false,
		};
	};
	return { head: read(head), kid: read(kid) };
});
say(
	"a group and a call are the same row",
	sameShape !== null && JSON.stringify(sameShape.head) === JSON.stringify(sameShape.kid),
	JSON.stringify(sameShape),
);
say("…in mono, uppercase, with the chevron at the end", sameShape?.kid.mono && sameShape?.kid.caps === "uppercase" && sameShape?.kid.chevronLast, JSON.stringify(sameShape?.kid));

/*
 * Overflow is forced rather than hoped for: the squeeze only happened once the content was
 * taller than the column, which is when a flex container starts shrinking children. With
 * the condition held, the rule that protects the chips is *removed* for one measurement —
 * so this asserts the property under the conditions that used to break it, not just that
 * today's layout happens to look right.
 */
const chips = await page.evaluate(() => {
	const panel = document.querySelector(".stream");
	const stream = panel.querySelector(".stream-roll");
	panel.style.height = "190px";
	panel.style.bottom = "auto";
	const measure = () => [...stream.querySelectorAll(".tool")].map((t) => Math.round(t.getBoundingClientRect().height));

	const overflowing = stream.scrollHeight > stream.clientHeight + 1;
	const fixed = measure();

	// The guard removed for a moment: every row in the scroller free to shrink.
	const undo = document.createElement("style");
	undo.textContent = ".stream .stream-roll > *, .stream .stream-tools > *, .stream .tool-kids > * { flex: 1 1 auto !important; }";
	document.head.appendChild(undo);
	const squeezed = measure();
	undo.remove();

	const restored = measure();
	panel.style.height = "";
	panel.style.bottom = "";
	return { overflowing, fixed, squeezed, restored, count: fixed.length };
});
say("the history is overflowing (the condition that squeezed them)", chips.overflowing);
say("every tool chip keeps its height", chips.count > 0 && chips.fixed.every((h) => h >= 24), `${chips.count} chips: ${chips.fixed.join(", ")}px`);
/*
 * And keeps it even with nothing stopping it — which it did not always.
 *
 * A chip used to be a direct child of the scroller, where `flex: 0 0 auto` was the only
 * thing between it and being squeezed to a line: it has `overflow: hidden` and so no
 * content-based minimum of its own to push back with. It is a grandchild now, inside the
 * `.tool-kids` its run collapses into, and that group *does* have a content-based minimum —
 * the sum of the chips' own heights. So the floor is structural rather than a single
 * declaration, and removing the declaration no longer reproduces the bug.
 */
say(
	"…even with every row in the scroller free to shrink",
	chips.squeezed.every((h) => h >= 24) && chips.restored.every((h) => h >= 24),
	`with flex-shrink: ${chips.squeezed.join(", ")}px`,
);

await settle(page, 600);
await page.locator(".stream .tool > .row:not([disabled])").first().click();
await page.waitForSelector(".stream .tool pre", { timeout: 5000 });
say("a chip still expands to its output", (await page.locator(".stream .tool pre").count()) > 0);

/*
 * The user's message carries the time machine, and it is *one* handle now.
 *
 * Three buttons became one that opens a menu, and the reason is the same one that made them
 * icons in the first place: three phrases of grey text under every message ever sent was a
 * second transcript running down the history. So what is asserted is what survived the
 * change — the handle is on the user's message and not the agent's, it is an icon with a
 * name a screen reader can read, it is out of the way until the message is approached, and
 * the message carries the entry id the whole feature is addressed by.
 */
const turn = await page.evaluate(() => {
	const row = document.querySelector(".stream .stream-mine");
	const handle = row?.querySelector(".stream-rw");
	return {
		itemId: row?.dataset.item,
		handles: document.querySelectorAll(".stream .stream-mine .stream-rw").length,
		mine: document.querySelectorAll(".stream .stream-mine").length,
		onAgentCards: document.querySelectorAll(".stream .stream-card .stream-rw").length,
		named: (handle?.getAttribute("aria-label") ?? "").length > 0,
		menu: handle?.getAttribute("aria-haspopup"),
		iconOnly: Boolean(handle && handle.textContent.trim() === "" && handle.querySelector("svg")),
		hiddenByDefault: handle ? Number(getComputedStyle(handle).opacity) : null,
	};
});
say("every message of yours carries the time machine", turn.mine > 0 && turn.handles === turn.mine, `${turn.handles} of ${turn.mine}`);
say("…and no reply of the agent's does", turn.onAgentCards === 0, `${turn.onAgentCards} on agent cards`);
say("…addressed by the entry id the message carries", Boolean(turn.itemId), String(turn.itemId));
say("…as one icon that opens a menu, rather than three phrases of prose", turn.iconOnly && turn.menu === "menu");
say("…still named for a screen reader", turn.named);
say("the handle is out of the way until the message is approached", turn.hiddenByDefault === 0, `opacity ${turn.hiddenByDefault}`);

/*
 * A board has to be in play for there to be a preview.
 *
 * This agent read three boards and attached none, and an agent holding nothing now puts
 * nothing on the canvas (§2) — so there was no frame whose `src` could swap to a revision,
 * and the assertion read `undefined`. Played over the socket rather than asked for, because
 * what is being tested here is the chrome, not the agent's judgement.
 */
const link = await socket();
link.send({ type: "board.play", path: "boards/plan.html" });
await page.waitForSelector('.board-node[data-path="boards/plan.html"] iframe', { timeout: 10000 });
await settle(page, 600);

// Pressing Preview shows that point's boards; the transcript is not dimmed.
const before = read(plan);
await page.locator(".stream .stream-mine").first().hover();
/*
 * Opened and pressed. Pointing at the handle used to be enough — and that is exactly what
 * was wrong with it: the canvas changed under a cursor crossing the transcript, into a state
 * whose only exit was inside this menu.
 */
await page.locator(".stream .stream-mine .stream-rw").first().click();
await page.waitForSelector(".popover", { timeout: 6000 });
await page.locator(".popover [data-row]").filter({ hasText: /^Preview$/ }).first().click();
await page.waitForFunction(() => document.querySelector(".stage")?.dataset.previewing === "true", null, { timeout: 8000 });
const previewing = await page.evaluate(() => ({
	stage: document.querySelector(".stage")?.dataset.previewing,
	src: document.querySelector(".board-node iframe")?.getAttribute("src"),
	transcriptOpacity: Number(getComputedStyle(document.querySelector(".stream .stream-roll > *")).opacity),
}));
say("pressing Preview shows the boards at that point", (previewing.src ?? "").startsWith("/api/revision/"), `src=${previewing.src}`);
say("the transcript is not dimmed while it is up", previewing.transcriptOpacity === 1, `opacity ${previewing.transcriptOpacity}`);
say("previewing writes nothing", read(plan) === before);

/*
 * And Escape puts them back — the canvas's own way out, which is the other half of making the
 * preview deliberate: moving the pointer away no longer ends it, so something on the canvas
 * has to. (`preview.mjs` checks the badge and its Leave button without spending a turn.)
 */
await page.mouse.move(800, 300);
await page.keyboard.press("Escape");
await page.waitForFunction(
	() => (document.querySelector(".board-node iframe")?.getAttribute("src") ?? "").startsWith("/api/board/"),
	null,
	{ timeout: 8000 },
);
say("Escape puts the live boards back", true);

/*
 * The column does not churn under the cursor.
 *
 * This was a 500ms interval rebuilding the spine's blocks, which made them flicker whenever
 * the pointer rested on one. The spine is gone; the property is not — the cards are what the
 * pointer rests on now, and a card that rebuilds under it takes the handle you were reaching
 * for with it.
 */
await page.evaluate(() => {
	window.__churn = 0;
	new MutationObserver((records) => {
		for (const record of records) window.__churn += record.addedNodes.length + record.removedNodes.length;
	}).observe(document.querySelector(".stream-roll"), { childList: true, subtree: true });
});
await page.locator(".stream-roll .stream-mine").first().hover();
await settle(page, 3000);
const churn = await page.evaluate(() => ({ churn: window.__churn, hovered: document.querySelectorAll(".stream-roll .stream-mine:hover").length }));
say("hovering a message does not rebuild the column", churn.churn === 0 && churn.hovered === 1, `${churn.churn} node changes, ${churn.hovered} hovered`);

link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
