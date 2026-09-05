/**
 * The column while a reply is arriving: what it draws, and what that costs.
 *
 * Two complaints from one sitting, and they are the same moment seen twice. **An empty card
 * appeared and sat there** — the reply was announced at `message_start`, before a token, so
 * a model that thinks first or a turn that opens with a tool call drew a box with nothing in
 * it. And **scrolling was janky while a reply arrived**, which turned out to be the markdown
 * for every card in the history being re-parsed on every token.
 *
 * The first half is asserted on what is on the screen. The second is a wall-clock
 * measurement, so it is asserted loosely — it is here to catch work that grows with the
 * length of the reply, not to police a frame rate.
 */
import { writeFileSync } from "node:fs";
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();
try {
	await page.addInitScript(() => {
		const Real = window.WebSocket;
		window.WebSocket = class extends Real {
			constructor(...args) {
				super(...args);
				window.__ws = this;
			}
		};
	});
	await page.reload({ waitUntil: "load" });
	await settle(page, 2500);

	const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));

	await feed({
		type: "agents",
		defaultKind: "pi",
		focused: "A",
		chats: [{ id: "A", name: "Ada", kind: "claude", state: "streaming", lastAt: Date.now(), unread: 0, contextCount: 0, capabilities: { modes: [] }, commands: [] }],
	});

	// A history worth scrolling: 30 turns of real markdown, not one-liners.
	const para =
		"This is a paragraph of the reply with **bold**, `code` and a [link](https://example.com) in it, long enough to wrap across several lines in the column. ";
	const items = [];
	const base = Date.now() - 200_000;
	for (let i = 0; i < 30; i++) {
		items.push({ id: `u${i}`, kind: "user", text: `Question number ${i}`, at: base + i * 1000 });
		items.push({ id: `a${i}`, kind: "assistant", text: `${para.repeat(3)}\n\n- one\n- two\n- three\n\n${para}`, at: base + i * 1000 + 400 });
	}
	/*
	 * A question, and then the reply to it that has not said anything yet — which is exactly
	 * what `message_start` used to put on the screen. The question is there so the reply is a
	 * card of its own: consecutive things the agent says fold into one card, and a count that
	 * cannot change is not an assertion.
	 */
	items.push({ id: "u-last", kind: "user", text: "And one more thing", at: Date.now() - 1000 });
	items.push({ id: "live", kind: "assistant", text: "", at: Date.now(), streaming: true });
	await feed({ type: "chat.history", agentId: "A", items });
	await settle(page, 300);

	await page.evaluate(() => {
		const button = [...document.querySelectorAll(".pill button")].find((candidate) => /conversation/i.test(candidate.getAttribute("aria-label") ?? ""));
		button?.click();
	});
	await settle(page, 800);

	// --- an empty reply is not a card ---------------------------------------------------

	const column = () =>
		page.evaluate(() => ({
			cards: document.querySelectorAll("[data-card]").length,
			empty: [...document.querySelectorAll("[data-card]")].filter((card) => !card.innerText.trim()).length,
			sign: document.querySelector(".stream-working") !== null,
			tail: [...document.querySelectorAll("[data-card] .md")].at(-1)?.innerText?.trim().slice(0, 12) ?? null,
		}));

	const opened = await column();
	/*
	 * 61: thirty turns of two cards each, plus the question just asked. The reply to it is
	 * the card that must *not* be there — the history above ends with exactly the item
	 * `message_start` used to send, and nothing else.
	 */
	say("a reply that has not spoken yet draws no card", opened.cards === 61, `${opened.cards} cards`);
	say("…and no card is empty", opened.empty === 0, `${opened.empty} empty`);
	say("…because the working sign is what says it has started", opened.sign);

	await feed({ type: "chat.delta", agentId: "A", itemId: "live", delta: "Right then." });
	await settle(page, 300);
	const spoke = await column();
	say("the card arrives with the first thing said", spoke.cards === 62 && spoke.tail === "Right then.", `${spoke.cards} cards, tail ${spoke.tail}`);
	say("…and it is not empty", spoke.empty === 0, `${spoke.empty} empty`);

	const run = await page.evaluate(async () => {
		const roll = document.querySelector(".stream-roll");
		if (!roll) return { error: "no column" };
		const frames = [];
		let long = 0;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) long += entry.duration;
		}).observe({ entryTypes: ["longtask"] });

		let last = performance.now();
		let running = true;
		let up = true;
		const tick = () => {
			const now = performance.now();
			frames.push(now - last);
			last = now;
			// Drive the scroll the way a reader would, and turn round at the ends.
			if (up && roll.scrollTop <= 0) up = false;
			if (!up && roll.scrollTop >= roll.scrollHeight - roll.clientHeight - 1) up = true;
			roll.scrollTop += up ? -60 : 60;
			if (running) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);

		const word = "streaming words arrive a few at a time and the column has to keep up with them ";
		const started = performance.now();
		for (let i = 0; i < 80; i++) {
			window.__ws.dispatchEvent(
				new MessageEvent("message", { data: JSON.stringify({ type: "chat.delta", agentId: "A", itemId: "live", delta: word }) }),
			);
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		const elapsed = performance.now() - started;
		running = false;
		await new Promise((resolve) => setTimeout(resolve, 120));

		const sorted = [...frames].sort((a, b) => a - b);
		const at = (q) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0);
		return {
			frames: frames.length,
			elapsed: Math.round(elapsed),
			fps: Math.round((frames.length / elapsed) * 1000),
			median: at(0.5),
			p95: at(0.95),
			worst: Math.round(sorted.at(-1) ?? 0),
			longTaskMs: Math.round(long),
			chars: [...document.querySelectorAll("[data-card] .md")].at(-1)?.innerText?.length ?? 0,
		};
	});

	console.log("   ", JSON.stringify(run));
	// The numbers, where a run comparing two builds can pick them up.
	if (process.env.DECKS_PERF_OUT) writeFileSync(process.env.DECKS_PERF_OUT, JSON.stringify(run));
	say("the column kept streaming and scrolling", run.chars > 4000, `${run.chars} chars in the growing reply`);
	/*
	 * A generous ceiling, because this is a wall-clock number on a shared machine — it is not
	 * here to police 60fps but to catch work that grows with the length of the reply. A
	 * quadratic parse puts the worst frame in the hundreds of milliseconds.
	 */
	say("…without a frame long enough to feel like a stall", run.worst < 250, `worst frame ${run.worst}ms`);
	say("…and at a rate you can read at", run.fps >= 24, `${run.fps}fps, p95 ${run.p95}ms`);
	say("no console errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
