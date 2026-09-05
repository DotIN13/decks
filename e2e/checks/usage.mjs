/**
 * The usage panel: the plan, the spend, and what has been driving it.
 *
 * This replaced a card above the input bar that both runtimes filled in themselves — a
 * title and a list of `label: value` strings like `"42% (148000 / 200000 tokens)"`. The
 * figures are structured now (`UsageReport`), which is what makes a meter a meter and a
 * reset a countdown, and this file is about the things that only became possible once they
 * were: a bar that earns its colour, a window that says when it turns over, and three
 * different kinds of nothing said in three different sets of words.
 *
 * The report is fed over the socket. A real one is a control round trip to a running
 * runtime, so producing the interesting cases — an account at 88% of its five-hour window,
 * a payload with a behaviour scan in it, a read that failed — would mean owning the
 * account rather than the browser. What a real server does with the *request* is checked
 * too, at the end: a report asked for an agent that is gone comes back as an error rather
 * than as silence.
 */
import { open, say, settle } from "../harness.mjs";

/*
 * The socket, kept and half-muzzled.
 *
 * `__sent` is every frame the app asked for, which is how "opening it asks the server" is
 * checked. `__swallowReport` drops the report requests on the way out *without* hiding them
 * from `__sent`, and that is not a trick for its own sake: this check drives a synthetic
 * agent, so the real server answers a report for it in milliseconds with "that agent is
 * gone" — and a panel that has already failed cannot be caught mid-read. Muzzled, the
 * waiting state holds still long enough to assert.
 */
const wrap = () => {
	if (window.top !== window.self) return;
	window.__swallowReport = true;
	const Real = window.WebSocket;
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
			const send = this.send.bind(this);
			this.send = (data) => {
				const text = String(data);
				(window.__sent ??= []).push(text);
				if (window.__swallowReport && text.includes('"agent.report"')) return undefined;
				return send(data);
			};
		}
	};
};

const chat = (id, name, kind) => ({
	id,
	name,
	kind,
	state: "idle",
	lastAt: Date.now(),
	unread: 0,
	contextCount: 0,
	capabilities: { modes: [] },
	commands: [],
});

const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

const REPORT = {
	kind: "claude",
	subscription: "max",
	account: "ada@example.com",
	limits: [
		{ key: "session", label: "5-hour window", percent: 88, resetsAt: hours(3.5) },
		{ key: "weekly", label: "7-day window", percent: 54, resetsAt: hours(100) },
		{ key: "weekly_scoped:opus", label: "7-day window (opus)", percent: 72, resetsAt: null },
	],
	session: {
		costUsd: 1.2486,
		tokens: { input: 1290, output: 840, cacheRead: 402_000, cacheWrite: 20_400 },
		models: [
			{ model: "claude-opus-5[1m]", tokens: { input: 1200, output: 800, cacheRead: 400_000, cacheWrite: 20_000 }, costUsd: 1.248 },
			{ model: "claude-haiku-4-5-20251001", tokens: { input: 90, output: 40, cacheRead: 2000, cacheWrite: 400 }, costUsd: 0.002 },
		],
		durationMs: 605_000,
		apiDurationMs: 41_000,
		linesAdded: 120,
		linesRemoved: 8,
	},
	behaviors: {
		day: {
			requests: 1044,
			sessions: 7,
			behaviors: [{ key: "long_context", percent: 97, count: 891 }],
			agents: [],
			skills: [],
			plugins: [],
			mcpServers: [{ name: "plugin:chrome-devtools-mcp:chrome-devtools", percent: 33 }],
		},
		week: { requests: 2768, sessions: 13, behaviors: [{ key: "cache_miss", percent: 12, count: 44 }], agents: [], skills: [], plugins: [], mcpServers: [] },
	},
};

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await page.addInitScript(wrap);
await page.reload({ waitUntil: "load" });
await settle(page, 2500);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const sent = () => page.evaluate(() => (window.__sent ?? []).map((text) => JSON.parse(text)));

