/**
 * The chat column's chrome: tool chips keep their height, the time machine lives on the
 * user's message, and hovering a spine block does not rebuild it.
 *
 * Needs a model — the tool chips being measured are real tool calls.
 */
import { ask, boardPath, open, read, say, settle } from "../harness.mjs";

const plan = await boardPath("plan.html");

const { browser, page, errors } = await open();
say("the bottom history bar is gone", (await page.locator(".timeline").count()) === 0);

// A fresh agent, so this run does not inherit anyone else's turns.
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
await page.locator(".chats .rail-head button", { hasText: "+" }).click();
await settle(page, 1200);
await page.mouse.move(800, 500);

// Enough tool calls to overflow the column — the case that squeezed the chips.
await ask(page, "Read each of boards/plan.html, boards/risks.html and boards/sources.html with the read tool, one call each, then say 'done' and nothing else.");

await page.locator(".turnbar .turn").first().click();
await page.waitForSelector(".chat .tool", { timeout: 10000 });

/*
 * Overflow is forced rather than hoped for: the squeeze only happened once the content was
 * taller than the column, which is when a flex container starts shrinking children. With
 * the condition held, the old behaviour is put back for one measurement — that is what
 * makes this a test of the fix and not just of today's layout.
 */
const chips = await page.evaluate(() => {
	const panel = document.querySelector(".chat");
	const stream = panel.querySelector(".stream");
	panel.style.height = "190px";
	panel.style.bottom = "auto";
	const measure = () => [...stream.querySelectorAll(".tool")].map((t) => Math.round(t.getBoundingClientRect().height));

	const overflowing = stream.scrollHeight > stream.clientHeight + 1;
	const fixed = measure();

	// The old rule, back for a moment.
	const undo = document.createElement("style");
	undo.textContent = ".chat .stream > * { flex: 1 1 auto !important; }";
	document.head.appendChild(undo);
	const squeezed = measure();
	undo.remove();

	const restored = measure();
	panel.style.height = "";
	panel.style.bottom = "";
	return { overflowing, fixed, squeezed, restored, count: fixed.length };
});
say("the column is overflowing (the condition that squeezed them)", chips.overflowing);
say("every tool chip keeps its height", chips.count > 0 && chips.fixed.every((h) => h >= 24), `${chips.count} chips: ${chips.fixed.join(", ")}px`);
say(
	"the old rule really was the cause",
	chips.squeezed.some((h) => h < 24) && chips.restored.every((h) => h >= 24),
	`with flex-shrink: ${chips.squeezed.join(", ")}px`,
);

await page.locator(".turnbar .turn").first().click();
await settle(page, 600);
await page.locator(".chat .tool .row").first().click();
await page.waitForSelector(".chat .tool pre", { timeout: 5000 });
say("a chip still expands to its output", (await page.locator(".chat .tool pre").count()) > 0);

// The user message carries the actions, and an entry id.
const turn = await page.evaluate(() => {
	const row = document.querySelector(".chat .turn-row");
	return {
		itemId: row?.dataset.item,
		actions: [...(row?.querySelectorAll(".turn-actions button") ?? [])].map((b) => b.textContent),
		hiddenByDefault: row ? Number(getComputedStyle(row.querySelector(".turn-actions")).opacity) : null,
	};
});
say("the user message carries the time machine", turn.actions.join(" · ") === "rewind · fork · restore boards", turn.actions.join(" · "));
say("the actions are hidden until hovered", turn.hiddenByDefault === 0, `opacity ${turn.hiddenByDefault}`);

// Hovering rewind previews instantly; the transcript is not dimmed.
const before = read(plan);
await page.locator(".chat .turn-row").first().hover();
await page.locator(".chat .turn-actions button", { hasText: "rewind" }).first().hover();
await page.waitForFunction(() => document.querySelector(".stage")?.dataset.previewing === "true", null, { timeout: 8000 });
const previewing = await page.evaluate(() => ({
	stage: document.querySelector(".stage")?.dataset.previewing,
	src: document.querySelector(".board-node iframe")?.getAttribute("src"),
	transcriptOpacity: Number(getComputedStyle(document.querySelector(".chat .stream > *")).opacity),
}));
say("hovering rewind previews the boards at once", (previewing.src ?? "").startsWith("/api/revision/"), `src=${previewing.src}`);
say("the transcript is not dimmed under the cursor", previewing.transcriptOpacity === 1, `opacity ${previewing.transcriptOpacity}`);
say("previewing writes nothing", read(plan) === before);

await page.mouse.move(800, 300);
await page.waitForFunction(
	() => (document.querySelector(".board-node iframe")?.getAttribute("src") ?? "").startsWith("/api/board/"),
	null,
	{ timeout: 8000 },
);
say("leaving puts the live boards back", true);

// The spine does not churn under the cursor. This was a 500ms interval rebuilding the
// blocks, which made them flicker whenever the pointer rested on one.
await page.evaluate(() => {
	window.__churn = 0;
	new MutationObserver((records) => {
		for (const record of records) window.__churn += record.addedNodes.length + record.removedNodes.length;
	}).observe(document.querySelector(".turnbar"), { childList: true, subtree: true });
});
await page.locator(".turnbar .turn").first().hover();
await settle(page, 3000);
const churn = await page.evaluate(() => ({ churn: window.__churn, hovered: document.querySelectorAll(".turnbar .turn:hover").length }));
say("hovering a spine block does not rebuild it", churn.churn === 0 && churn.hovered === 1, `${churn.churn} node changes, ${churn.hovered} hovered`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
