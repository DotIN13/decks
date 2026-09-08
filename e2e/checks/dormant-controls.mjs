/**
 * The three controls a chat nobody has prompted can still show.
 *
 * Every restart leaves a deck full of *restored* chats: readable rows with no runtime
 * behind them, started by the first thing said to them. Which subscription each spends,
 * what model it will use and what it has cost were all fed by messages only a running
 * backend emits — so on those rows the model chip was a disabled stub, the Subscription
 * section had no row marked, and the context ring was not drawn at all. Three controls that
 * describe a conversation, blank until you had already sent a turn to whatever the runtime
 * happened to default to.
 *
 * A restored chat cannot be made over the socket — `agent.create` starts what it creates —
 * so this seeds a data directory the way a restart would leave one and sends `deck.open`,
 * which is the one path that re-reads the records (`App.openDeck` → `Registry.restore`).
 * The deck is put back at the end, because every later check runs against it.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deckState, open, preflight, say, settle, socket } from "../harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/*
 * The fixture check, before a single byte is written — and this one earns it twice over.
 *
 * `harness.mjs` defaults to the ports a *live* Decks uses, so a check run by hand rather
 * than by `e2e/run.mjs` talks to whatever is on 4329. This check writes an account list into
 * the install directory and then repoints the server's deck, so run against a live install
 * it would overwrite somebody's real subscriptions. Measured the hard way: it did.
 */
await preflight();
const original = dirname((await deckState()).path);
const accountsDir = join(original, "claude-accounts");

/*
 * A whole data directory, built the way `e2e/run.mjs` builds the fixture — the boards are a
 * copy of `example/`, the vendored lib is put where the boards expect it, and anything a
 * previous run left in `.decks` is removed before this writes its own.
 */
const data = mkdtempSync(join(tmpdir(), "decks-e2e-dormant-"));
cpSync(join(root, "example"), data, { recursive: true });
cpSync(join(root, "runtime", "lib"), join(data, "decks", "lib"), { recursive: true });
rmSync(join(data, "decks", ".decks"), { recursive: true, force: true });
rmSync(join(data, "claude-accounts"), { recursive: true, force: true });

/** Two accounts beside the CLI's own, so there is a choice to draw. */
const ids = ["cccc3333-0000-4000-8000-000000000003", "dddd4444-0000-4000-8000-000000000004"];
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

/*
 * One chat, as a restart would have left it: a Claude conversation on the second
 * subscription, on a named model, with a reading of what it had cost. No `resumeRef`, so
 * starting it opens a fresh session rather than trying to resume one that never existed.
 */
const AGENT = "eeee5555-0000-4000-8000-000000000005";
const records = join(data, "decks", ".decks", "agents");
mkdirSync(join(records, AGENT), { recursive: true });
writeFileSync(
	join(records, AGENT, "meta.json"),
	JSON.stringify({
		id: AGENT,
		kind: "claude",
		name: "Kestrel",
		color: "#3b5cf6",
		context: [],
		inPlay: [],
		createdAt: 1_700_000_000_000,
		lastAt: 1_700_000_100_000,
		model: { provider: "claude", model: "claude-haiku-4-5", thinking: "low" },
		usage: { contextTokens: 42_000, contextWindow: 200_000, cost: 0.42 },
		account: ids[1],
	}),
);
writeFileSync(join(records, AGENT, "chat.json"), JSON.stringify([{ kind: "user", id: `${AGENT}:u1`, text: "where were we", at: 1_700_000_100_000 }]));
/*
 * And what the runtime last offered, which is the file this feature adds: the list is a
 * property of the runtime rather than of any one conversation, so it is remembered per kind
 * and read back before a session exists to ask.
 */
writeFileSync(
	join(records, "models.json"),
	JSON.stringify({
		claude: [
			{ provider: "claude", model: "claude-haiku-4-5", label: "Haiku 4.5", reasoning: false },
			{ provider: "claude", model: "claude-opus-5", label: "Opus 5", reasoning: true },
		],
	}),
);