await feed({ type: "agents", defaultKind: "pi", focused: "A", chats: [chat("A", "Ada", "claude"), chat("B", "Bo", "pi")] });
await feed({ type: "agent.usage", id: "A", usage: { contextTokens: 148_000, contextWindow: 200_000, cost: 1.2486 } });
await settle(page, 400);

// --- opening it ---------------------------------------------------------------------

await page.locator(".hintrow .dial").click();
await settle(page, 300);
await page.locator(".popover [data-row]").filter({ hasText: /usage and limits/i }).click();
await settle(page, 400);

say("the dial's last row opens the panel", (await page.evaluate(() => document.querySelectorAll(".usage-modal").length)) === 1);

/*
 * Read on opening, not subscribed to. Two of the three parts are running totals and the
 * third is a countdown, so the panel asks when somebody is looking at it and at no other
 * time.
 */
const asked = (await sent()).filter((message) => message.type === "agent.report");
say("…and asks the server for the reading", asked.length === 1 && asked[0].id === "A", JSON.stringify(asked));

/*
 * The context section needs no round trip — the browser already has that reading — so it is
 * drawn while the rest is still on its way. This is the half of the panel a phone used to
 * get on its own, and it should not wait for the plan.
 */
const early = await page.evaluate(() => ({
	percent: document.querySelector(".usage-modal .big")?.textContent,
	waiting: [...document.querySelectorAll(".usage-modal .usage-empty")].map((node) => node.textContent),
	spinning: document.querySelectorAll(".usage-modal .usage-spin").length,
}));
say("the context reading is there before the report is", early.percent === "74%", JSON.stringify(early.percent));
say("…and the parts that are still coming say so", early.waiting.some((text) => /Reading/.test(text ?? "")), JSON.stringify(early.waiting));
say("…with the refresh button turning while it does", early.spinning === 1, String(early.spinning));

// The read is allowed through from here on; the answers below are fed by hand.
await page.evaluate(() => {
	window.__swallowReport = false;
});
await feed({ type: "agent.report", id: "A", report: REPORT });
await settle(page, 500);

// --- the plan -----------------------------------------------------------------------

const limits = await page.evaluate(() =>
	// Scoped to the group: the scan below draws the same row shape for its behaviours.
	[...document.querySelectorAll('.usage-modal [data-group="limits"] .usage-limit')].map((row) => ({
		label: row.querySelector(".usage-limit-label")?.textContent,
		value: row.querySelector(".usage-limit-value")?.textContent,
		level: row.querySelector(".track")?.dataset.level,
		width: row.querySelector(".track > i")?.style.width,
		reset: row.querySelector(".usage-limit-reset")?.textContent,
		clock: row.querySelector(".usage-limit-reset")?.getAttribute("title"),
	})),
);

say("every window is drawn, in the order the server sent", limits.length === 3 && limits[0].label === "5-hour window", JSON.stringify(limits.map((row) => row.label)));
say("…as a percentage and a bar of the same length", limits[0].value === "88%" && limits[0].width === "88%", JSON.stringify([limits[0].value, limits[0].width]));
/*
 * Colour is earned: 88% is red, 72% amber, 54% neither. The two thresholds are `usageLevel`
 * in `chrome/context-usage.ts` — the same function the context ring uses, so a bar and a
 * ring a click apart cannot disagree about what nearly-full looks like.
 */
say("…and a colour only when the reading has earned one", limits[0].level === "high" && limits[1].level === undefined && limits[2].level === "warn", JSON.stringify(limits.map((row) => row.level ?? "-")));
/* The countdown is the answer; the wall-clock time is for deciding whether to wait, so it
   is one hover away. */
say("a window says when it turns over", /resets in 3h/.test(limits[0].reset ?? ""), JSON.stringify(limits[0].reset));
say("…with the wall-clock time on hover", Boolean(limits[0].clock) && /\d/.test(limits[0].clock), JSON.stringify(limits[0].clock));
say("…and no countdown at all for a window that has no reset", limits[2].reset === undefined || limits[2].reset === null, JSON.stringify(limits[2].reset));

/*
 * Whose limits these are. This install rotates between several Claude subscriptions on its
 * own when one runs out, so "88% of the 5-hour window" is a reading with no subject until
 * the panel names the account it belongs to.
 */
