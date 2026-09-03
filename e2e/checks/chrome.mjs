/**
 * The conversation's chrome: a run of tool calls opens to real chips, those chips keep
 * their height, the time machine lives on the user's message, and hovering a spine block
 * does not rebuild it.
 *
 * Needs a model — the tool chips being measured are real tool calls.
 */
import { ask, boardPath, newAgent, open, read, say, settle, socket } from "../harness.mjs";

const plan = await boardPath("plan.html");

const { browser, page, errors } = await open();
say("the bottom history bar is gone", (await page.locator(".timeline").count()) === 0);

// A fresh agent, so this run does not inherit anyone else's turns.
await newAgent(page);
await settle(page, 1200);
await page.mouse.move(800, 500);

// Enough tool calls to overflow the column — the case that squeezed the chips.
await ask(page, "Read each of boards/plan.html, boards/risks.html and boards/sources.html with the read tool, one call each, then say 'done' and nothing else.");

// A click on the spine opens the conversation at that turn.
await page.locator(".stream-roll .turn").first().click();
await page.waitForFunction(() => document.querySelector(".stream")?.dataset.open === "true", null, { timeout: 8000 });

/*
 * The tool calls are one pill until asked for.
 *
 * A turn that edits files is mostly tool calls, so the history collapses a run of them to
 * a count — and the count has to open, or the output would be somewhere with no route to
 * it now that the chat column is gone.
 */
say("a run of tool calls collapses to one pill", (await page.locator(".stream .ftools").count()) > 0);
await page.locator(".stream .ftools").first().click();
await page.waitForSelector(".stream .tool", { timeout: 10000 });
say("…that opens to the calls themselves", (await page.locator(".stream .fcalls .tool").count()) > 0);

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
	undo.textContent = ".stream .stream-roll > *, .stream .ftools-group > *, .stream .fcalls > * { flex: 1 1 auto !important; }";
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
await page.locator(".stream .tool .row").first().click();
await page.waitForSelector(".stream .tool pre", { timeout: 5000 });
say("a chip still expands to its output", (await page.locator(".stream .tool pre").count()) > 0);

// The user message carries the actions, and an entry id.
const turn = await page.evaluate(() => {
	const row = document.querySelector(".stream .turn-row");
	return {
		itemId: row?.dataset.item,
		/*
		 * Read from `data-act`, not from the text: they are icons now. Three phrases of grey
		 * text under every message ever sent was a second transcript running down the history,
		 * so what each one means moved into its tooltip — which is also the accessible name,
		 * asserted below.
		 */
		actions: [...(row?.querySelectorAll(".turn-actions button") ?? [])].map((b) => b.dataset.act),
		named: [...(row?.querySelectorAll(".turn-actions button") ?? [])].every((b) => (b.getAttribute("aria-label") ?? "").length > 0),
		iconOnly: [...(row?.querySelectorAll(".turn-actions button") ?? [])].every((b) => b.textContent.trim() === "" && b.querySelector("svg")),
		hiddenByDefault: row ? Number(getComputedStyle(row.querySelector(".turn-actions")).opacity) : null,
	};
});
say("the user message carries the time machine", turn.actions.join(" · ") === "rewind · fork · restore", turn.actions.join(" · "));
say("…as icons rather than three phrases of prose", turn.iconOnly);
say("…each still named for a screen reader", turn.named);
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
await page.locator(".stream .turn-row").first().hover();
await page.locator('.stream .turn-actions button[data-act="rewind"]').first().hover();
await page.waitForFunction(() => document.querySelector(".stage")?.dataset.previewing === "true", null, { timeout: 8000 });
const previewing = await page.evaluate(() => ({
	stage: document.querySelector(".stage")?.dataset.previewing,
	src: document.querySelector(".board-node iframe")?.getAttribute("src"),
	transcriptOpacity: Number(getComputedStyle(document.querySelector(".stream .stream-roll > *")).opacity),
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
	}).observe(document.querySelector(".stream-roll"), { childList: true, subtree: true });
});
await page.locator(".stream-roll .turn").first().hover();
await settle(page, 3000);
const churn = await page.evaluate(() => ({ churn: window.__churn, hovered: document.querySelectorAll(".stream-roll .turn:hover").length }));
say("hovering a spine block does not rebuild it", churn.churn === 0 && churn.hovered === 1, `${churn.churn} node changes, ${churn.hovered} hovered`);

link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