const { browser, page, errors } = await open({ width: 1500, height: 950 });
try {
	// Sniff the frames, because "is this chat still dormant" is a fact the server states and
	// the chrome only hints at.
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

	// Swap the deck under the running server, then reload: the greeting is where a restored
	// chat says everything it knows about itself.
	const link = await socket();
	link.send({ type: "deck.open", path: data });
	await new Promise((done) => setTimeout(done, 2500));
	link.close();
	await page.reload({ waitUntil: "load" });
	await settle(page, 2500);

	const frame = (type) =>
		page.evaluate((wanted) => {
			const hit = [...window.__frames].reverse().find((text) => text.includes(`"type":"${wanted}"`));
			return hit ? JSON.parse(hit) : null;
		}, type);

	const restored = (await frame("agents"))?.chats?.find((chat) => chat.name === "Kestrel");
	say("the seeded conversation is back", Boolean(restored), JSON.stringify(restored && { name: restored.name, kind: restored.kind, dormant: restored.dormant }));
	say("…and dormant: readable, with nothing running", restored?.dormant === true, JSON.stringify(restored?.dormant));

	const link2 = await socket();
	link2.send({ type: "agent.focus", id: AGENT });
	link2.close();
	await settle(page, 1500);

	// --- the model, from the record; the list, from the runtime's memory --------------
	const chip = await page.evaluate(() => {
		const button = [...document.querySelectorAll("button")].find((el) => el.querySelector("svg.lucide-sparkles"));
		return button ? { label: button.innerText.trim(), disabled: button.disabled } : null;
	});
	say("the model chip names the model the conversation was left on", /Haiku 4\.5/.test(chip?.label ?? ""), JSON.stringify(chip));
	/*
	 * And it can be opened. `disabled={props.models.length === 0}` is the line that made this
	 * a stub: the list came from `backend.models()`, which costs a session, so the control for
	 * choosing a model could not be used until you had sent a turn to the model you did not
	 * choose.
	 */
	say("…and the picker can be opened before anything has started", chip?.disabled === false, JSON.stringify(chip));

	// --- the context reading, from the record ---------------------------------------
	const dial = await page.evaluate(() => document.querySelector(".dial")?.textContent?.trim() ?? null);
	// 42,000 of 200,000.
	say("the context ring is drawn from the reading the conversation left", dial === "21%", JSON.stringify(dial));

	// --- the subscription, without having opened Settings ----------------------------
	/*
	 * The list used to arrive only when the Settings modal asked for it, so a browser that
	 * had not opened Settings had a model picker with no Subscription section at all — the
	 * control for switching account was invisible until you visited an unrelated panel. It is
	 * in the greeting now, like the deck itself.
	 */
	const published = await frame("claude.accounts");
	say("the account list arrives in the greeting, unasked", (published?.accounts?.length ?? 0) === 3, JSON.stringify(published?.accounts?.map((a) => a.email)));

	await page.evaluate(() => {
		const button = [...document.querySelectorAll("button")].find((el) => el.querySelector("svg.lucide-sparkles"));
		button?.click();
	});
	await settle(page, 800);
	const picker = await page.evaluate(() => {
		const pop = document.querySelector(".popover");
		if (!pop) return null;
		return {
			heading: [...pop.querySelectorAll(".meta")].some((el) => el.textContent === "Subscription"),
			accounts: [...pop.querySelectorAll("[data-row]")]
				.map((row) => ({ text: row.innerText.trim(), current: row.dataset.current === "true" }))
				.filter((row) => row.text.includes("@example.com")),
			models: [...pop.querySelectorAll("[data-row]")].map((row) => row.innerText.trim()).filter((text) => /Haiku|Opus/.test(text)),
			spent: pop.innerText.includes("spent"),
		};
	});
	say("the picker offers the models the runtime last had", picker?.models?.length === 2, JSON.stringify(picker?.models));
	say("…and a Subscription section, with no Settings visit in between", picker?.heading === true, JSON.stringify(picker?.accounts));
	say(
		"…marking the subscription this conversation spends",
		picker?.accounts?.filter((row) => row.current).length === 1 && picker?.accounts?.find((row) => row.current)?.text.includes("two@example.com"),
		JSON.stringify(picker?.accounts),
	);
	// Nothing is remembered as spent any more, so no row can be labelled it.
	say("…and no row is marked spent", picker?.spent === false);

	// --- changing one starts the runtime --------------------------------------------
	/*
	 * Which is the other half of "persisted": a choice that only sat in a file would be a
	 * control that appeared to do something. Pressing a model records it, starts the runtime
	 * *on* it, and the row stops being dormant — whether or not the runtime then gets as far
	 * as answering, which in a fixture with a fabricated token it will not.
	 */
	await page.evaluate(() => {
		const row = [...document.querySelectorAll(".popover [data-row]")].find((el) => el.innerText.includes("Opus 5"));
		row?.click();
	});
	await settle(page, 3000);
	/*
	 * Two frames, in this order, and both matter.
	 *
	 * The choice is recorded and broadcast *before* anything starts — that is what makes the
	 * press mean something on a chat with no runtime. Then the runtime opens on it and says
	 * what it actually landed on, which here is its own default: the models this fixture
	 * remembered are invented, and a real Claude CLI offers its own list. A runtime correcting
	 * the row is the behaviour wanted; a runtime being asked for a model nobody chose is not.
	 */
	const models = await page.evaluate(() =>
		window.__frames.filter((text) => text.includes('"type":"agent.model"')).map((text) => JSON.parse(text).model?.model ?? null),
	);
	say("choosing a model on a dormant chat records it", models.includes("claude-opus-5"), JSON.stringify(models));
	say("…and the runtime's own answer replaces it once there is one", models.at(-1) !== "claude-opus-5", JSON.stringify(models.at(-1)));
	const woken = (await frame("agents"))?.chats?.find((chat) => chat.id === AGENT);
	say("…and it is no longer dormant, so the choice is in force rather than only written down", woken?.dormant !== true, JSON.stringify({ dormant: woken?.dormant }));

	say("no console errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
	/*
	 * The deck goes back before anything else runs. Every later check reads `/api/deck` and
	 * writes to the boards it finds there, and leaving the server pointed at a directory this
	 * check is about to delete would fail the rest of the suite for a reason nowhere near it.
	 */
	const back = await socket();
	back.send({ type: "deck.open", path: original });
	await new Promise((done) => setTimeout(done, 2500));
	back.close();
	rmSync(data, { recursive: true, force: true });
	rmSync(accountsDir, { recursive: true, force: true });
	if (existsSync(join(original, "decks", ".decks", "agents", AGENT))) rmSync(join(original, "decks", ".decks", "agents", AGENT), { recursive: true, force: true });
	// A last look, so a failure here is reported as this check's rather than the next one's.
	const state = await deckState();
	say("the fixture deck is back", state.path.startsWith(original), state.path);
}