const subject = await page.evaluate(() => document.querySelector('.usage-modal [data-group="limits"] .set-note')?.textContent);
say("the plan and the account are named, because the windows belong to one", /Max plan/.test(subject ?? "") && /ada@example.com/.test(subject ?? ""), JSON.stringify(subject));

// --- the conversation ---------------------------------------------------------------

const facts = await page.evaluate(() => {
	const pairs = [...document.querySelectorAll(".usage-modal .usage-facts > div")].map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]);
	return {
		pairs,
		tokens: document.querySelector('.usage-modal [data-group="conversation"] .usage-note')?.textContent,
		models: [...document.querySelectorAll(".usage-modal .usage-table tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent)),
	};
});
say("the conversation's figures are drawn as facts", facts.pairs.length === 8, JSON.stringify(facts.pairs.map(([key]) => key)));
/* Not `$1.25`: a session that cost a third of a cent is not a free one, and rounding to two
   decimals is how it would read as one. See `usage-format.ts`. */
say("…the cost at the precision the amount deserves", facts.pairs.find(([key]) => key === "Cost")?.[1] === "$1.25", JSON.stringify(facts.pairs[0]));
say("…the context in full, since that one is a count", /148,000 of 200,000/.test(facts.tokens ?? ""), JSON.stringify(facts.tokens));
/* The provider prefix and the date suffix are on every row and carry nothing; the bracket
   is a different context window and a different price, which is the table's whole subject. */
say("a model row is labelled by what makes it different", facts.models[0]?.[0] === "opus-5[1m]" && facts.models[1]?.[0] === "haiku-4-5", JSON.stringify(facts.models.map((row) => row[0])));
say("…dearest first", facts.models[0]?.[4] === "$1.25", JSON.stringify(facts.models[0]));

// --- what's using it ----------------------------------------------------------------

const scan = await page.evaluate(() => ({
	note: document.querySelector('.usage-modal [data-group="behaviors"] .usage-note')?.textContent,
	rows: [...document.querySelectorAll('.usage-modal [data-group="behaviors"] .usage-limit-label')].map((node) => node.textContent),
	/* Overlapping characteristics: they do not sum to 100, so an amber bar here would be
	   reporting a limit that is not one. */
	levels: [...document.querySelectorAll('.usage-modal [data-group="behaviors"] .track')].map((node) => node.dataset.level ?? "-"),
	shares: [...document.querySelectorAll(".usage-modal .usage-share-name")].map((node) => node.textContent),
}));
say("the scan says what it counted", /1,044 requests across 7 sessions/.test(scan.note ?? ""), JSON.stringify(scan.note));
say("…a behaviour key in words", scan.rows.includes("Long context"), JSON.stringify(scan.rows));
say("…never coloured, because these overlap and are not limits", scan.levels.every((level) => level === "-"), JSON.stringify(scan.levels));
say("…and what it attributes the usage to", scan.shares.some((name) => /chrome-devtools/.test(name ?? "")), JSON.stringify(scan.shares));

await page.locator('.usage-modal [data-group="behaviors"] .seg > button').filter({ hasText: "7 days" }).click();
await settle(page, 300);
const week = await page.evaluate(() => ({
	note: document.querySelector('.usage-modal [data-group="behaviors"] .usage-note')?.textContent,
	rows: [...document.querySelectorAll('.usage-modal [data-group="behaviors"] .usage-limit-label')].map((node) => node.textContent),
}));
say("the switch changes the window rather than the panel", /2,768 requests/.test(week.note ?? "") && week.rows.includes("Cache misses"), JSON.stringify(week));

// --- a read that failed -------------------------------------------------------------

await feed({ type: "agent.report", id: "A", error: "The CLI would not answer: session closed." });
await settle(page, 400);
const failed = await page.evaluate(() => ({
	said: document.querySelector(".usage-modal .usage-stale")?.textContent,
	/* The stale figures stay: they were true a minute ago, which is more use than an empty
	   panel — and silence would read as a refresh button that does nothing. */
	percent: document.querySelector(".usage-modal .big")?.textContent,
}));
say("a failed read is said out loud", /would not answer/.test(failed.said ?? ""), JSON.stringify(failed.said));
say("…over the reading that is still true", failed.percent === "74%", JSON.stringify(failed.percent));

