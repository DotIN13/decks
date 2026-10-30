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
 * What each of them *opens* — the plan windows, the per-model spend, the scan — was
 * `usage.mjs`, which has been cut from the suite and is covered by nothing now. This file is
 * about which of the two is drawn at which width.
 */
import { canvasFrame, open, resetStage, say, settle, ready, rest } from "../harness.mjs";

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
	chats: [{ id: "A", name: "Ada", kind: "claude", state: "idle", lastAt: Date.now(), unread: 0, identity: { name: "Ada", color: "#3b5cf6" }, boards: [], inPlay: [] }],
};

// --- a fine pointer: the dial under the box -----------------------------------------

{
	const { browser, page, errors } = await open({ width: 1500, height: 1000 });
	await page.addInitScript(wrap);
	await page.reload({ waitUntil: "load" });
	await ready(page);
	await rest(page, { start: 0 });
	const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
	await feed(agent);
	await settle(page, 400);

	/*
	 * Nothing before the agent has reported. `contextTokens` is `number | null` and the null
	 * is load-bearing: it means "not known yet", which is a different claim from "empty" —
	 * and a ring at zero makes the wrong one, which is the one somebody would act on.
	 */
	/*
	 * On a desktop the reading is the composer's dial (`chat/composer/ContextDial.tsx`, in
	 * `.composer-ctx`): a ring and the percentage, which opens the numbers as a popover. `⋯` has
	 * no context row here any more — that row is a phone's (below) — but it still wears the warning.
	 */
	const dial = () =>
		page.evaluate(() => {
			const element = document.querySelector(".composer-ctx .dial");
			return element ? { text: element.textContent.replace(/\s+/g, " ").trim(), ring: element.querySelectorAll(".ctx-ring").length, level: element.dataset.level } : null;
		});
	say("no dial before the agent has reported", (await dial()) === null, JSON.stringify(await dial()));

	await feed({ type: "agent.usage", id: "A", usage: { contextTokens: 148_000, contextWindow: 200_000, cost: 1.234 } });
	await settle(page, 500);
	const level = await page.locator('button[aria-label="More"]').first().getAttribute("data-level");
	say("the ⋯ button wears the warning, amber past 70%", level === "warn", String(level));
	const reading = await dial();
	say("the composer has the dial on a desktop", reading !== null, JSON.stringify(reading));
	say("…a ring and the percentage, amber too", reading?.ring === 1 && /74%/.test(reading?.text ?? "") && reading?.level === "warn", JSON.stringify(reading));
	await page.locator('button[aria-label="More"]').first().click();
	await settle(page, 400);
	const inMenu = await page.evaluate(() => [...document.querySelectorAll(".popover [data-row]")].some((row) => /context usage/i.test(row.innerText ?? "")));
	say("…and `⋯` has no second copy of it", !inMenu, String(inMenu));
	await page.keyboard.press("Escape");
	await settle(page, 250);
	await page.locator(".composer-ctx .dial").click();
	await settle(page, 600);
	const numbers = await page.evaluate(() => ({ popover: document.querySelectorAll(".popover").length, percent: document.querySelector(".popover .big")?.textContent }));
	say("…and pressing it opens the numbers", numbers.popover === 1 && numbers.percent === "74%", JSON.stringify(numbers));
	await page.keyboard.press("Escape");
	await settle(page, 300);

	say("no console errors on a desktop", errors.length === 0, errors.join(" | "));
	await browser.close();
}

// --- a coarse pointer: one row in ⋯, opening a modal --------------------------------

