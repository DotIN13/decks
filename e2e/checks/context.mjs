/**
 * How full the context is, and the two places it is drawn.
 *
 * **A fine pointer gets a dial under the input bar**, at the right end of the hint row, and
 * pressing it opens the numbers as a popover. **A coarse pointer gets one row in `⋯`** — a
 * ring, the words "Context usage", the percentage — and pressing that opens the same numbers
 * as a modal.
 *
 * It lived in `⋯` at every width for a while, and that was half right: on a 393px screen
 * there is genuinely no room under the box, and on a desktop a reading you glance at twenty
 * times an hour should not be behind a menu you have to open to take the glance. So the test
 * that matters is that each width has exactly one of them, and that both open the same
 * component — `ContextSummary` is described once and only its container differs.
 *
 * The reading is fed over the socket. `AgentUsage` arrives from a runtime that has completed
 * a turn, so a real one costs a model and a minute; and the case that matters most —
 * **nothing drawn at all when the reading is unknown** — cannot be produced on demand,
 * because a real agent reports as soon as it has anything to report.
 *
 * What each of them *opens* — the plan windows, the per-model spend, the scan — is
 * `usage.mjs`. This file is about which of the two is drawn at which width.
 */
import { open, say, settle } from "../harness.mjs";

const wrap = () => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
		}
	};
};

const agent = {
	type: "agents",
	defaultKind: "pi",
	focused: "A",
	chats: [{ id: "A", name: "Ada", kind: "claude", state: "idle", lastAt: Date.now(), unread: 0, contextCount: 0, capabilities: { modes: [] }, commands: [] }],
};

// --- a fine pointer: the dial under the box -----------------------------------------

{
	const { browser, page, errors } = await open({ width: 1500, height: 1000 });
	await page.addInitScript(wrap);
	await page.reload({ waitUntil: "load" });
	await settle(page, 2500);
	const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
	await feed(agent);
	await settle(page, 400);

	/*
	 * Nothing before the agent has reported. `contextTokens` is `number | null` and the null
	 * is load-bearing: it means "not known yet", which is a different claim from "empty" —
	 * and a ring at zero makes the wrong one, which is the one somebody would act on.
	 */
	say("no dial before the agent has reported", (await page.evaluate(() => document.querySelectorAll(".hintrow .dial").length)) === 0);

	await feed({ type: "agent.usage", id: "A", usage: { contextTokens: 148_000, contextWindow: 200_000, cost: 1.234 } });
	await settle(page, 500);

	const dial = await page.evaluate(() => {
		const element = document.querySelector(".hintrow .dial");
		return element
			? {
					text: element.innerText.trim(),
					level: element.querySelector(".ctx-ring")?.dataset.level,
					visible: element.getBoundingClientRect().width > 0,
					atEnd: Math.abs(element.getBoundingClientRect().right - document.querySelector(".hintrow").getBoundingClientRect().right) < 12,
				}
			: null;
	});
	say("the dial is in the hint row under the box", dial?.visible === true, JSON.stringify(dial));
	say("…at its right end", dial?.atEnd === true, JSON.stringify(dial));
	say("…reading the percentage", dial?.text === "74%", JSON.stringify(dial?.text));
	/* Amber over 70 and red over 85 — the two points where the next long turn is the one that
	   gets truncated. The thresholds themselves are unit-tested in `context-usage.test.ts`. */
	say("…and amber, because 74% is past the first threshold", dial?.level === "warn", dial?.level);

	await page.locator(".hintrow .dial").click();
	await settle(page, 400);
	const popover = await page.evaluate(() => ({
		open: Boolean(document.querySelector(".popover .big")),
		percent: document.querySelector(".popover .big")?.textContent,
		used: [...document.querySelectorAll(".popover .kv")].map((row) => row.innerText.replace(/\s+/g, " ").trim()),
		modal: document.querySelectorAll(".usage-modal").length,
	}));
	say("pressing it opens the numbers as a popover", popover.open && popover.percent === "74%", JSON.stringify(popover.percent));
	say("…with the figures behind the percentage", popover.used.some((row) => /148,000/.test(row)) && popover.used.some((row) => /200,000/.test(row)), JSON.stringify(popover.used));
	/* A popover, not a modal: this is the glance. The panel behind its last row is a modal
	   and is `usage.mjs`'s subject. */
	say("…and no modal on a desktop", popover.modal === 0, String(popover.modal));

	/* The `⋯` row is the phone's answer and must not be drawn here as well. */
	await page.keyboard.press("Escape");
	await settle(page, 250);
	await page.locator('.pill button[aria-label^="More"]').click();
	await settle(page, 400);
	const inMenu = await page.evaluate(
		() => [...document.querySelectorAll(".popover [data-row]")].filter((row) => /context usage/i.test(row.innerText ?? "") && getComputedStyle(row).display !== "none").length,
	);
	say("the ⋯ menu has no context row on a fine pointer", inMenu === 0, String(inMenu));

	say("no console errors on a desktop", errors.length === 0, errors.join(" | "));
	await browser.close();
}

