/**
 * Which runtime an agent is on, what it says it is doing, and the three places that say so.
 *
 * Three surfaces, each answering a different question: the **dropdown** is who exists and how
 * to switch, its **hover card** is the detail for one row while you point at it, and the
 * panel's **Agents tab** is the reading surface — the whole story of every agent at once.
 * What is checked here is mostly that they do not drift into saying the same thing, or into
 * disagreeing about who is most urgent.
 *
 * The socket is driven directly. Five agents across two runtimes, in five different states,
 * with tags — a state that would otherwise need five real sessions, a model, and several
 * minutes per assertion, and which cannot be produced on demand at all. The tag *rules* are
 * unit-tested in `agents/tags.ts`; what a browser is needed for is whether the rows draw
 * them, and whether the customise popup reaches the server.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 980 });

await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.__sent = [];
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
			const send = this.send.bind(this);
			this.send = (data) => {
				window.__sent.push(String(data));
				return send(data);
			};
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2000);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const chat = (id, name, kind, state, lastLine, ago, extra = {}) => ({
	id,
	name,
	kind,
	state,
	...(lastLine ? { lastLine } : {}),
	lastAt: Date.now() - ago,
	unread: 0,
	contextCount: 2,
	capabilities: { modes: [] },
	commands: [],
	...extra,
});

/*
 * Two runtimes, and every status the ring can be in: waiting, working, done-and-unread, idle,
 * and dormant. `Wren` becomes `done` further down by receiving a reply while the transcript
 * is away, which is the only way that state exists — it is derived, not sent.
 */
await feed({
	type: "agents",
	defaultKind: "pi",
	focused: "a1",
	chats: [
		chat("a1", "Ada", "claude", "tool", "Reading panel.css", 4_000),
		chat("a2", "Pi", "pi", "streaming", "Writing the report", 20_000),
		chat("a3", "Iris", "claude", "waiting", "Allow this command?", 90_000),
		chat("a4", "Wren", "pi", "idle", "Done — 12 boards measured", 900_000),
		chat("a5", "Basil", "claude", "idle", undefined, 7_200_000, { dormant: true }),
	],
});
for (const [id, name, tags, userTags] of [
	["a1", "Ada", ["panel-css", "measuring"], []],
	["a3", "Iris", ["e2e", "flaky-editing"], ["mine"]],
	["a4", "Wren", ["thumbnails"], []],
]) {
	await feed({ type: "agent.identity", id, identity: { name, color: "#3b5cf6", tags, ...(userTags.length ? { userTags } : {}) } });
}
await feed({ type: "chat.item", agentId: "a4", item: { id: "w1", kind: "assistant", text: "Done — 12 boards measured", at: Date.now() - 900_000 } });
await settle(page, 800);

// --- the dropdown: the runtime as a word, still one line ---------------------------

await page.evaluate(() => {
	const trigger = [...document.querySelectorAll(".float.pill button")].find((button) => /^Agents/.test(button.getAttribute("aria-label") ?? ""));
	trigger?.click();
});
await page.waitForSelector(".popover", { timeout: 4000 });
await settle(page, 300);

const menu = await page.evaluate(() => ({
	width: Math.round(document.querySelector(".popover").getBoundingClientRect().width),
	rows: [...document.querySelectorAll('.popover [data-agent="true"]')].map((row) => ({
		h: Math.round(row.getBoundingClientRect().height),
		kind: row.querySelector(".kind")?.textContent,
		dormant: row.querySelector(".kind")?.dataset.dormant ?? null,
		name: row.querySelector(".lb")?.textContent,
	})),
	tags: document.querySelectorAll(".popover .tag").length,
}));
say("every row names its runtime", menu.rows.every((row) => row.kind === "claude" || row.kind === "pi"), JSON.stringify(menu.rows.map((r) => `${r.name}:${r.kind}`)));
say("…as a word, not a badge on the face", menu.rows.filter((row) => row.kind === "claude").length === 3 && menu.rows.filter((row) => row.kind === "pi").length === 2, JSON.stringify(menu.rows.map((r) => r.kind)));
/*
 * A dormant agent keeps its word, drawn faint: it *has* a kind recorded, and "which of my
 * Claude sessions was the one about the panel" is asked most often about the parked ones. The
 * dimming is the thing a badge could not have done, which is a small argument for the word.
 */
say("a dormant agent keeps its runtime, dimmed", menu.rows.find((row) => row.name === "Basil")?.dormant === "true", JSON.stringify(menu.rows.at(-1)));
/*
 * The row stayed one line. The first design put tags on a second line here; with the panel
 * carrying the full story and the card a hover away, that was unnecessary — and this is the
 * assertion that stops it creeping back.
 */
