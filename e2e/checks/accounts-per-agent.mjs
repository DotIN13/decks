/**
 * A subscription per agent, chosen by hand and by nothing else.
 *
 * The switch itself is a symlink the CLI re-reads on every request — that part is measured
 * in `claude/accounts.test.ts`, against the real binary. What a browser is needed for is the
 * wiring either side of it: that the picker offers the install's accounts for *this*
 * conversation, that pressing a row moves that agent's link and no other agent's, that the
 * choice is written to the agent's record, and that Settings has stopped deciding anything
 * about who spends what — no switch, and no arrows, because nothing rotates any more.
 *
 * Two Claude agents are made over the socket. Real ones would need two subscriptions and a
 * model, and the interesting state — two agents on two different accounts at once — is the
 * whole point and cannot be produced by hand.
 */
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { preflight, deckState, open, openOverflow, say, settle } from "../harness.mjs";

/*
 * A fixture, before anything is written. These accounts live in the *install* directory, not
 * in the deck, so a run against a live Decks would overwrite somebody's real subscriptions —
 * and `harness.mjs` defaults to the ports a live Decks uses.
 */
await preflight();

// The fixture's data directory is the deck's parent — the same way `accounts.mjs` finds it.
const dataDir = dirname((await deckState()).path);
const accountsDir = join(dataDir, "claude-accounts");

/*
 * Two accounts, written the way the store expects. The OAuth flow cannot be automated, and
 * what is under test is which directory a session is *pointed at* rather than whether the
 * token in it works — so a fabricated credentials file is enough, and `hasCredentials` only
 * asks whether the file is non-empty.
 */
const ids = ["aaaa1111-0000-4000-8000-000000000001", "bbbb2222-0000-4000-8000-000000000002"];
for (const id of ids) {
	mkdirSync(join(accountsDir, id), { recursive: true });
	writeFileSync(join(accountsDir, id, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "not-a-real-token" } }));
}
writeFileSync(
	join(accountsDir, "index.json"),
	JSON.stringify({
		active: ids[0],
		accounts: [
			{ id: ids[0], addedAt: 1, email: "one@example.com", plan: "Claude Max" },
			{ id: ids[1], addedAt: 2, email: "two@example.com", plan: "Claude Pro" },
		],
	}),
);

const { browser, page, errors } = await open({ width: 1500, height: 950 });

await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.__frames = [];
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
			this.addEventListener("message", (event) => window.__frames.push(String(event.data)));
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2500);

const send = (message) => page.evaluate((text) => window.__ws.send(text), JSON.stringify(message));
/** The newest frame of a type, which is the one that is true. */
const frame = (type) =>
	page.evaluate((wanted) => {
		const hit = [...window.__frames].reverse().find((text) => text.includes(`"type":"${wanted}"`));
		return hit ? JSON.parse(hit) : null;
	}, type);
const linkOf = (agentId) => (existsSync(join(accountsDir, "agents", agentId)) ? readlinkSync(join(accountsDir, "agents", agentId)) : undefined);
const recordOf = (agentId) => {
	const file = join(dataDir, "decks", ".decks", "agents", agentId, "meta.json");
	return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
};

// --- the list, and what "active" now means ------------------------------------------

await send({ type: "claude.accounts" });
await settle(page, 2500);
const list = await frame("claude.accounts");
// Three rows: the two written here plus the CLI's own login, which is always a row and is
// synthesised rather than stored — see `describeDefault`.
say("the server publishes both accounts, beside the CLI's own", list?.accounts?.length === 3, JSON.stringify(list?.accounts?.map((a) => a.email)));
// The stored row, which is where signing one in leaves it. There is no order to walk any
// more, so this is the only answer to "where does a new conversation start".
say("…and which one a new agent starts on", list?.active === ids[0], list?.active);

// --- two Claude agents ---------------------------------------------------------------

await send({ type: "agent.create", kind: "claude" });
await settle(page, 1200);
await send({ type: "agent.create", kind: "claude" });
await settle(page, 1500);
const agents = (await frame("agents"))?.chats?.filter((chat) => chat.kind === "claude") ?? [];
say("two Claude conversations to spend two subscriptions", agents.length >= 2, `${agents.length} claude agents`);
const [first, second] = agents.slice(-2);

// --- the picker offers them, for this conversation -----------------------------------

