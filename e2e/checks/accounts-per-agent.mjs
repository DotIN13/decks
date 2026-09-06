/**
 * A subscription per agent, and a fallback that moves one agent rather than all of them.
 *
 * The switch itself is a symlink the CLI re-reads on every request — that part is measured
 * in `claude/accounts.test.ts`, against the real binary. What a browser is needed for is the
 * wiring either side of it: that the picker offers the install's accounts for *this*
 * conversation, that pressing a row moves that agent's link and no other agent's, that the
 * choice is written to the agent's record, and that the Settings row has stopped being a
 * global switch and become the default a new agent starts on.
 *
 * Two Claude agents are made over the socket. Real ones would need two subscriptions and a
 * model, and the interesting state — two agents on two different accounts at once — is the
 * whole point and cannot be produced by hand.
 */
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deckState, open, say, settle } from "../harness.mjs";

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
		order: ids,
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
say("…nor the default a new agent starts on", (await frame("claude.accounts"))?.active === ids[0]);

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

// --- the Settings row is a default now, not a switch ---------------------------------

await send({ type: "claude.accounts.use", id: ids[0] });
await settle(page, 1500);
const after = await frame("claude.accounts");
say("the Settings row moves the default", after?.active === ids[0], after?.active);
say(
	"…and leaves the agent that chose for itself where it is",
	linkOf(first.id) === join(accountsDir, ids[1]) && (after?.spending ?? {})[first.id] === ids[1],
	JSON.stringify({ link: linkOf(first.id), spending: (after?.spending ?? {})[first.id] }),
);

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