say("the rows are still one line, at 264px", menu.width === 264 && menu.rows.every((row) => row.h <= 36), `${menu.width}px · ${JSON.stringify(menu.rows.map((r) => r.h))}`);
say("…and carry no tags: that is the panel's job", menu.tags === 0, `${menu.tags} tags in the menu`);

// --- the hover card, beside the row ------------------------------------------------

const row = page.locator('.popover [data-agent="true"]').filter({ hasText: "Iris" }).first();
const rowBox = await row.boundingBox();
await page.mouse.move(rowBox.x + 40, rowBox.y + rowBox.height / 2);
/*
 * 80ms, because the card is summoned at once — the same as the corner stack's, which is the
 * point of it. It waited 350ms before, on the theory that a pointer crossing five rows
 * should not flash five cards; what stops that is the grace on the way *out* (also 80ms),
 * which turns five appearances into one card moving down the list.
 */
await settle(page, 80);
say("the card is there at once, as the corner's is", (await page.evaluate(() => [...document.querySelectorAll(".agent-hover")].some((el) => el.dataset.shown === "true"))) === true);
await settle(page, 400);

/*
 * Two cards are mounted — the corner stack keeps one of its own — so the menu's is found by
 * which one is *shown*. Reading `document.querySelector(".agent-hover")` finds the stack's
 * and reports it hidden, which cost a wrong diagnosis once already.
 */
const card = await page.evaluate(() => {
	const shown = [...document.querySelectorAll(".agent-hover")].find((el) => el.dataset.shown === "true");
	if (!shown) return { shown: false, cards: document.querySelectorAll(".agent-hover").length };
	const box = shown.getBoundingClientRect();
	const menuBox = document.querySelector(".popover").getBoundingClientRect();
	return {
		shown: true,
		text: shown.innerText.replace(/\n+/g, " | "),
		kind: shown.querySelector(".kind")?.textContent,
		tags: [...shown.querySelectorAll(".tag")].map((tag) => `${tag.textContent}${tag.dataset.mine ? "*" : ""}`),
		box: { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right) },
		menu: { left: Math.round(menuBox.left), top: Math.round(menuBox.top), right: Math.round(menuBox.right) },
		beside: Math.round(box.left) >= Math.round(menuBox.right) || Math.round(box.right) <= Math.round(menuBox.left),
		clickable: getComputedStyle(shown).pointerEvents,
	};
});
say("pointing at a row opens the card", card.shown === true, JSON.stringify(card));
say("…the same card the corner faces use", card.text?.includes("Click to switch to Iris"), card.text);
say("…placed beside the menu, not over the rows being compared", card.beside === true, `card ${JSON.stringify(card.box)} vs menu ${JSON.stringify(card.menu)}`);
say("…carrying the runtime word", card.kind === "claude", card.kind);
/* Both kinds of tag, told apart: the agent's are filled, yours are outlined. */
say("…and both kinds of tag, kept apart", JSON.stringify(card.tags) === JSON.stringify(["e2e", "flaky-editing", "mine*"]), JSON.stringify(card.tags));
say("…and it swallows no clicks, being a description rather than a menu", card.clickable === "none", card.clickable);

await page.keyboard.press("Escape");
await settle(page, 300);

// --- the panel's Agents tab --------------------------------------------------------

const shown = await page.evaluate(() => Boolean(document.querySelector(".panel-shell")));
if (!shown) await page.locator('[aria-label*="boards panel" i]').first().click();
await page.waitForSelector(".panel-shell", { timeout: 5000 });
await page.getByRole("tab", { name: "Agents" }).click();
await settle(page, 500);