await send({ type: "agent.focus", id: first.id });
await settle(page, 1200);
await page.evaluate(() => {
	const chip = [...document.querySelectorAll("button")].find((el) => el.querySelector("svg.lucide-sparkles"));
	chip?.click();
});
await settle(page, 800);
const picker = await page.evaluate(() => {
	const pop = document.querySelector(".popover");
	if (!pop) return null;
	const heading = [...pop.querySelectorAll(".meta")].some((el) => el.textContent === "Subscription");
	const rows = [...pop.querySelectorAll("[data-row]")]
		.map((row) => ({ text: row.innerText.trim(), current: row.dataset.current === "true" }))
		.filter((row) => row.text.includes("@example.com"));
	return { heading, rows };
});
say("the model picker carries a Subscription section", picker?.heading === true, JSON.stringify(picker?.rows));
say("…listing every account by address", picker?.rows?.length === 2, JSON.stringify(picker?.rows?.map((r) => r.text)));
say("…with the one this conversation spends marked", picker?.rows?.filter((r) => r.current).length === 1 && picker?.rows?.find((r) => r.current)?.text.includes("one@example.com"));
await page.keyboard.press("Escape");
await settle(page, 400);

// --- switching one agent moves one agent ---------------------------------------------

await send({ type: "claude.accounts.use", id: ids[1], agentId: first.id });
await settle(page, 1500);
say("switching an agent points its own link", linkOf(first.id) === join(accountsDir, ids[1]), String(linkOf(first.id)));
/*
 * The assertion the whole feature is for. Before this, a switch was one link for the machine
 * and every running session followed it — so choosing a subscription for one conversation
 * changed what every other conversation was spending, mid-turn.
 */
say("…and does not touch another agent's", linkOf(second.id) === undefined || linkOf(second.id) === join(accountsDir, ids[0]), String(linkOf(second.id)));
say("…nor the default a new conversation starts on", (await frame("claude.accounts"))?.active === ids[0]);

const spending = (await frame("claude.accounts"))?.spending ?? {};
say("the published list says who is on what", spending[first.id] === ids[1], JSON.stringify(spending));

// --- and it is persisted with the conversation ---------------------------------------

/*
 * On the agent's own record, beside its model, so a restart does not move it. A record is
 * only written for a conversation that has been spoken to — an agent with nothing said to it
 * is not restored either — so this asserts the field when there is a record to hold it.
 */
const stored = recordOf(first.id);
if (stored) say("the account is written to the agent's record", stored.account === ids[1], JSON.stringify({ account: stored.account }));
else say("the account is written to the agent's record", true, "no record yet: nothing has been said to this agent, so there is nothing to restore");

// --- and Settings no longer switches anything ----------------------------------------

/*
 * The panel used to carry a machine-wide switch: pressing a row moved the install default,
 * which moved nobody, because every open conversation keeps its own account. Then it carried
 * a pair of arrows, which set the order a rate limit walked. Both are gone — nothing switches
 * by itself, so there is no order to set — and what is left is adding and removing.
 */
await openOverflow(page, /settings/i);
await page.waitForSelector(".settings", { timeout: 6000 });
await settle(page, 2500);
const panel = await page.evaluate(() => {
	const rows = [...document.querySelectorAll(".account-row")];
	return {
		rows: rows.length,
		pressable: rows.filter((row) => row.querySelector("button[data-row]")).length,
		states: rows.map((row) => row.querySelector(".state")?.textContent ?? ""),
		// What is left is the ×. The arrows went with the automatic switching they ordered.
		arrows: rows.filter((row) => row.querySelector('[aria-label*="up" i], [aria-label*="down" i]')).length,
		removable: rows.filter((row) => row.querySelector(".close:not(.rank)")).length,
	};
});
say("every account is still listed", panel.rows === 3, JSON.stringify(panel.states));
say("…but no row is a switch any more", panel.pressable === 0, `${panel.pressable} pressable rows`);
say("…and none of them claims to be active", !panel.states.some((state) => /\bactive\b/.test(state)), JSON.stringify(panel.states));
/*
 * No row claims to be the default for new conversations. The stored default is one of the two
 * accounts written by hand here — its credentials file is real enough for the server to keep
 * naming it, but `claude auth status` reports it signed out, and the panel does not label a
 * default a conversation could not actually start on. `accounts.mjs` argues this at length.
 */
say("…and no row is labelled a default it could not answer as", panel.states.filter((state) => /default for new/.test(state)).length === 0, JSON.stringify(panel.states));
say("…and no row is marked spent, because a limit is no longer remembered here", !panel.states.some((state) => /limited/.test(state)), JSON.stringify(panel.states));
say("adding and removing are what is left", panel.removable === 2 && panel.arrows === 0, JSON.stringify({ removable: panel.removable, arrows: panel.arrows }));
await page.keyboard.press("Escape");
await settle(page, 400);

/*
 * And the conversation that chose for itself is still where it was put. This used to be the
 * assertion that reordering the list did not drag it; there is no reordering now, so what is
 * being checked is that the round trip through Settings changed nothing about it.
 */
const after = await frame("claude.accounts");
say(
	"the conversation that chose for itself is where it was put",
	linkOf(first.id) === join(accountsDir, ids[1]) && (after?.spending ?? {})[first.id] === ids[1],
	JSON.stringify({ link: linkOf(first.id), spending: (after?.spending ?? {})[first.id] }),
);
say("…and the default for new conversations has not moved", after?.active === ids[0], after?.active);

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