// --- a coarse pointer: one row in ⋯, opening a modal --------------------------------

{
	const { browser, page, errors } = await open({ device: "iPhone 14 Pro" });
	await page.addInitScript(wrap);
	await page.reload({ waitUntil: "load" });
	await settle(page, 2500);
	const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
	await feed(agent);
	await feed({ type: "agent.usage", id: "A", usage: { contextTokens: 148_000, contextWindow: 200_000, cost: 1.234 } });
	await settle(page, 500);

	/*
	 * The hint row is gone on a touchscreen — every other thing in it names a key — so the
	 * dial goes with it. That is the whole reason the `⋯` row exists.
	 */
	const under = await page.evaluate(() => {
		const element = document.querySelector(".hintrow");
		return element ? getComputedStyle(element).display : "absent";
	});
	say("no dial under the box on a phone", under === "none" || under === "absent", under);

	await page.locator('.pill button[aria-label^="More"]').click();
	await settle(page, 400);
	const row = await page.evaluate(() => {
		const element = [...document.querySelectorAll(".popover [data-row]")].find((candidate) => /context usage/i.test(candidate.innerText ?? ""));
		return element ? { text: element.innerText.replace(/\s+/g, " ").trim(), ring: element.querySelectorAll(".ctx-ring").length } : null;
	});
	say("`⋯` has one row for it instead", row !== null, JSON.stringify(row));
	say("…a ring, the words, and the percentage", row?.ring === 1 && /Context usage/.test(row?.text ?? "") && /74%/.test(row?.text ?? ""), JSON.stringify(row));

	await page.locator(".popover [data-row]").filter({ hasText: /context usage/i }).click();
	await settle(page, 600);
	const modal = await page.evaluate(() => ({
		modal: document.querySelectorAll(".usage-modal").length,
		percent: document.querySelector(".usage-modal .big")?.textContent,
		tokens: document.querySelector('.usage-modal [data-group="conversation"] .usage-note')?.textContent?.replace(/\s+/g, " ").trim(),
		popover: document.querySelectorAll(".popover").length,
		/* It fits, and it scrolls rather than overflowing: 393px is the width this modal
		   exists for. */
		width: Math.round(document.querySelector(".usage-modal")?.getBoundingClientRect().width ?? 0),
		inside: (() => {
			const box = document.querySelector(".usage-modal")?.getBoundingClientRect();
			return box ? box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight : false;
		})(),
	}));
	/*
	 * A modal rather than a popover, which is the whole reason the row is a row: a 280px card
	 * hanging off a menu on a 393px screen is a card with nowhere to hang — clamped to the
	 * edge, over the menu it came from, and under the thumb reaching for either.
	 *
	 * And it opens the *panel*, not a second copy of the numbers. There were two modals here
	 * for a while — one for the context reading and one for the plan — which is one modal
	 * more than there are answers.
	 */
	say("pressing it opens the panel, not a popover", modal.modal === 1 && modal.popover === 0, JSON.stringify(modal));
	say("…with the same reading in it, drawn without waiting for the server", modal.percent === "74%" && /148,000 of 200,000/.test(modal.tokens ?? ""), JSON.stringify([modal.percent, modal.tokens]));
	say("…inside a 393px screen", modal.inside && modal.width <= 393 - 24, `${modal.width}px`);

	await page.locator(".usage-modal [aria-label='Close']").click();
	await settle(page, 400);
	say("and it closes", (await page.evaluate(() => document.querySelectorAll(".usage-modal").length)) === 0);

	say("no console errors on a phone", errors.length === 0, errors.join(" | "));
	await browser.close();
}