{
	const { browser, page, errors } = await open({ device: "iPhone 14 Pro" });
	await page.addInitScript(wrap);
	await page.reload({ waitUntil: "load" });
	await ready(page);
	await rest(page, { start: 0 });
	const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
	await feed(agent);
	await feed({ type: "agent.usage", id: "A", usage: { contextTokens: 148_000, contextWindow: 200_000, cost: 1.234 } });
	await settle(page, 500);

	/*
	 * The hint row is gone on a touchscreen — every other thing in it names a key — so the
	 * dial goes with it. That is the whole reason the `⋯` row exists.
	 */
	const under = await page.evaluate(() => {
		const element = document.querySelector(".hint-row");
		return element ? getComputedStyle(element).display : "absent";
	});
	say("no dial under the box on a phone", under === "none" || under === "absent", under);

	await page.locator('button[aria-label="More"]').first().click();
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

	/*
	 * Every window the account has, and not only the one it is closest to filling.
	 *
	 * The payload states the same windows twice — a block of named buckets and an
	 * undocumented `limits[]` array that is shorter and uses other names — and reading only
	 * the array drew one row on a live account whose CLI panel showed three. The report is
	 * fed here because a real one is a two-second round trip to a signed-in CLI.
	 */
	await feed({
		type: "agent.report",
		id: "A",
		report: {
			kind: "claude",
			subscription: "max",
			account: "ada@example.com",
			limits: [
				{ key: "five_hour", label: "5-hour window", percent: 15, resetsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), active: true },
				{ key: "seven_day", label: "7-day window", percent: 61, resetsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), active: true },
				{ key: "seven_day_fable", label: "7-day (Fable)", percent: 33, resetsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), active: true },
				{ key: "seven_day_cowork", label: "7-day (Cowork)", percent: 0, resetsAt: null, active: false },
			],
			session: { costUsd: 1.25, tokens: { input: 1290, output: 840, cacheRead: 400_000, cacheWrite: 20_000 }, models: [], durationMs: null, apiDurationMs: null, linesAdded: null, linesRemoved: null },
			behaviors: null,
		},
	});
	await settle(page, 400);
	const windows = await page.evaluate(() => ({
		rows: [...document.querySelectorAll('[data-group="limits"] .usage-limit')].map((row) => ({
			label: row.querySelector(".usage-limit-label")?.textContent,
			value: row.querySelector(".usage-limit-value")?.textContent,
			foot: row.querySelector(".usage-limit-reset")?.textContent,
			dim: row.classList.contains("dormant"),
		})),
		whose: document.querySelector('[data-group="limits"] .set-note')?.textContent,
	}));
	say("the plan section draws every window the account has", windows.rows.length === 4, JSON.stringify(windows.rows.map((row) => row.label)));
	/* In the order the report gives them, which is the server's — fullest first, in force
	   first, and unit-tested in `usage.test.ts`. What matters here is that a per-model week
	   is drawn at all: reading only `limits[]` is what used to lose it. */
	say(
		"…including the per-model week, with its own share",
		windows.rows.some((row) => row.label === "7-day (Fable)" && row.value === "33%"),
		JSON.stringify(windows.rows),
	);
	say(
		"…and a window the account is not on is dimmed and says so",
		windows.rows.at(-1)?.dim === true && /not in force/.test(windows.rows.at(-1)?.foot ?? ""),
		JSON.stringify(windows.rows.at(-1)),
	);
	say("…under the account whose windows they are", /ada@example.com/.test(windows.whose ?? ""), windows.whose ?? "");

	/*
	 * Reopening it draws the last reading at once rather than "Reading…".
	 *
	 * And the read it starts on the way in *fails* here, because the agent in this check is
	 * fed to the browser and the server has never heard of it — which is the second half of
	 * the assertion and the older bug: the answer used to be written straight over the
	 * state, so a failed read emptied the panel it was apologising in.
	 */
	await page.locator(".usage-modal [aria-label='Close']").click();
	await settle(page, 300);
	await page.locator('button[aria-label="More"]').first().click();
	await settle(page, 300);
	await page.locator(".popover [data-row]").filter({ hasText: /context usage/i }).click();
	await settle(page, 600);
	const again = await page.evaluate(() => ({
		rows: document.querySelectorAll('[data-group="limits"] .usage-limit').length,
		empty: document.querySelectorAll('[data-group="limits"] .usage-empty').length,
		stale: document.querySelector(".usage-modal .usage-stale")?.textContent,
	}));
	say("reopening it shows the last reading instead of waiting", again.rows === 4 && again.empty === 0, JSON.stringify(again));
	say("…and a read that fails says so over the figures, which stay", again.rows === 4 && /Could not read usage/.test(again.stale ?? ""), JSON.stringify(again));

	await page.locator(".usage-modal [aria-label='Close']").click();
	await settle(page, 400);
	say("and it closes", (await page.evaluate(() => document.querySelectorAll(".usage-modal").length)) === 0);

	say("no console errors on a phone", errors.length === 0, errors.join(" | "));
	await browser.close();
}

// --- a coarse pointer: no bars, and a tapped board's menu, in the canvas frame ------------

