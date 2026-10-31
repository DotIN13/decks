/**
 * The time machine (DESIGN §6.7): previewing a turn shows the boards as they were,
 * restoring writes them back, and rewinding truncates the transcript.
 *
 * Needs a model, because the thing being travelled through is a real conversation.
 */
import { ask, cardFile, newAgent, open, openHistory, read, say, settle, socket } from "../harness.mjs";

const plan = await cardFile("plan");
const original = read(plan);

const { browser, page, errors } = await open();
try {
	// A fresh agent, so the history is this run's, on the runtime named by its menu label
	// ("Pi", "Claude Code", "OpenCode", "OpenCode 2"): rewind and fork are each runtime's own.
	// DECKS_E2E_KIND ("claude", "opencode2", …) then asserts the chat really is that runtime.
	await newAgent(page, process.env.DECKS_E2E_RUNTIME ?? "pi");
	await settle(page, 1200);
	await page.mouse.move(800, 500);

	await ask(page, "Add a sticky to canvases/auth-refresh/cards/plan/index.html with data-id 'timecheck' at left 1264px top 780px saying 'first turn'. Just do it, briefly.");
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

	/* `.stream-mine` is a user message, and Rewind and Fork are the buttons under it. */
	await openHistory(page);
	await page.waitForSelector(".stream .stream-mine", { timeout: 8000 });
	const mine = page.locator(".stream .stream-mine");
	const rows = await mine.count();
	say("each user message is a point you can return to", rows >= 2, `${rows} messages`);
	say("…by two buttons under it, not a menu", (await mine.first().locator(".stream-act").count()) === 2 && (await mine.first().locator(".stream-rw").count()) === 0);
	const link = await socket();

	// Rewinding truncates the conversation.
	const before = await page.locator(".stream .stream-roll > *").count();
	const last = mine.last();
	const rewound = (await last.locator(".stream-bubble").innerText()).trim();
	await last.hover();
	await last.getByRole("button", { name: "Rewind to here" }).click();
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
	const draft = await page.locator(".dockfield").evaluate((el) => el.textContent);
	say("the rewound message comes back in the input bar", draft === rewound, JSON.stringify(draft.slice(0, 60)));
	const toasts = await page.locator(".notice").allInnerTexts();
	say("…and the notice just says it happened", toasts.some((text) => text.trim() === "Rewound."), JSON.stringify(toasts));
	say(
		"…without repeating the message in a toast",
		toasts.every((text) => !text.includes(rewound.slice(0, 24))),
		JSON.stringify(toasts),
	);

	/*
	 * The runtime really went back, not only the transcript on screen.
	 *
	 * Asked from memory, so the board cannot answer for it:
	 * a runtime whose conversation still held the second turn would say "second turn".
	 */
	const lastReply = async () => (await page.locator(".stream .stream-roll > *").last().innerText()).trim();
	await page.locator(".dockfield").fill("");
	await ask(page, "Without reading or touching any file: what is the last text you gave that sticky in this conversation? Reply with just that text.");
	const remembered = await lastReply();
	say("after a rewind the model no longer remembers the rewound turn", /first turn/i.test(remembered) && !/second turn/i.test(remembered), JSON.stringify(remembered.slice(-80)));

	/*
	 * A fork from that question opens a new chat holding everything before it: the first turn,
	 * and not the rewound second one. Counted, not looked for by name: a fork can take its
	 * parent's name.
	 */
	const chatIds = () => new Set((link.last("agents")?.chats ?? []).map((chat) => chat.id));
	const chatsBefore = chatIds();
	const third = mine.last();
	await third.hover();
	await third.getByRole("button", { name: "Fork from here" }).click();
	let forkId;
	for (let waited = 0; waited < 30000 && !forkId; waited += 250) {
		forkId = [...chatIds()].find((id) => !chatsBefore.has(id));
		if (!forkId) await settle(page, 250);
	}
	say("forking opens a new chat", Boolean(forkId));
	const forkKind = (link.last("agents")?.chats ?? []).find((chat) => chat.id === forkId)?.kind;
	say(
		"…on the runtime this run is about",
		!process.env.DECKS_E2E_KIND || forkKind === process.env.DECKS_E2E_KIND,
		`${forkKind}${process.env.DECKS_E2E_KIND ? ` (asked for ${process.env.DECKS_E2E_KIND})` : ""}`,
	);
	const forkWarnings = (await page.locator(".notice").allInnerTexts()).filter((text) => /nothing before that message/i.test(text));
	say("…without saying there is nothing to fork", forkWarnings.length === 0, JSON.stringify(forkWarnings));
	await settle(page, 1500);
	await ask(page, "Without reading or touching any file: what text did you give that sticky in this conversation? Reply with just that text.");
	say(
		"…and the page moved to it, so the next message went to the fork",
		link.received.some((message) => message.type === "agent.state" && message.id === forkId && message.state !== "idle"),
	);
	const forked = await lastReply();
	say("the fork remembers the conversation before the fork point", /first turn/i.test(forked) && !/second turn/i.test(forked), JSON.stringify(forked.slice(-80)));

	link.close();
	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	// The board is a fixture, and this check deliberately rewrites it.
	const { write } = await import("../harness.mjs");
	write(plan, original);
	await settle(page, 500);
	await browser.close();
}
