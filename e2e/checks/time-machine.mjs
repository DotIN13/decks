/**
 * The time machine (DESIGN §6.7): hovering a turn previews the boards as they were,
 * restoring writes them back, and rewinding truncates the transcript.
 *
 * Needs a model, because the thing being travelled through is a real conversation.
 */
import { ask, boardPath, newAgent, open, read, say, settle, socket } from "../harness.mjs";

const plan = await boardPath("plan.html");
const original = read(plan);

const { browser, page, errors } = await open();
try {
	// A fresh agent, so the history is this run's.
	await newAgent(page);
	await settle(page, 1200);
	await page.mouse.move(800, 500);

	await ask(page, "Add a sticky to boards/plan.html with data-id 'timecheck' at left 1264px top 780px saying 'first turn'. Just do it, briefly.");
	say("the first turn changed the board", /timecheck/.test(read(plan)));

	await ask(page, "Now change that sticky's text to 'second turn'. Briefly.");
	const afterSecond = read(plan);
	/*
	 * Case-insensitive, because the text is the model's.
	 *
	 * The prompt asks for a sticky saying 'first turn' and a model may reasonably write
	 * "First turn". What is being tested is the time machine, not whether the agent
	 * preserved the case of a word — and a check that fails on that is a check that cries
	 * wolf about a feature that works.
	 */
	say("the second turn changed it again", /second turn/i.test(afterSecond));

	await page.locator(".stream-roll .turn").first().click();
	await page.waitForSelector(".stream .turn-row", { timeout: 8000 });
	const rows = await page.locator(".stream .turn-row").count();
	say("each user message is a point you can return to", rows >= 2, `${rows} messages with actions`);

	/*
	 * The board has to be on the canvas for there to be anything to preview.
	 *
	 * An agent holding nothing puts nothing on the canvas (§2), and this check starts a
	 * fresh agent on purpose — so editing the board is not the same as showing it, and
	 * every assertion below was reading `null`. Played over the socket rather than asked
	 * for, because what is being tested is the time machine, not the agent's judgement
	 * about what belongs on screen. `chrome.mjs` does the same thing for the same reason.
	 */
	const link = await socket();
	link.send({ type: "board.play", path: "boards/plan.html" });
	await page.waitForSelector('.board-node[data-path="boards/plan.html"] iframe', { timeout: 10000 });
	await settle(page, 600);

	// Hovering rewind on the *second* message shows the state after turn one.
	//
	// Marked before hovering: the `src` attribute changes before the new document parses,
	// so waiting on the URL alone and then reading the DOM reads the *old* document and
	// the preview looks like it did not happen. The marker is only absent once a genuinely
	// new document is in the frame, and `__boardReady` says it has finished rendering.
	await page.evaluate(() => {
		document.querySelector('.board-node[data-path="boards/plan.html"] iframe').contentWindow.__live = true;
	});
	const second = page.locator(".stream .turn-row").nth(1);
	await second.hover();
	await second.locator('.turn-actions button[data-act="rewind"]').hover();
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
	say(
		"hovering rewind shows that point's boards",
		(preview.text ?? "").trim().toLowerCase() === "first turn",
		`text=${JSON.stringify(preview.text)}`,
	);
	say("previewing writes nothing", read(plan) === afterSecond);

	// Restore is deliberate, and it does write.
	await second.hover();
	await second.locator('.turn-actions button[data-act="restore"]').click();
	await page.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {});
	await settle(page, 1500);
	const restored = read(plan);
	say("restore boards writes that point back", /first turn/i.test(restored) && !/second turn/i.test(restored));

	// Rewinding truncates the conversation.
	const before = await page.locator(".stream .stream-roll > *").count();
	const last = page.locator(".stream .turn-row").last();
	const rewound = (await last.locator(".stream-card").innerText()).trim();
	await last.hover();
	await last.locator('.turn-actions button[data-act="rewind"]').click();
	await page.waitForFunction((was) => document.querySelectorAll(".stream .stream-roll > *").length < was, before, { timeout: 15000 });
	say("rewinding cuts the transcript back", (await page.locator(".stream .stream-roll > *").count()) < before, `${before} → ${await page.locator(".stream .stream-roll > *").count()} items`);

	/*
	 * The message comes back in the input bar, and *only* there.
	 *
	 * The server has passed `editorText` back since rewinding existed and it never reached
	 * the composer — so it was announced instead, and the notice carried the whole message:
	 * a paragraph in a toast, saying what the transcript above it already said, while the one
	 * place it would have been useful sat empty. The usual reason to rewind is to say the
	 * thing differently.
	 */
	await settle(page, 600);
	const draft = await page.locator(".dockfield").inputValue();
	say("the rewound message comes back in the input bar", draft === rewound, JSON.stringify(draft.slice(0, 60)));
	const toasts = await page.locator(".notice").allInnerTexts();
	say("…and the notice just says it happened", toasts.some((text) => text.trim() === "Rewound."), JSON.stringify(toasts));
	say(
		"…without repeating the message in a toast",
		toasts.every((text) => !text.includes(rewound.slice(0, 24))),
		JSON.stringify(toasts),
	);

	link.close();
	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	// The board is a fixture, and this check deliberately rewrites it.
	const { write } = await import("../harness.mjs");
	write(plan, original);
	await settle(page, 500);
	await browser.close();
}