const panel = await page.evaluate(() => ({
	sections: [...document.querySelectorAll(".panel-section")].map((section) => `${section.dataset.kind}:${section.querySelectorAll(".agent-row").length}`),
	labels: [...document.querySelectorAll(".panel-meta")].map((meta) => meta.textContent?.replace(/\s+/g, " ").trim()),
	rows: [...document.querySelectorAll(".agent-row")].map((agent) => ({
		name: agent.querySelector(".lb")?.textContent,
		h: Math.round(agent.getBoundingClientRect().height),
		kind: agent.querySelector(".kind")?.textContent,
		avatar: Math.round(agent.querySelector(".ic")?.getBoundingClientRect().width ?? 0),
		state: agent.querySelector(".agent-state")?.textContent?.trim(),
		dormant: agent.dataset.dormant ?? null,
		/*
		 * The row is `AgentHoverCard` laid flat, with one deliberate difference: the runtime
		 * rides with the name — `Rune claude` is one thing being identified — and the right
		 * end of the name line is the time, which is the column the two buttons take over.
		 */
		shape: [...agent.querySelectorAll(".agent-body > *")].map((line) => line.className.split(" ")[0]),
		metaColumn: [agent.querySelector(".agent-line > .ago") !== null, agent.querySelector(".agent-line > .kind") !== null],
		tags: [...agent.querySelectorAll(".tag")].map((tag) => `${tag.textContent}${tag.dataset.mine ? "*" : ""}`),
		said: agent.querySelector(".agent-said")?.textContent?.trim(),
		/* Side by side, not stacked: the row vocabulary collapses to one column unless the
		   avatar is in an `.ic` slot, and that mistake put the name under the face. */
		sideBySide: (() => {
			const ic = agent.querySelector(".ic")?.getBoundingClientRect();
			const body = agent.querySelector(".agent-body")?.getBoundingClientRect();
			return Boolean(ic && body && body.left >= ic.right);
		})(),
	})),
	foot: document.querySelector(".panel-foot")?.innerText.replace(/\s+/g, " ").trim(),
	density: document.querySelector(".panel-foot .seg") ? getComputedStyle(document.querySelector(".panel-foot .seg")).display : "gone",
	placeholder: document.querySelector(".panel-shell .field input")?.placeholder,
}));

/*
 * The sections are `agent-order.ts`'s own ranking with headings on it, so the panel and the
 * corner stack cannot disagree about who is most urgent — which they would within a week if
 * each sorted for itself.
 */
say("three sections, most urgent first", JSON.stringify(panel.sections) === JSON.stringify(["wants:1", "working:2", "quiet:2"]), JSON.stringify(panel.sections));
say("…named in sentence case", JSON.stringify(panel.labels) === JSON.stringify(["Wants you1", "Working2", "Quiet2"]), JSON.stringify(panel.labels));
/*
 * A finished turn stays in Quiet with the green ring rather than being promoted: "come and
 * read this" is not the same demand as "answer this now".
 */
say("a finished turn does not jump the queue", panel.rows[3]?.name === "Wren" && /not read yet/.test(panel.rows[3]?.state ?? ""), panel.rows[3]?.state);
say("the avatar is beside the name, not above it", panel.rows.every((agent) => agent.sideBySide), JSON.stringify(panel.rows.map((r) => r.sideBySide)));
say("…at 28px, where the dropdown's is 20", panel.rows.every((agent) => agent.avatar === 28), JSON.stringify(panel.rows.map((r) => r.avatar)));
say("a row carries the runtime, the state, the tags and the last line", panel.rows[0]?.kind === "claude" && Boolean(panel.rows[0]?.state) && panel.rows[0]?.tags.length === 3 && Boolean(panel.rows[0]?.said), JSON.stringify(panel.rows[0]));
/*
 * And in the hover card's order, because the row *is* the card laid flat: name, state, tags,
 * what it said. The card is the surface nobody has ever complained about, so the panel takes
 * its shape rather than inventing a fourth one.
 */
say("…in the hover card's four lines", JSON.stringify(panel.rows[0]?.shape) === JSON.stringify(["agent-line", "agent-state", "tags", "agent-said"]), JSON.stringify(panel.rows[0]?.shape));
/* Two columns, and the right one is meta: how long ago, then what runtime. */
say("…the runtime beside the name, the time at the line's end", JSON.stringify(panel.rows[0]?.metaColumn) === JSON.stringify([true, true]), JSON.stringify(panel.rows[0]?.metaColumn));
say("…with your tags told apart from the agent's", JSON.stringify(panel.rows[0]?.tags) === JSON.stringify(["e2e", "flaky-editing", "mine*"]), JSON.stringify(panel.rows[0]?.tags));
/*
 * The row shrinks rather than reserving space. Basil has no tags and nothing quoted, so it is
 * the shortest row in the list — a list of five where two are short reads better than five
 * each carrying an empty third line.
 */
const basil = panel.rows.find((agent) => agent.name === "Basil");
const ada = panel.rows.find((agent) => agent.name === "Ada");
say("an agent with nothing to say gets a shorter row", basil.h < ada.h - 20, `Basil ${basil.h} vs Ada ${ada.h}`);
/*
 * Dormant beats idle: both are true and only one of them explains why nothing is happening.
 * One word, where it used to be "Dormant — not resumed" — the row is marked and its runtime
 * word is boxed, so the sentence had two other things saying it.
 */
