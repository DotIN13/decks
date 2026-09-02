/**
 * The agent list is the only place an agent's state is shown, so this is what says it (§7).
 *
 * There used to be two other surfaces: a peek above the input bar, and pills in the corner
 * the panel comes out of. Both are gone, which puts the whole weight on a row — its last
 * line, the word it uses while working, the ring on its face, and the dot for a
 * conversation you are not looking at. Every one of those has a way of quietly not working,
 * and each of them used to be covered by the surface that replaced it.
 *
 * Needs a model: what is being checked is a row *changing* as a turn runs, which no fixture
 * can stage.
 */
import { ask, newAgent, open, openPanel, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

/**
 * One row, as the list draws it.
 *
 * By index, or `undefined` for whichever row is the focused one — a new agent is *appended*
 * and takes the focus, so "the row that is about to do the work" is not row zero. Getting
 * that wrong is a check that watches a different agent sit still.
 */
const row = (index) =>
	page.evaluate((n) => {
		const element = n === null ? document.querySelector('.chat-row[data-current="true"]') : document.querySelectorAll(".chat-row")[n];
		if (!element) return null;
		const face = element.querySelector(".avatar");
		return {
			name: element.querySelector(".name")?.textContent ?? "",
			last: element.querySelector(".last")?.textContent?.trim() ?? "",
			state: face?.dataset.state ?? "",
			current: element.dataset.current === "true",
			/* The ring is a `::after` on the face, so it is asked for by state rather than found. */
			ringed: face ? getComputedStyle(face, "::after").content !== "none" : false,
			unread: Boolean(element.closest(".chat-row-wrap")?.querySelector(".unread")),
		};
	}, index ?? null);

await openPanel(page, "agents");
await newAgent(page);
await settle(page, 600);

// --- a fresh row says it has nothing rather than nothing at all -------------------
const fresh = await row();
say("a fresh agent's row says so in words", fresh.last === "no messages yet", JSON.stringify(fresh));
say("…and its face carries no ring", fresh.ringed === false && fresh.state === "idle", JSON.stringify(fresh));

// --- while it works, the row says which kind of working it is --------------------
/*
 * Sampled while the turn runs, which is the only time it exists. `ask` waits for the turn to
 * finish, so this watches the row with a `MutationObserver` instead of polling: "thinking…"
 * can be true for a few hundred milliseconds and a poll every 100ms saw it about half the
 * time.
 */
await page.evaluate(() => {
	const seen = { words: new Set(), ringed: false };
	window.__rowWatch = seen;
	const look = () => {
		const element = document.querySelector('.chat-row[data-current="true"]');
		const last = element?.querySelector(".last")?.textContent?.trim();
		if (last) seen.words.add(last);
		const face = element?.querySelector(".avatar");
		if (face && face.dataset.state !== "idle") seen.ringed = true;
	};
	new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
	look();
});

await page.locator(".composer textarea").fill("Read boards/plan.html and give me its title, briefly.");
await page.locator(".composer textarea").press("Enter");
await page.waitForFunction(() => document.querySelector(".composer .send")?.dataset.busy === "true", null, { timeout: 20000 });
await settle(page, 400);
const during = await row();
say("the row says it is working while it works", /thinking|working|waiting/.test(during.last), JSON.stringify(during.last));
say("…and its face wears the state as a ring", during.ringed && during.state !== "idle", JSON.stringify(during));

await page.waitForFunction(() => document.querySelector(".composer .send")?.dataset.busy !== "true", null, { timeout: 300000 });
await settle(page, 1500);

const watched = await page.evaluate(() => ({ words: [...window.__rowWatch.words], ringed: window.__rowWatch.ringed }));
say("the row passed through a working state, not straight from empty to answered", watched.ringed, JSON.stringify(watched.words.slice(0, 6)));

// --- and afterwards it carries what was actually said ---------------------------
const after = await row();
say("the row shows the newest line once the turn is done", after.last.length > 0 && !/thinking|working|no messages/.test(after.last), JSON.stringify(after.last));
say("…and the ring is gone with the work", after.ringed === false && after.state === "idle", JSON.stringify(after));

// --- a conversation you are not looking at says it has something ----------------
/*
 * The unread dot is the last thing the pills used to do that nothing else did: an agent that
 * answered while you were reading another one. Two agents, focus the second, prompt the
 * first through the list, and the first's row must mark itself.
 */
await newAgent(page);
await settle(page, 800);
const rows = await page.evaluate(() => document.querySelectorAll(".chat-row").length);
say("there are two agents to tell apart", rows >= 2, `${rows} rows`);

const focused = await page.evaluate(() => [...document.querySelectorAll(".chat-row")].findIndex((element) => element.dataset.current === "true"));
say("one of them is the focused one", focused >= 0, `row ${focused}`);
const other = focused === 0 ? 1 : 0;
await page.locator(".chat-row").nth(other).click();
await settle(page, 600);
await ask(page, "Say exactly: uniform victor. Nothing else, and use no tools.");
await settle(page, 1200);
await page.locator(".chat-row").nth(focused).click();
await settle(page, 800);
const answered = await row(other);
say("the agent that answered carries its line", /uniform victor/i.test(answered.last), JSON.stringify(answered.last));
say("…and is no longer the focused row", answered.current === false, JSON.stringify(answered));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
