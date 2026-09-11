/**
 * Reaching back through a long conversation (DESIGN §6.2).
 *
 * Two halves, and they fail in different ways, so both are here.
 *
 * The **column** renders a window from the end rather than every row it holds. Before this
 * a conversation of six hundred turns put six hundred cards in the DOM — each with its own
 * markdown, tool groups and time machine — and the browser spent a second opening it and
 * janked on every token that arrived afterwards. The window is only correct if reaching
 * back widens it *and keeps the reader's place*: a page that arrives above you and throws
 * you down the column by its own height is worse than no page at all.
 *
 * The **server** keeps what falls out of a session's window in an append log, so the far
 * end of a week-long conversation is still reachable. Before this it was discarded, and
 * "scroll back" meant "scroll back through the last five hundred rows and then stop".
 *
 * The log is written here directly, which is the only way to have a long history without
 * spending an afternoon of real turns making one — and it is the same file the server
 * writes, so what is under test is the reading of it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deckState, open, say, settle } from "../harness.mjs";

const deck = await deckState();
const agentsDir = join(deck.path, ".decks", "agents");

const { browser, page, errors } = await open({ width: 1500, height: 950 });

await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.__frames = [];
	window.__sent = [];
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
			this.addEventListener("message", (event) => window.__frames.push(String(event.data)));
			const send = this.send.bind(this);
			this.send = (data) => {
				window.__sent.push(String(data));
				return send(data);
			};
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2500);

const send = (message) => page.evaluate((text) => window.__ws.send(text), JSON.stringify(message));
/** Hand the app a frame as though the server had sent it. */
const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const frame = (type) =>
	page.evaluate((wanted) => {
		const hit = [...window.__frames].reverse().find((text) => text.includes(`"type":"${wanted}"`));
		return hit ? JSON.parse(hit) : null;
	}, type);
/** The newest frame of a type *about this agent*: a greeting carries one per chat. */
const frameFor = (type, agentId) =>
	page.evaluate(
		([wanted, id]) => {
			const hit = [...window.__frames]
				.reverse()
				.map((text) => {
					try {
						return JSON.parse(text);
					} catch {
						return null;
					}
				})
				.find((message) => message?.type === wanted && message?.agentId === id);
			return hit ?? null;
		},
		[type, agentId],
	);
const sent = (type) =>
	page.evaluate((wanted) => {
		const hit = [...window.__sent].reverse().find((text) => text.includes(`"type":"${wanted}"`));
		return hit ? JSON.parse(hit) : null;
	}, type);
const forget = () => page.evaluate(() => { window.__frames = []; window.__sent = []; });

// --- an agent, and a week of conversation behind it ----------------------------------

await send({ type: "agent.create", kind: "pi" });
await settle(page, 1500);
const chats = (await frame("agents"))?.chats ?? [];
const agentId = chats.at(-1)?.id;
say("there is an agent to give a history to", Boolean(agentId), String(agentId));

/*
 * 130 archived rows, written the way the server writes them: one row of JSON per line, in
 * the order they were said. This is `chat.log` — everything older than the window a session
 * keeps in memory.
 */
const archived = Array.from({ length: 130 }, (_, i) => ({
	kind: "user",
	id: `old-${i}`,
	text: `archived message ${i}`,
	at: 1_700_000_000_000 + i * 1000,
}));
mkdirSync(join(agentsDir, agentId), { recursive: true });
writeFileSync(join(agentsDir, agentId, "chat.log"), `${archived.map((item) => JSON.stringify(item)).join("\n")}\n`);
say("the archive is on disk where the server keeps it", existsSync(join(agentsDir, agentId, "chat.log")));

// --- the server says there is more, and hands it back a page at a time ---------------

/*
 * A reload, because a fresh page asks for the history of the chat it opens on (`chat.open`)
 * — the focused one, which is this agent now — and that answer is the one frame that has to
 * say whether there is more. It used to be part of the greeting, for every chat at once.
 */
await send({ type: "agent.focus", id: agentId });
await settle(page, 800);
await page.reload({ waitUntil: "load" });
await settle(page, 2500);
const history = await frameFor("chat.history", agentId);
/*
 * The one thing the browser cannot work out for itself: a window of sixty rows looks the
 * same whether it is the whole conversation or the end of a very long one.
 */
say("the history says there is more behind it", history?.more === true, JSON.stringify({ more: history?.more, items: history?.items?.length }));

const ask = async (before) => {
	forget();
	await send({ type: "chat.earlier", agentId, before, limit: 60 });
	await settle(page, 900);
	return frame("chat.earlier");
};

// `before` is normally a row from the live window, which the log has never seen — so an id
// it cannot find means "the end of the log" rather than an error.
const first = await ask("a-row-from-the-window");
say("a page of the archive comes back", first?.items?.length === 60, `${first?.items?.length} rows`);
say("…ending at the newest thing archived", first?.items?.at(-1)?.id === "old-129", String(first?.items?.at(-1)?.id));
say("…in reading order, oldest first", first?.items?.[0]?.id === "old-70", String(first?.items?.[0]?.id));
say("…and it echoes the cursor it was asked for", first?.before === "a-row-from-the-window", String(first?.before));
say("…and says there is still more", first?.more === true, String(first?.more));

const second = await ask("old-70");
say("the page before that one is the sixty before it", second?.items?.[0]?.id === "old-10" && second?.items?.length === 60, `${second?.items?.length} from ${second?.items?.[0]?.id}`);