/*
 * Its own context, and no synthetic agent in it: `resetStage` plays the deck onto the agent the
 * server has focused, so a fed agent in place would put the boards on a canvas the browser is not
 * looking at. A touchscreen draws no title bars; a tap selects a board, and its actions are a
 * menu over it (`canvas/BoardCallout.tsx`). A board is only its picture now, with no edge band of
 * its own to carry it by (a card's is `stage-gestures.mjs`'s and `card-phone.mjs`'s to check).
 */
{
	// The fixture laid out before the page opens, so the page lands on it (it lands at once now, not 3 s later).
	await resetStage();
	const { browser, page, errors } = await open({ device: "iPhone 14 Pro" });
	await settle(page, 1400);
	const canvas = await canvasFrame(page);
	const bars = await canvas.evaluate(() => document.querySelectorAll(".bar-layer .chrome").length);
	say("a touchscreen draws no title bars", bars === 0, `${bars} bars`);
	const target = await canvas.evaluate(() => {
		// The part of each board inside the open screen (under the toolbar, over the composer), and the board with the most of it.
		const open = { x1: 8, y1: 100, x2: innerWidth - 8, y2: innerHeight - 170 };
		// The stage's boards, pictures among them: a phone has one live page at most (`device.ts`), and a tap on a picture selects it as on a page.
		const found = (globalThis.__decksBoards?.() ?? [])
			.map(({ path, rect: r }) => {
				const x1 = Math.max(r.left, open.x1), y1 = Math.max(r.top, open.y1), x2 = Math.min(r.right, open.x2), y2 = Math.min(r.bottom, open.y2);
				return { path, x1, y1, x2, y2, area: Math.max(0, x2 - x1) * Math.max(0, y2 - y1) };
			})
			.sort((a, b) => b.area - a.area)[0];
		return found && found.area > 0 ? { x: (found.x1 + found.x2) / 2, y: (found.y1 + found.y2) / 2, path: found.path } : null;
	});
	const under = target ? await canvas.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return `${e?.tagName}.${String(e?.className).split(" ")[0]} picture=${globalThis.__decksPictureAt?.(x, y)} zoom=${globalThis.__decksCameraTransform?.().match(/scale\(([\d.]+)/)?.[1]}`; }, [target.x, target.y]) : "no target";
	if (target) await page.touchscreen.tap(target.x, target.y);
	await settle(page, 900);
	// The board tapped: a picture has no node to say it is selected, so it is the one under the tap.
	const tapped = target?.path ?? null;
	const menu = await canvas.evaluate((path) => {
		const callout = document.querySelector(".board-callout");
		if (!callout) return null;
		const items = [...callout.querySelectorAll("[role=menuitem]")];
		const box = (el) => el.getBoundingClientRect();
		return {
			items: items.map((el) => el.getAttribute("aria-label") ?? ""),
			rows: new Set(items.map((el) => Math.round(box(el).y))).size,
			heights: [...new Set(items.map((el) => Math.round(box(el).height)))],
			inside: box(callout).left >= 0 && box(callout).right <= innerWidth,
			span: [Math.round(box(callout).left), Math.round(box(callout).right), innerWidth],
			// The pill is centred on the board's middle wherever that is, off the screen included (`BoardCallout.tsx`, `place`).
			centre: Math.round((box(callout).left + box(callout).right) / 2),
			boardMid: (() => {
				const r = (window.__decksBoards?.() ?? []).find((one) => one.path === path)?.rect;
				return r ? Math.round(r.left + r.width / 2) : null;
			})(),
		};
	}, tapped);
	say("a tap on a board shows its menu, with every action the bar had", menu !== null && ["Fit", "New tab", "Comment", "Hide"].every((word) => menu.items.includes(word)), JSON.stringify({ menu, under, tapped }));
	/*
	 * On the screen whenever the board's middle leaves it room: the pill keeps its edge, centred on what it is
	 * for, and is carried off the screen with it rather than pushed on (8075ccea). The board tapped is
	 * the one with the most of it in view, whose middle can still be off the side of a phone.
	 */
	const half = menu ? (menu.span[1] - menu.span[0]) / 2 : 0;
	const midOn = menu?.boardMid !== null && menu?.boardMid !== undefined && menu.boardMid - half >= 0 && menu.boardMid + half <= menu.span[2];
	say(
		"…on one row, centred on the board, every item a 40px target",
		menu !== null && menu.rows === 1 && menu.heights.length === 1 && menu.heights[0] >= 40 && menu.boardMid !== null && Math.abs(menu.centre - menu.boardMid) <= 2 && (!midOn || menu.inside),
		JSON.stringify(menu),
	);


	say("no console errors in a phone's board menu", errors.length === 0, errors.join(" | "));
	await browser.close();
}
