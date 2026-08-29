/**
 * The time machine (DESIGN §6.7): hovering a turn previews the boards as they were,
 * restoring writes them back, and rewinding truncates the transcript.
 *
 * Needs a model, because the thing being travelled through is a real conversation.
 */
import { ask, boardPath, open, read, say, settle } from "../harness.mjs";

const plan = await boardPath("plan.html");
const original = read(plan);

const { browser, page, errors } = await open();
try {
	// A fresh agent, so the history is this run's.
	await page.mouse.move(6, 480);
	await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
	await page.locator('.chats .rail-head button[title="Start another agent"]').click();
	await settle(page, 1200);
	await page.mouse.move(800, 500);

	await ask(page, "Add a sticky to boards/plan.html with data-id 'timecheck' at left 1264px top 780px saying 'first turn'. Just do it, briefly.");
	say("the first turn changed the board", /timecheck/.test(read(plan)));

	await ask(page, "Now change that sticky's text to 'second turn'. Briefly.");
	const afterSecond = read(plan);
	say("the second turn changed it again", /second turn/.test(afterSecond));

	await page.locator(".turnbar .turn").first().click();
	await page.waitForSelector(".chat .turn-row", { timeout: 8000 });
	const rows = await page.locator(".chat .turn-row").count();
	say("each user message is a point you can return to", rows >= 2, `${rows} messages with actions`);

	// Hovering rewind on the *second* message shows the state after turn one.
	//
	// Marked before hovering: the `src` attribute changes before the new document parses,
	// so waiting on the URL alone and then reading the DOM reads the *old* document and
	// the preview looks like it did not happen. The marker is only absent once a genuinely
	// new document is in the frame, and `__boardReady` says it has finished rendering.
	await page.evaluate(() => {
		document.querySelector('.board-node[data-path="boards/plan.html"] iframe').contentWindow.__live = true;
	});
	const second = page.locator(".chat .turn-row").nth(1);
	await second.hover();
	await second.locator(".turn-actions button", { hasText: "rewind" }).hover();
	await page.waitForFunction(
		() => {
			const frame = document.querySelector('.board-node[data-path="boards/plan.html"] iframe');
			if (!(frame?.getAttribute("src") ?? "").startsWith("/api/revision/")) return false;
			return frame.contentWindow?.__live === undefined && frame.contentWindow?.__boardReady === true;
		},
		null,
		{ timeout: 15000 },
	);
	const preview = await page.evaluate(() => {
		const frame = document.querySelector('.board-node[data-path="boards/plan.html"] iframe');
		return { src: frame?.getAttribute("src"), text: frame?.contentDocument?.querySelector('[data-id="timecheck"]')?.textContent?.trim() };
	});
	say("hovering rewind shows that point's boards", preview.text === "first turn", `text=${JSON.stringify(preview.text)}`);
	say("previewing writes nothing", read(plan) === afterSecond);

	// Restore is deliberate, and it does write.
	await second.hover();
	await second.locator(".turn-actions button", { hasText: "restore boards" }).click();
	await page.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {});
	await settle(page, 1500);
	const restored = read(plan);
	say("restore boards writes that point back", /first turn/.test(restored) && !/second turn/.test(restored));

	// Rewinding truncates the conversation.
	const before = await page.locator(".chat .stream > *").count();
	const last = page.locator(".chat .turn-row").last();
	await last.hover();
	await last.locator(".turn-actions button", { hasText: "rewind" }).click();
	await page.waitForFunction((was) => document.querySelectorAll(".chat .stream > *").length < was, before, { timeout: 15000 });
	say("rewinding cuts the transcript back", (await page.locator(".chat .stream > *").count()) < before, `${before} → ${await page.locator(".chat .stream > *").count()} items`);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	// The board is a fixture, and this check deliberately rewrites it.
	const { write } = await import("../harness.mjs");
	write(plan, original);
	await settle(page, 500);
	await browser.close();
}