const third = await ask("old-10");
say("the last page is short and says so", third?.items?.length === 10 && third?.more === false, `${third?.items?.length} rows, more=${third?.more}`);
say("…and it is the beginning of the conversation", third?.items?.[0]?.id === "old-0", String(third?.items?.[0]?.id));

const beyond = await ask("old-0");
say("asking past the beginning is empty rather than an error", beyond?.items?.length === 0 && beyond?.more === false, JSON.stringify({ items: beyond?.items?.length, more: beyond?.more }));

// --- the column renders a window, not the whole conversation -------------------------

/*
 * 90 rows handed to the browser directly. A real conversation of this length would be an
 * afternoon of turns; what is under test is the column, and the column cannot tell where
 * its rows came from.
 */
const held = Array.from({ length: 90 }, (_, i) => ({
	kind: "user",
	id: `held-${i}`,
	text: `held message ${i}`,
	at: 1_700_100_000_000 + i * 1000,
}));
await feed({ type: "chat.history", agentId, items: held, more: true });
await settle(page, 400);
await page.evaluate(() => {
	const button = [...document.querySelectorAll(".pill button")].find((candidate) => /conversation/i.test(candidate.getAttribute("aria-label") ?? ""));
	button?.click();
});
await settle(page, 900);

const column = () =>
	page.evaluate(() => {
		const roll = document.querySelector(".stream-roll");
		return {
			// `[data-card]` is on every kind of turn — yours, the agent's, a notice — which
			// is what makes it the right thing to count. `.stream-card` is only some of them.
			cards: roll?.querySelectorAll("[data-card]").length ?? -1,
			earlier: roll?.querySelector(".stream-earlier")?.textContent?.trim() ?? null,
			scrollTop: Math.round(roll?.scrollTop ?? -1),
			height: Math.round(roll?.scrollHeight ?? -1),
		};
	});

const opened = await column();
say("a long conversation renders a window of it", opened.cards === 60, `${opened.cards} cards for 90 rows`);
say("…and says how much is above it", opened.earlier === "30 earlier messages", String(opened.earlier));

// --- widening it keeps the reader's place --------------------------------------------

/*
 * The assertion the whole mechanism is for. The column grows *upwards*, so a page that
 * arrives without the correction pushes whatever you were reading down the screen by its
 * own height — which on a page of sixty cards is several screens.
 */
// A row that is inside the window both before and after it widens, so it is the same
// element being measured and not a fresh one that happens to sit where the old one did.
const marker = '.stream-roll [data-item="held-70"]';
const before = await page.locator(marker).boundingBox();
await page.locator(".stream-earlier").click();
await settle(page, 700);
const after = await page.locator(marker).boundingBox();
const widened = await column();
say("the rest of what is held comes in", widened.cards === 90, `${widened.cards} cards`);
say("…and what the reader was looking at has not moved", Math.abs((after?.y ?? 0) - (before?.y ?? 0)) < 3, `${Math.round(before?.y ?? 0)} -> ${Math.round(after?.y ?? 0)}`);
// Nothing left hidden in the browser, but the server still has the week before it.
say("…and the way back now offers what only the server has", widened.earlier === "Earlier messages", String(widened.earlier));

// --- and scrolling to the top asks the server for the rest ---------------------------

forget();
await page.evaluate(() => {
	const roll = document.querySelector(".stream-roll");
	if (roll) roll.scrollTop = 0;
});
await settle(page, 1500);
const asked = await sent("chat.earlier");
say("reaching the top asks the server for a page", asked?.type === "chat.earlier", JSON.stringify(asked));
say("…from the oldest row it holds", asked?.before === "held-0", String(asked?.before));

await settle(page, 1200);
const paged = await column();
/*
 * The page is real: the server read it out of the log written at the top of this file. 90
 * held plus a page of 60 from the archive, and the window grew by the page rather than
 * hiding it again.
 */
say("the archive arrives in the column", paged.cards === 150, `${paged.cards} cards`);
say(
	"…and the oldest card in it is one of the archived rows",
	await page.evaluate(() => document.querySelector(".stream-roll [data-card]")?.textContent?.includes("archived message") ?? false),
	await page.evaluate(() => document.querySelector(".stream-roll [data-card]")?.textContent?.trim().slice(0, 40) ?? ""),
);

// --- and saying something from the foot throws the extra away ------------------------

/*
 * Otherwise a conversation left open all day is a DOM that only ever grows: every page
 * anybody scrolled back to is still rendered, above a reader who has long since returned
 * to the end.
 *
 * Sending is the signal rather than merely arriving at the foot, and that is deliberate: a
 * reader at the foot who presses "earlier messages" is asking for exactly the thing a
 * reset would take away again. Fed as a message of the reader's own, which is what the
 * column watches for.
 */
await page.evaluate(() => {
	const roll = document.querySelector(".stream-roll");
	if (roll) roll.scrollTop = roll.scrollHeight;
});
await settle(page, 700);
await feed({ type: "chat.item", agentId, item: { kind: "user", id: "held-new", text: "and one more thing", at: Date.now() } });
await settle(page, 900);
const back = await column();
say("saying something from the foot makes it a window again", back.cards === 60, `${back.cards} cards`);
say("…with everything above it still reachable", back.earlier !== null, String(back.earlier));

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
