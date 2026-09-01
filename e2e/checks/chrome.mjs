/**
 * The conversation's chrome: a run of tool calls opens to real chips, those chips keep
 * their height, the time machine lives on the user's message, and hovering a spine block
 * does not rebuild it.
 *
 * Needs a model — the tool chips being measured are real tool calls.
 */
import { ask, boardPath, open, read, say, settle, socket } from "../harness.mjs";

const plan = await boardPath("plan.html");

const { browser, page, errors } = await open();
say("the bottom history bar is gone", (await page.locator(".timeline").count()) === 0);

// A fresh agent, so this run does not inherit anyone else's turns.
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
await page.locator('.chats .rail-head button[title="Start another agent"]').click();
await settle(page, 1200);
await page.mouse.move(800, 500);

// Enough tool calls to overflow the column — the case that squeezed the chips.
await ask(page, "Read each of boards/plan.html, boards/risks.html and boards/sources.html with the read tool, one call each, then say 'done' and nothing else.");

// A click on the spine opens the conversation at that turn.
await page.locator(".turnbar .turn").first().click();
await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "true", null, { timeout: 8000 });

/*
 * The tool calls are one pill until asked for.
 *
 * A turn that edits files is mostly tool calls, so the history collapses a run of them to
 * a count — and the count has to open, or the output would be somewhere with no route to
 * it now that the chat column is gone.
 */
say("a run of tool calls collapses to one pill", (await page.locator(".chat-float .ftools").count()) > 0);
await page.locator(".chat-float .ftools").first().click();
await page.waitForSelector(".chat-float .tool", { timeout: 10000 });
say("…that opens to the calls themselves", (await page.locator(".chat-float .fcalls .tool").count()) > 0);

/*
 * Overflow is forced rather than hoped for: the squeeze only happened once the content was
 * taller than the column, which is when a flex container starts shrinking children. With
 * the condition held, the rule that protects the chips is *removed* for one measurement —
 * so this asserts the property under the conditions that used to break it, not just that
 * today's layout happens to look right.
 */
const chips = await page.evaluate(() => {
	const panel = document.querySelector(".chat-float");
	const stream = panel.querySelector(".fsroll");
	panel.style.height = "190px";
	panel.style.bottom = "auto";
	const measure = () => [...stream.querySelectorAll(".tool")].map((t) => Math.round(t.getBoundingClientRect().height));

	const overflowing = stream.scrollHeight > stream.clientHeight + 1;
	const fixed = measure();

	// The guard removed for a moment: every row in the scroller free to shrink.
	const undo = document.createElement("style");
	undo.textContent = ".chat-float .fsroll > *, .chat-float .ftools-group > *, .chat-float .fcalls > * { flex: 1 1 auto !important; }";
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
 * `.ftools-group` its run collapses into, and that group *does* have a content-based
 * minimum — the sum of the chips' own heights. So the floor is structural rather than a
 * single declaration, and removing the declaration no longer reproduces the bug.
 */
say(
	"…even with every row in the scroller free to shrink",
	chips.squeezed.every((h) => h >= 24) && chips.restored.every((h) => h >= 24),
	`with flex-shrink: ${chips.squeezed.join(", ")}px`,
);

await settle(page, 600);
await page.locator(".chat-float .tool .row").first().click();
await page.waitForSelector(".chat-float .tool pre", { timeout: 5000 });
say("a chip still expands to its output", (await page.locator(".chat-float .tool pre").count()) > 0);

// The user message carries the actions, and an entry id.
const turn = await page.evaluate(() => {
	const row = document.querySelector(".chat-float .turn-row");
	return {
		itemId: row?.dataset.item,
		actions: [...(row?.querySelectorAll(".turn-actions button") ?? [])].map((b) => b.textContent),
		hiddenByDefault: row ? Number(getComputedStyle(row.querySelector(".turn-actions")).opacity) : null,
	};
});
say("the user message carries the time machine", turn.actions.join(" · ") === "rewind · fork · restore boards", turn.actions.join(" · "));
say("the actions are hidden until hovered", turn.hiddenByDefault === 0, `opacity ${turn.hiddenByDefault}`);

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

// Hovering rewind previews instantly; the transcript is not dimmed.
const before = read(plan);
await page.locator(".chat-float .turn-row").first().hover();
await page.locator(".chat-float .turn-actions button", { hasText: "rewind" }).first().hover();
await page.waitForFunction(() => document.querySelector(".stage")?.dataset.previewing === "true", null, { timeout: 8000 });
const previewing = await page.evaluate(() => ({
	stage: document.querySelector(".stage")?.dataset.previewing,
	src: document.querySelector(".board-node iframe")?.getAttribute("src"),
	transcriptOpacity: Number(getComputedStyle(document.querySelector(".chat-float .fsroll > *")).opacity),
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

link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