say("…and dormant beats idle, in one word", basil.dormant === "true" && basil.state?.includes("Dormant"), JSON.stringify([basil.dormant, basil.state]));
/* The foot counts, and stops: the three headings above it each carry their own count. */
say("the foot counts what the sections hold", panel.foot === "5 agents", panel.foot);
/* Pictures or rows is a question about thumbnails; an agent has no second rendering. */
say("the density toggle belongs to Boards", panel.density === "none", panel.density);
say("the field says it searches tags too", /agents or tags/.test(panel.placeholder ?? ""), panel.placeholder);

// --- searching by tag, and the query clearing on a switch --------------------------

await page.locator(".panel-shell .field input").fill("panel-css");
await settle(page, 400);
const found = await page.evaluate(() => ({
	rows: [...document.querySelectorAll(".agent-row .lb")].map((el) => el.textContent),
	foot: document.querySelector(".panel-foot")?.innerText.replace(/\s+/g, " ").trim(),
}));
say("searching a tag finds the agent on it", JSON.stringify(found.rows) === JSON.stringify(["Ada"]), JSON.stringify(found.rows));
say("…and the foot says how many matched", found.foot === "1 of 5 match", found.foot);

await page.locator(".panel-shell .field input").fill("mine");
await settle(page, 400);
say("…including by a tag you put on yourself", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".agent-row .lb")].map((el) => el.textContent))) === JSON.stringify(["Iris"]));

/*
 * The query clears on a tab switch: a filter left over from the other list has its cause off
 * screen. This is the one thing the removed strip got right, and it was right because the
 * two lists differ — which is exactly the case here and was not the case there.
 */
await page.getByRole("tab", { name: "Boards" }).click();
await settle(page, 400);
say("switching tabs clears the query", (await page.locator(".panel-shell .field input").inputValue()) === "", await page.locator(".panel-shell .field input").inputValue());
say("…and the placeholder follows the tab", /boards$/.test((await page.locator(".panel-shell .field input").getAttribute("placeholder")) ?? ""), await page.locator(".panel-shell .field input").getAttribute("placeholder"));

// --- the customise popup ------------------------------------------------------------

await page.getByRole("tab", { name: "Agents" }).click();
await settle(page, 400);
await page.locator(".agent-row").first().hover();
await settle(page, 250);
await page.locator(".agent-row .agent-tagbtn").first().click();
await page.waitForSelector(".tagpop", { timeout: 4000 });
await settle(page, 400);

const pop = await page.evaluate(() => ({
	/* The popup exists to be typed into; one that opens with the cursor elsewhere costs a
	   click to use — and worse, the first Enter re-pressed the trigger and closed it. */
	focused: document.activeElement?.tagName,
	field: Math.round(document.querySelector(".tagpop .field")?.getBoundingClientRect().height ?? 0),
	chips: [...document.querySelectorAll(".tagpop .tag")].map((tag) => tag.textContent?.replace(/\s+/g, "")),
}));
say("the popup takes the cursor", pop.focused === "INPUT", pop.focused);
say("…with a field that did not collapse", pop.field === 32, `${pop.field}px`);
say("…showing only your own tags", JSON.stringify(pop.chips) === JSON.stringify(["mine"]), JSON.stringify(pop.chips));

await page.keyboard.type("Panel CSS, later");
await page.keyboard.press("Enter");
await settle(page, 400);
const sent = await page.evaluate(() => window.__sent.filter((frame) => frame.includes("agent.tags")).map((frame) => JSON.parse(frame)));
/*
 * Commas only, not whitespace: a tag may contain spaces, which the server turns into
 * hyphens — so `Panel CSS` is one tag called `panel-css`, and splitting on whitespace made
 * it two called `panel` and `css`.
 */
say("adding sends your tags, splitting on commas alone", JSON.stringify(sent.at(-1)?.tags) === JSON.stringify(["mine", "Panel CSS", "later"]), JSON.stringify(sent.at(-1)));
say("…for the agent whose row it is", sent.at(-1)?.id === "a3", sent.at(-1)?.id);
say("…and the popup stays open, so a second tag is one keystroke away", await page.evaluate(() => Boolean(document.querySelector(".tagpop"))));

await page.locator(".tagpop .tag-x").first().click();
await settle(page, 400);
const after = await page.evaluate(() => JSON.parse(window.__sent.filter((frame) => frame.includes("agent.tags")).at(-1)));
say("removing one sends the rest", JSON.stringify(after.tags) === JSON.stringify([]), JSON.stringify(after.tags));

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