await page.locator('.usage-modal [aria-label="Read again"]').click();
await settle(page, 300);
say("the refresh button asks again", (await sent()).filter((message) => message.type === "agent.report").length === 2);

// --- a runtime with no plan ---------------------------------------------------------

await feed({
	type: "agent.report",
	id: "A",
	report: { ...REPORT, kind: "pi", subscription: null, account: null, limits: null, behaviors: null, session: { ...REPORT.session, models: [], durationMs: null, apiDurationMs: null, linesAdded: null, linesRemoved: null } },
});
await settle(page, 400);
const pi = await page.evaluate(() => ({
	limits: document.querySelector('.usage-modal [data-group="limits"] .usage-empty')?.textContent,
	facts: [...document.querySelectorAll(".usage-modal .usage-facts dt")].map((node) => node.textContent),
	tables: document.querySelectorAll(".usage-modal .usage-table").length,
	scan: document.querySelectorAll('.usage-modal [data-group="behaviors"]').length,
}));
/*
 * Null means "this runtime does not count it", which is not zero — and `Elapsed 0s` would
 * be a fact nobody measured. So pi shows five facts where Claude shows eight, and no table
 * at all rather than one row labelled with whatever model it happens to be on now.
 */
say("a runtime with no plan says so in words, not in empty meters", /no plan windows/.test(pi.limits ?? ""), JSON.stringify(pi.limits));
say("…and figures it does not count are absent rather than zero", pi.facts.length === 5 && !pi.facts.includes("Elapsed"), JSON.stringify(pi.facts));
say("…with no per-model table, because it keeps only a total", pi.tables === 0, String(pi.tables));
say("…and no scan section, because it collects none", pi.scan === 0, String(pi.scan));

// --- it belongs to one agent --------------------------------------------------------

/*
 * Every figure in here is one agent's. A panel that survived a switch would be showing the
 * last agent's plan under this one's name, which is worse than no panel — so it closes.
 */
await feed({ type: "agents", defaultKind: "pi", focused: "B", chats: [chat("A", "Ada", "claude"), chat("B", "Bo", "pi")] });
await settle(page, 500);
say("switching agents closes it rather than relabelling it", (await page.evaluate(() => document.querySelectorAll(".usage-modal").length)) === 0);

// --- /cost, which nobody typed into a browser ---------------------------------------

/*
 * The agent's side of the same panel. `/cost` is typed in the composer and answered by the
 * server, so the reading arrives with `show` on it and the panel has to appear — a reading
 * pushed at a browser with nothing open would be a round trip nobody sees.
 */
await feed({ type: "agent.report", id: "B", report: { ...REPORT, kind: "pi", limits: null, behaviors: null }, show: true });
await settle(page, 500);
say("/cost opens the panel on its own", (await page.evaluate(() => document.querySelectorAll(".usage-modal").length)) === 1);

await page.keyboard.press("Escape");
await settle(page, 300);
say("escape closes it", (await page.evaluate(() => document.querySelectorAll(".usage-modal").length)) === 0);

// --- what a real server does with the request ----------------------------------------

/*
 * Everything above drove the browser with synthetic frames. This one goes through the
 * server: a report for an agent that does not exist must come back as an error, because the
 * panel's refresh button has to be able to say something went wrong.
 */
const answer = await page.evaluate(
	() =>
		new Promise((resolve) => {
			const socket = window.__ws;
			const onMessage = (event) => {
				const message = JSON.parse(event.data);
				if (message.type !== "agent.report") return;
				socket.removeEventListener("message", onMessage);
				resolve(message);
			};
			socket.addEventListener("message", onMessage);
			socket.send(JSON.stringify({ type: "agent.report", id: "no-such-agent" }));
			setTimeout(() => resolve({ type: "timeout" }), 4000);
		}),
);
say("the server answers a report it cannot make with an error", answer.type === "agent.report" && Boolean(answer.error), JSON.stringify(answer));

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
