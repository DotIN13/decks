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
 *
 * Two things about the list itself are pinned here as well, because they are decisions rather
 * than accidents: **the axis it opens on** (workspace), and **the order of the headings and the
 * rows inside them** (the names, A to Z, and the time each agent last said something).
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, context, errors } = await open({ width: 1400, height: 980 });

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

/*
 * What each agent says about itself, kept here because the row carries it.
 *
 * A chat list is the whole of what a browser knows about a chat — identity included — so a
 * second `agents` frame states every identity again. Declaring a workspace below writes it
 * here as well, or the next list would take it back off, which is exactly what the server
 * would do if an agent's own record had lost it.
 */
const says = {};
const identityOf = (id, name) => ({ name, color: "#3b5cf6", ...(says[id] ?? {}) });
/** Say something about an agent: the frame the app hears, and the row it will hear next. */
const declare = async (id, name, extra) => {
	says[id] = { ...(says[id] ?? {}), ...extra };
	await feed({ type: "agent.identity", id, identity: identityOf(id, name) });
};
const chat = (id, name, kind, state, lastLine, ago, extra = {}) => ({
	id,
	name,
	kind,
	state,
	...(lastLine ? { lastLine } : {}),
	lastAt: Date.now() - ago,
	unread: 0,
	identity: identityOf(id, name),
	boards: ["boards/plan.html", "boards/risks.html"],
	inPlay: [],
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
	await declare(id, name, { tags, ...(userTags.length ? { userTags } : {}) });
}
await feed({ type: "chat.item", agentId: "a4", item: { id: "w1", kind: "assistant", text: "Done — 12 boards measured", at: Date.now() - 900_000 } });
await settle(page, 800);

// --- the dropdown: the runtime as a word, still one line ---------------------------

/* The list opens from the composer's chip now: the pill has no agent segment. */
await page.locator(".dock-to-chip").click();
await page.waitForSelector(".popover", { timeout: 4000 });
await settle(page, 300);

const menu = await page.evaluate(() => ({
	width: Math.round(document.querySelector(".popover").getBoundingClientRect().width),
	rows: [...document.querySelectorAll('.popover [data-agent="true"]')].map((row) => ({
		h: Math.round(row.getBoundingClientRect().height),
		kind: row.querySelector(".kind")?.textContent,
		dormant: row.querySelector(".kind")?.dataset.dormant ?? null,
		name: row.querySelector(".row-label")?.textContent,
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

/*
 * What the panel opens on, before a single control is pressed: the **workspace** axis, which is
 * now the only one — and **two lines** per agent.
 *
 * The question a panel of a dozen agents is usually opened with is which project somebody is
 * on, and a project heading is a place that stays where it is while turns start and end. None
 * of these five has declared a project yet, so the whole list is one heading, `No workspace` —
 * which is itself worth asserting: the heading has to exist, or these agents would go missing
 * by not having been told something.
 */
const opened = await page.evaluate(() => ({
	/* The square beside the search is the row height on this tab, not a grouping. */
	view: document.querySelector(".panel-view")?.getAttribute("data-view"),
	offer: document.querySelector(".panel-view")?.getAttribute("aria-label"),
	lines: document.querySelector(".row-list.agent-list")?.getAttribute("data-lines"),
	sections: [...document.querySelectorAll(".panel-section")].map((one) => `${one.dataset.kind}:${one.querySelectorAll(".agent-row").length}`),
	label: document.querySelector(".panel-meta > span")?.textContent,
}));
say(
	"the agents list opens cut by workspace, which is one heading here, since none of these five has a project",
	JSON.stringify(opened.sections) === JSON.stringify(["unfiled:5"]) && opened.label === "No workspace",
	JSON.stringify([opened.sections, opened.label]),
);
say("…with two lines per agent, and the square offering one", opened.view === "lines-2" && opened.lines === "2" && opened.offer === "One line per agent", JSON.stringify(opened));

const rowsNow = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".agent-row")].map((agent) => ({
			name: agent.querySelector(".row-label")?.textContent,
			lines: agent.dataset.lines,
			h: Math.round(agent.getBoundingClientRect().height),
			kind: agent.querySelector(".kind")?.textContent,
			weight: getComputedStyle(agent.querySelector(".row-label")).fontWeight,
			avatar: Math.round(agent.querySelector(".row-icon")?.getBoundingClientRect().width ?? 0),
			state: agent.querySelector(".agent-state")?.textContent?.trim(),
			said: agent.querySelector(".agent-said")?.textContent?.trim(),
			/* The right-hand end of the name line: what the agent is doing, where the time used to be. */
			doing: agent.querySelector(".agent-line > .ago")?.textContent?.trim(),
			busy: agent.querySelector(".agent-line > .ago")?.dataset.busy ?? null,
			title: agent.querySelector(".agent-line > .ago")?.getAttribute("title") ?? null,
			swatch: agent.querySelector(".agent-line > .ago > .agent-swatch")?.dataset.status ?? null,
			/* The second line's tags, yours marked, and how many more it says there are. */
			rowTags: [...agent.querySelectorAll(".agent-tags .tag")].map((tag) => `${tag.textContent.trim()}${tag.dataset.mine ? "*" : ""}`),
			more: agent.querySelector(".tag-more")?.textContent?.trim() ?? null,
			dormant: agent.dataset.dormant ?? null,
			/* How far the face's centre sits from the text's: the face is centred on the words. */
			offCentre: (() => {
				const mid = (el) => {
					const box = el?.getBoundingClientRect();
					return box ? box.top + box.height / 2 : NaN;
				};
				return Math.round(Math.abs(mid(agent.querySelector(".row-icon")) - mid(agent.querySelector(".agent-body"))) * 10) / 10;
			})(),
			/* The name line, then at most one more: what it is doing, or what it last said. */
			shape: [...agent.querySelectorAll(".agent-body > *")].map((line) => line.className.split(" ")[0]),
			metaColumn: [agent.querySelector(".agent-line > .ago") !== null, agent.querySelector(".agent-line > .kind") !== null],
			/* The workspace is off the row — the heading above it names it — while the tags are on
			   it, which is what the second line is for. */
			chips: agent.querySelectorAll(".tag.ws").length,
			/* Side by side, not stacked: the row vocabulary collapses to one column unless the
			   avatar is in an `.row-icon` slot, and that mistake put the name under the face. */
			sideBySide: (() => {
				const ic = agent.querySelector(".row-icon")?.getBoundingClientRect();
				const body = agent.querySelector(".agent-body")?.getBoundingClientRect();
				return Boolean(ic && body && body.left >= ic.right);
			})(),
		})),
	);

const panel = {
	rows: await rowsNow(),
	...(await page.evaluate(() => ({
		foot: document.querySelector(".panel-foot")?.textContent?.trim(),
		placeholder: document.querySelector(".panel-shell .field input")?.placeholder,
	}))),
};
const rowOf = (name) => panel.rows.find((agent) => agent.name === name);

/* In the order they last said something: Ada 4s ago, Pi, Iris, Wren, Basil two hours ago. */
say("the rows are in the order they last said something", JSON.stringify(panel.rows.map((r) => r.name)) === JSON.stringify(["Ada", "Pi", "Iris", "Wren", "Basil"]), JSON.stringify(panel.rows.map((r) => r.name)));
/*
 * A finished turn keeps its place and says it is unread: "come and read this" is not the same
 * demand as "answer this now", and no heading promotes it.
 */
say("a finished turn keeps its place, and says it is not read yet", panel.rows[3]?.name === "Wren" && /^done · /.test(panel.rows[3]?.doing ?? ""), JSON.stringify(panel.rows[3]));
/*
 * Two lines is a height, not a count of what there is to say: Basil has no tags and has never
 * said anything, and its row is the same height as the rest with an empty second line.
 */
say("every row is two lines", panel.rows.every((agent) => agent.lines === "2" && agent.shape[0] === "agent-line" && agent.shape.length <= 2), JSON.stringify(panel.rows.map((r) => r.shape)));
say("the avatar is beside the name, not above it", panel.rows.every((agent) => agent.sideBySide), JSON.stringify(panel.rows.map((r) => r.sideBySide)));
say("…at 26px", panel.rows.every((agent) => agent.avatar === 26), JSON.stringify(panel.rows.map((r) => r.avatar)));
say("…on a 48px row, the face centred on the two lines", panel.rows.every((agent) => agent.h === 48 && agent.offCentre <= 1), JSON.stringify(panel.rows.map((r) => [r.h, r.offCentre])));
/*
 * **What it is doing is where the time was**, at the right-hand end of the name line, in the
 * row's short wording: `waiting for you`, `running tools…`, `done · 15m`, `idle · 2h`. It reads
 * as the state and the time at once, which the bare time never did — `4m` says an agent is
 * quiet and not whether it is quiet waiting for an answer.
 */
say(
	"the state is at the end of the name line, in the row's own wording",
	rowOf("Iris")?.doing === "waiting for you" && rowOf("Ada")?.doing === "running tools…" && rowOf("Pi")?.doing === "typing…" && /^done · /.test(rowOf("Wren")?.doing ?? ""),
	JSON.stringify(panel.rows.map((r) => [r.name, r.doing])),
);
/* Asking, working or finished unread reads in the row's own colour, with the ring's colour beside it. */
say(
	"…and a busy one is marked: a swatch in the status colour, and the reading weight",
	rowOf("Iris")?.busy === "true" && rowOf("Iris")?.swatch === "waiting" && rowOf("Ada")?.swatch === "working" && rowOf("Wren")?.swatch === "done" && rowOf("Basil")?.busy === null && rowOf("Basil")?.swatch === null,
	JSON.stringify(panel.rows.map((r) => [r.name, r.busy, r.swatch])),
);
/*
 * **The tags are where the last words were**: what an agent is working under is a standing
 * fact and the last line is a moment, and the moment is the one the hover card can hold.
 * Two of them, then how many more, so every row is the same height.
 */
say(
	"the second line is the tags, the agent's own and yours, two and a count",
	JSON.stringify(rowOf("Iris")?.rowTags) === JSON.stringify(["e2e", "flaky-editing"]) && rowOf("Iris")?.more === "+1" && JSON.stringify(rowOf("Ada")?.rowTags) === JSON.stringify(["panel-css", "measuring"]) && rowOf("Ada")?.more === null,
	JSON.stringify(panel.rows.map((r) => [r.name, r.rowTags, r.more])),
);
/* And the last thing it said when there are none, the way a chat list shows a message. */
say(
	"…and the last thing it said when it has no tags",
	rowOf("Pi")?.shape[1] === "agent-said" && rowOf("Pi")?.said === "Writing the report" && rowOf("Pi")?.rowTags?.length === 0,
	JSON.stringify(["Pi", "Basil"].map((name) => [name, rowOf(name)?.shape, rowOf(name)?.said])),
);
/* A dormant agent's name is set a step lighter, the way its runtime word is fainter. */
say(
	"the name is set in 600, a dormant one's lighter",
	panel.rows.every((agent) => (agent.dormant ? Number(agent.weight) < 600 : agent.weight === "600")),
	JSON.stringify(panel.rows.map((r) => `${r.name}:${r.weight}`)),
);
say("the runtime beside the name, the state at the line's end", JSON.stringify(rowOf("Ada")?.metaColumn) === JSON.stringify([true, true]) && rowOf("Ada")?.kind === "claude", JSON.stringify(rowOf("Ada")));
say("no row carries a workspace chip: the heading above it says that", panel.rows.every((agent) => agent.chips === 0), JSON.stringify(panel.rows.map((r) => r.chips)));
/*
 * Dormant beats idle: both are true and only one of them explains why nothing is happening.
 * Basil has said nothing, so its second line is the state, in one word.
 */
/*
 * Dormant beats idle: both are true of a parked agent and only one of them explains why nothing
 * is happening. It reads in the shape an idle row reads — the state, then when it last ran.
 */
const basil = rowOf("Basil");
say("…and dormant beats idle, with the time beside it", basil?.dormant === "true" && basil?.doing === "dormant · 2h", JSON.stringify([basil?.dormant, basil?.doing]));
/* The foot counts, and it is the only count: the headings carry a + instead. */
say("there is no foot under the list: the count lives in the headings", panel.foot === undefined, String(panel.foot));
/* It names what it searches and how many; it still matches tags and workspaces, as below. */
say("the field says what it searches, and how many", panel.placeholder === "Search 5 agents", panel.placeholder);

// --- approaching a row, and what is allowed to move ---------------------------------
/*
 * The two buttons arrive over the *first line* and nothing else may move.
 *
 * They were flex siblings of the row's body, so their arrival took 24px off it, and the lines
 * under the name reflowed as the pointer crossed the list, losing words to an ellipsis for a
 * button above them. They stand on the name line; nothing under it was ever in their way.
 */
const geometry = () =>
	page.evaluate(() => {
		const row = [...document.querySelectorAll(".agent-row")].find((agent) => agent.querySelector(".row-label")?.textContent === "Ada");
		if (!row) return null;
		const at = row.getBoundingClientRect();
		const line = row.querySelector(".agent-line");
		const style = getComputedStyle(line);
		const shown = [...row.querySelectorAll(".agent-tagbtn, .close")].filter((button) => getComputedStyle(button).display !== "none");
		const words = [...line.children].filter((child) => getComputedStyle(child).display !== "none").pop();
		return {
			body: Math.round(row.querySelector(".agent-body").getBoundingClientRect().width),
			/* The second line, whatever it is drawing: tags, the last words, or the state. */
			second: Math.round(row.querySelector(".agent-body > :nth-child(2)")?.getBoundingClientRect().width ?? 0),
			nameRoom: Math.round(line.clientWidth - parseFloat(style.paddingRight)),
			buttons: shown.length,
			firstButtonAt: shown.length > 0 ? Math.round(Math.min(...shown.map((button) => button.getBoundingClientRect().left - at.left))) : null,
			wordsEndAt: words ? Math.round(words.getBoundingClientRect().right - at.left) : null,
		};
	});

const still = await geometry();
await page.locator(".agent-row").filter({ hasText: "Ada" }).first().hover();
await settle(page, 400);
const approached = await geometry();

say("approaching a row brings its buttons out", approached.buttons > 0 && still.buttons === 0, `${still.buttons} → ${approached.buttons}`);
say(
	"…and the line under the name does not move",
	approached.second === still.second && still.second > 0,
	`the second line ${still.second}→${approached.second}`,
);
/* The one line that does give ground — it is the line they stand on. */
say("…while the name line gives up exactly their column", approached.nameRoom < still.nameRoom, `${still.nameRoom} → ${approached.nameRoom}`);
say(
	"…so the words never run under a button",
	approached.wordsEndAt <= approached.firstButtonAt,
	`words end at ${approached.wordsEndAt}, first button at ${approached.firstButtonAt}`,
);
await page.mouse.move(4, 4);
await settle(page, 300);

// --- searching by tag, and the query clearing on a switch --------------------------

await page.locator(".panel-shell .field input").fill("panel-css");
await settle(page, 400);
const found = await page.evaluate(() => ({
	rows: [...document.querySelectorAll(".agent-row .row-label")].map((el) => el.textContent),
}));
say("searching a tag finds the agent on it", JSON.stringify(found.rows) === JSON.stringify(["Ada"]), JSON.stringify(found.rows));

await page.locator(".panel-shell .field input").fill("mine");
await settle(page, 400);
say("…including by a tag you put on yourself", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".agent-row .row-label")].map((el) => el.textContent))) === JSON.stringify(["Iris"]));

/*
 * The query clears on a tab switch: a filter left over from the other list has its cause off
 * screen. This is the one thing the removed strip got right, and it was right because the
 * two lists differ — which is exactly the case here and was not the case there.
 */
await page.getByRole("tab", { name: "Boards" }).click();
await settle(page, 400);
say("switching tabs clears the query", (await page.locator(".panel-shell .field input").inputValue()) === "", await page.locator(".panel-shell .field input").inputValue());
say("…and the placeholder follows the tab", /boards$/.test((await page.locator(".panel-shell .field input").getAttribute("placeholder")) ?? ""), await page.locator(".panel-shell .field input").getAttribute("placeholder"));

// --- the edit window ------------------------------------------------------------------

/*
 * The pen opens a window of three rows — the fact on the left, its control on the right —
 * and nothing written under any of them. A rule shows only when it bites: a taken name is a
 * red line under the field, and the tag field goes away at the cap.
 */
await page.getByRole("tab", { name: "Agents" }).click();
await settle(page, 400);
/* Iris's pen: she is the one with a tag of yours, and the one the window's assertions are about. */
const irisRow = page.locator(".agent-row").filter({ hasText: "Iris" }).first();
await irisRow.hover();
await settle(page, 250);
await irisRow.locator(".agent-tagbtn").click();
await page.waitForSelector('[role="dialog"]', { timeout: 4000 });
await settle(page, 400);

const pop = await page.evaluate(() => ({
	/* It exists to be typed into, and the name is what most visits are for — a window that
	   opens with the cursor elsewhere costs a click to use. */
	focused: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
	fields: [...document.querySelectorAll('[role="dialog"] .field')].map((field) => Math.round(field.getBoundingClientRect().height)),
	rows: [...document.querySelectorAll('[role="dialog"] .agent-edit-k')].map((k) => k.textContent),
	notes: [...document.querySelectorAll('[role="dialog"] p')].length,
	picker: document.querySelector('[role="dialog"] .agent-edit-pick')?.textContent?.trim(),
	theirs: [...document.querySelectorAll('[role="dialog"] .tag:not([data-mine])')].length,
	mine: [...document.querySelectorAll('[role="dialog"] .tag[data-mine]')].map((tag) => tag.textContent?.replace(/\s+/g, "")),
}));
say("the window takes the cursor, in the name", pop.focused === "Agent name", String(pop.focused));
say("…and holds the three things about an agent you can change, as rows", JSON.stringify(pop.rows) === JSON.stringify(["Name", "Workspace", "Tags"]), JSON.stringify(pop.rows));
say("…with nothing written under them", pop.notes === 0, `${pop.notes} notes`);
say("…with fields that did not collapse", pop.fields.length === 3 && pop.fields.every((height) => height === 32), JSON.stringify(pop.fields));
say("…the workspace as a picker, saying it is on none", pop.picker === "No workspace", String(pop.picker));
/* Yours alone: the agent's own tags stay on its row, and only yours carry a way to remove them. */
say("…only your tags, each with a way to remove it", pop.theirs === 0 && JSON.stringify(pop.mine) === JSON.stringify(["mine"]), JSON.stringify(pop.mine));

// A name another agent already answers to: said in red, under the field, and not sent.
await page.keyboard.type("Ada");
await page.keyboard.press("Enter");
await settle(page, 300);
const refused = await page.evaluate(() => ({
	line: document.querySelector('[role="dialog"] .agent-edit-err')?.textContent?.trim(),
	sent: window.__sent.filter((frame) => frame.includes("agent.rename")).length,
}));
say("a taken name says so under the field and is not sent", refused.line === "Another agent is already called Ada." && refused.sent === 0, JSON.stringify(refused));

// The name: typed and committed with Enter, which is the one field that can be refused.
await page.locator('[role="dialog"] input[aria-label="Agent name"]').fill("Iris the second");
await page.keyboard.press("Enter");
await settle(page, 400);
const renamed = await page.evaluate(() => window.__sent.filter((frame) => frame.includes("agent.rename")).map((frame) => JSON.parse(frame)).at(-1));
say("renaming sends the new name, for the agent whose row it is", renamed?.name === "Iris the second" && renamed?.id === "a3", JSON.stringify(renamed));

// The workspace: picked from the list, never typed.
await page.locator('[role="dialog"] .agent-edit-pick').click();
await page.waitForSelector(".popover.agent-edit-list", { timeout: 4000 });
const listed = await page.evaluate(() => [...document.querySelectorAll(".popover.agent-edit-list [data-row] .row-label")].map((lb) => lb.textContent?.trim()));
/* No agent has declared a workspace yet, so the list is none and a new one — and the new one
   is the one place a workspace is typed. */
say("the picker lists every workspace in use, none, and a new one", JSON.stringify(listed) === JSON.stringify(["No workspace", "New workspace…"]), JSON.stringify(listed));
await page.locator(".popover.agent-edit-list [data-row]", { hasText: "New workspace…" }).click();
await page.waitForSelector(".popover.agent-edit-list input", { timeout: 4000 });
await page.locator(".popover.agent-edit-list input").fill("political-llm");
await page.keyboard.press("Enter");
await settle(page, 300);
const picked = await page.evaluate(() => ({
	...window.__sent.filter((frame) => frame.includes("agent.workspace")).map((frame) => JSON.parse(frame)).at(-1),
	listOpen: Boolean(document.querySelector(".popover.agent-edit-list")),
}));
say("naming a new one sends the workspace, for the agent whose row it is, and the list closes", picked.workspace === "political-llm" && picked.id === "a3" && !picked.listOpen, JSON.stringify(picked));

await page.locator('[role="dialog"] input[placeholder="Add a tag"]').fill("Panel CSS, later");
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
say("…and the window stays open, so a second tag is one keystroke away", await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))));

await page.locator('[role="dialog"] .tag-x').first().click();
await settle(page, 400);
const after = await page.evaluate(() => JSON.parse(window.__sent.filter((frame) => frame.includes("agent.tags")).at(-1)));
say("removing one sends the rest", JSON.stringify(after.tags) === JSON.stringify([]), JSON.stringify(after.tags));

await page.keyboard.press("Escape");
await settle(page, 300);
say("Escape closes it", (await page.locator('[role="dialog"]').count()) === 0);


// --- the workspace axis ---------------------------------------------------------------

/*
 * The same five agents, filed by project — which is the second question this panel answers and
 * the one an agent answers for itself: `stage.me.setWorkspace` writes the same identity field
 * this frame carries, so there is nothing here a real agent could not have done.
 */
for (const [id, name, tags, workspace] of [
	["a1", "Ada", ["panel-css", "measuring"], "political-llm"],
	["a2", "Pi", [], "political-llm"],
	["a4", "Wren", ["thumbnails"], "irb-84069"],
	["a3", "Iris", ["e2e", "flaky-editing"], undefined],
	["a5", "Basil", [], undefined],
]) {
	await declare(id, name, { tags, ...(workspace ? { workspace } : {}) });
}
await settle(page, 500);

/* Filed, and the row says its tags but never its workspace: the heading above it names that. */
const chipped = await page.evaluate(() => ({
	ws: document.querySelectorAll(".agent-row .tag.ws").length,
	tags: document.querySelectorAll(".agent-row .tag").length,
}));
say("a workspace is not drawn on the row: its heading says it", chipped.ws === 0 && chipped.tags > 0, JSON.stringify(chipped));

const filed = await page.evaluate(() => {
	return [...document.querySelectorAll(".panel-section")].map((section) => ({
		kind: section.dataset.kind,
		label: section.querySelector(".panel-meta > span")?.textContent,
		note: section.querySelector(".panel-meta .note")?.textContent ?? null,
		plus: section.querySelector(".panel-meta button")?.getAttribute("aria-label") ?? null,
		rows: [...section.querySelectorAll(".agent-row")].map((row) => row.querySelector(".row-label")?.textContent),
	}));
});
/*
 * **Alphabetical, and the focused agent does not lead.** Ada is focused and is in
 * `political-llm`, which sorts second here; a heading that moved to the front for being the
 * conversation on screen would move again every time an agent is switched.
 *
 * `No workspace` is last, which is where an agent nobody has told about a project belongs. That
 * heading is the one that has to exist: a list that hid them would be a list an agent can vanish
 * from by not being told something.
 */
say(
	"…and by workspace: three sections, in the order of their names",
	JSON.stringify(filed.map((one) => one.label)) === JSON.stringify(["irb-84069", "political-llm", "No workspace"]),
	JSON.stringify(filed.map((one) => one.label)),
);
say("…with the focused agent's project second, where its name puts it", filed[1]?.label === "political-llm", JSON.stringify(filed.map((one) => one.label)));
say("…the rows in the order they last said something", JSON.stringify(filed[1]?.rows) === JSON.stringify(["Ada", "Pi"]), JSON.stringify(filed[1]?.rows));
say(
	"…and the heading says who needs you, which the heading itself does not",
	filed[0]?.note === null && filed[1]?.note === "2 working" && filed[2]?.note === "1 wants you",
	JSON.stringify(filed.map((one) => one.note)),
);
say("…and each heading carries a + that makes an agent in that project, instead of a count", JSON.stringify(filed.map((one) => one.plus)) === JSON.stringify(["Add an agent in irb-84069", "Add an agent in political-llm", "Add an agent in no workspace"]), JSON.stringify(filed.map((one) => one.plus)));

/*
 * **A message moves a row, and nothing else does.** Basil is dormant and Iris has been waiting
 * for a minute and a half; both are in `No workspace`. Give Basil a fresh message and it leads
 * the heading while Iris, the one that needs an answer, stays under it — with the heading saying
 * so. That is the rule the row order follows, and it is not urgency: a row moves when its agent
 * says something, not when it opens a tool or changes state.
 */
await feed({
	type: "agents",
	defaultKind: "pi",
	focused: "a1",
	chats: [
		chat("a1", "Ada", "claude", "tool", "Reading panel.css", 4_000),
		chat("a2", "Pi", "pi", "streaming", "Writing the report", 20_000),
		chat("a3", "Iris", "claude", "waiting", "Allow this command?", 90_000),
		chat("a4", "Wren", "pi", "idle", "Done, 12 boards measured", 900_000),
		chat("a5", "Basil", "claude", "idle", "Just arrived", 1_000, { dormant: true }),
	],
});
await settle(page, 500);

const moved = await page.evaluate(() =>
	[...document.querySelectorAll(".panel-section")].map((section) => ({
		label: section.querySelector(".panel-meta > span")?.textContent,
		note: section.querySelector(".panel-meta .note")?.textContent ?? null,
		rows: [...section.querySelectorAll(".agent-row")].map((row) => row.querySelector(".row-label")?.textContent),
	})),
);
const loose = moved.find((one) => one.label === "No workspace");
say("a new message moves a row to the top of its heading", JSON.stringify(loose?.rows) === JSON.stringify(["Basil", "Iris"]), JSON.stringify(loose?.rows));
say("…while the one waiting stays where it is, and the heading still says so", loose?.note === "1 wants you", JSON.stringify(loose?.note));
/* Basil is not busy — dormant, asking nothing — so now that it has said something, that is its second line. */
const basilSaid = await page.evaluate(() => {
	const row = [...document.querySelectorAll(".agent-row")].find((one) => one.querySelector(".row-label")?.textContent === "Basil");
	return { said: row?.querySelector(".agent-said")?.textContent?.trim(), state: row?.querySelector(".agent-state")?.textContent?.trim() };
});
say("an agent with nothing going on shows the last thing it said instead of a state", basilSaid.said === "Just arrived" && basilSaid.state === undefined, JSON.stringify(basilSaid));

/* Searching by project works in either grouping — which is what makes it a way to *find* one. */
await page.locator(".panel-shell input").first().fill("irb");
await settle(page, 400);
const byProject = await page.evaluate(() => [...document.querySelectorAll(".agent-row")].map((row) => row.querySelector(".row-label")?.textContent));
say("searching a project name finds its agents", JSON.stringify(byProject) === JSON.stringify(["Wren"]), JSON.stringify(byProject));
await page.locator(".panel-shell input").first().fill("");
await settle(page, 300);

// --- one line or two -----------------------------------------------------------------

/*
 * In the two-line view the row says what the agent is doing, so pointing at it opens nothing:
 * the card would repeat the row beside the row.
 */
const two = await rowsNow();
await page.locator(".agent-row").filter({ hasText: "Iris" }).first().locator("[data-row]").hover();
await settle(page, 300);
const cardInTwo = await page.evaluate(() => [...document.querySelectorAll(".agent-hover")].filter((el) => el.dataset.shown === "true").length);
say("in the two-line view pointing at a row opens no card", cardInTwo === 0, `${cardInTwo} cards shown`);
await page.mouse.move(700, 500);
await settle(page, 200);

/* The square switches the rows to one line: name, runtime and time, and a smaller face. */
await page.locator('.panel-view[data-view="lines-2"]').click();
await settle(page, 400);
const one = {
	rows: await rowsNow(),
	...(await page.evaluate(() => ({
		view: document.querySelector(".panel-view")?.getAttribute("data-view"),
		offer: document.querySelector(".panel-view")?.getAttribute("aria-label"),
		lists: [...document.querySelectorAll(".row-list.agent-list")].map((list) => list.getAttribute("data-lines")),
		stored: localStorage.getItem("decks.agentLines"),
	}))),
};
say("pressing the square gives one line per agent, and it offers two", one.view === "lines-1" && one.offer === "Two lines per agent" && one.lists.length > 0 && one.lists.every((n) => n === "1"), JSON.stringify([one.view, one.offer, one.lists]));
say("…each row only its name line", one.rows.every((agent) => agent.lines === "1" && JSON.stringify(agent.shape) === JSON.stringify(["agent-line"])), JSON.stringify(one.rows.map((r) => r.shape)));
say("…with a 20px face", one.rows.every((agent) => agent.avatar === 20), JSON.stringify(one.rows.map((r) => r.avatar)));
say("…on a 26px row, the face centred on the line", one.rows.every((agent) => agent.h === 26 && agent.offCentre <= 1), JSON.stringify(one.rows.map((r) => [r.h, r.offCentre])));
say(
	"…and every row shorter than it was",
	one.rows.length === two.length && one.rows.every((agent) => agent.h < (two.find((was) => was.name === agent.name)?.h ?? 0)),
	`${JSON.stringify(two.map((r) => r.h))} → ${JSON.stringify(one.rows.map((r) => r.h))}`,
);
say("…and the choice is remembered", one.stored === "1", String(one.stored));

/* With the second line gone, the card beside the panel says what the row no longer does. */
const irisOne = page.locator(".agent-row").filter({ hasText: "Iris" }).first();
await irisOne.locator("[data-row]").hover();
await settle(page, 300);
const beside = await page.evaluate(() => {
	const shown = [...document.querySelectorAll(".agent-hover")].find((el) => el.dataset.shown === "true");
	if (!shown) return { shown: false };
	const box = shown.getBoundingClientRect();
	const panelBox = document.querySelector(".panel-shell").getBoundingClientRect();
	const row = [...document.querySelectorAll(".agent-row")].find((one) => one.querySelector(".row-label")?.textContent === "Iris").getBoundingClientRect();
	return {
		shown: true,
		text: shown.innerText.replace(/\n+/g, " | "),
		/* Beside the row it describes, not over it. (It is anchored on the row, so it can
		   overlap the panel's own outer padding by a few pixels; the rows are what it must clear.) */
		beside: Math.round(box.left) >= Math.round(row.right),
		/* Level with the row it describes, not parked at the top of the screen. */
		level: box.top <= row.bottom && box.bottom >= row.top,
		box: { left: Math.round(box.left), top: Math.round(box.top), bottom: Math.round(box.bottom) },
		panel: Math.round(panelBox.right),
		row: { top: Math.round(row.top), bottom: Math.round(row.bottom), right: Math.round(row.right) },
	};
});
say("in the one-line view pointing at a row opens its card", beside.shown === true && /Iris/.test(beside.text ?? ""), JSON.stringify(beside));
say("…beside the row, level with it", beside.beside === true && beside.level === true, JSON.stringify([beside.box, beside.panel, beside.row]));

/*
 * **And it is one card that travels, not a new card per row.**
 *
 * `AgentHoverCard` is built to be mounted once and unhidden: until it has measured itself
 * against a new anchor it draws nothing, so that it can never flash at `0,0` on the way to a
 * row. Mounted inside a `Show` on the hovered row that promise inverts — every row entered
 * built one, hid it for a frame and faded it in, every row left threw it away, and running the
 * pointer down a dense list read as a strobe. The card is marked here and looked for again
 * after crossing to another row: the same element, moved, still up.
 */
await page.evaluate(() => {
	const shown = [...document.querySelectorAll(".agent-hover")].find((el) => el.dataset.shown === "true");
	if (shown) shown.dataset.marked = "1";
});
const wasAt = await page.evaluate(() => Math.round([...document.querySelectorAll(".agent-hover")].find((el) => el.dataset.marked)?.getBoundingClientRect().top ?? 0));
await page.locator(".agent-row").filter({ hasText: "Basil" }).first().locator("[data-row]").hover();
await settle(page, 300);
const travelled = await page.evaluate(() => {
	const shown = [...document.querySelectorAll(".agent-hover")].find((el) => el.dataset.shown === "true");
	return shown ? { same: shown.dataset.marked === "1", top: Math.round(shown.getBoundingClientRect().top), text: shown.innerText.replace(/\n+/g, " | ") } : { same: false, top: 0, text: "" };
});
say(
	"crossing to another row moves that one card rather than building a second",
	travelled.same === true && /Basil/.test(travelled.text) && travelled.top !== wasAt,
	JSON.stringify({ wasAt, ...travelled }),
);
/* And leaving the list hides it where it is, rather than tearing it down. */
await page.mouse.move(700, 500);
await settle(page, 400);
const kept = await page.evaluate(() => {
	const card = [...document.querySelectorAll(".agent-hover")].find((el) => el.dataset.marked);
	return { there: Boolean(card), shown: card?.dataset.shown };
});
say("…and leaving the list hides that card rather than throwing it away", kept.there === true && kept.shown === "false", JSON.stringify(kept));
await page.mouse.move(700, 500);
await settle(page, 400);
const gone = await page.evaluate(() => [...document.querySelectorAll(".agent-hover")].filter((el) => el.dataset.shown === "true").length);
say("…and leaving the row puts it away", gone === 0, `${gone} cards shown`);

/* The buttons still arrive over the name line, which gives up their column. */
const adaOne = page.locator(".agent-row").filter({ hasText: "Ada" }).first();
const stillOne = await geometry();
await adaOne.hover();
await settle(page, 400);
const approachedOne = await geometry();
say(
	"…and in one line, approaching a row still brings its buttons over the name line",
	stillOne.buttons === 0 && approachedOne.buttons > 0 && approachedOne.nameRoom < stillOne.nameRoom && approachedOne.wordsEndAt <= approachedOne.firstButtonAt,
	JSON.stringify([stillOne, approachedOne]),
);
await page.mouse.move(700, 500);
await settle(page, 300);

// --- the boards' grid and the agents' lines are two settings ---------------------------

/*
 * The square is one button with two jobs, one per tab, and the two must not leak: the boards'
 * grid once laid agent rows two across, because the list carried the density on both tabs.
 */
const agentLayout = () =>
	page.evaluate(() => {
		const rows = [...document.querySelectorAll(".agent-row")].map((row) => row.getBoundingClientRect());
		return {
			density: document.querySelector(".panel-list")?.getAttribute("data-density") ?? null,
			lines: document.querySelector(".row-list.agent-list")?.getAttribute("data-lines"),
			/* One column: every row starts at the same left, each below the last. */
			column: rows.length > 1 && rows.every((box) => Math.round(box.left) === Math.round(rows[0].left)) && rows.every((box, i) => i === 0 || box.top >= rows[i - 1].bottom - 1),
		};
	});
const boardsView = async () => {
	await page.getByRole("tab", { name: "Boards" }).click();
	await settle(page, 300);
	return page.evaluate(() => document.querySelector(".panel-view")?.getAttribute("data-view"));
};
const densityBefore = await boardsView();
await page.locator(".panel-view").click();
await settle(page, 300);
const densityGrid = await page.evaluate(() => document.querySelector(".panel-view")?.getAttribute("data-view"));
await page.getByRole("tab", { name: "Agents" }).click();
await settle(page, 400);
const underGrid = await agentLayout();
say(
	"with the boards as a grid, the agents are still one column, at the line count they had",
	densityGrid !== densityBefore && underGrid.density === null && underGrid.column && underGrid.lines === "1",
	JSON.stringify({ boards: `${densityBefore}→${densityGrid}`, ...underGrid }),
);
await page.locator('.panel-view[data-view="lines-1"]').click();
await settle(page, 300);
const densityAfterLines = await boardsView();
say("…and switching agent lines leaves the boards' density alone", densityAfterLines === densityGrid, `${densityGrid} → ${densityAfterLines}`);
/* Put both back: the boards as they were, the agents in one line. */
await page.locator(".panel-view").click();
await settle(page, 300);
await page.getByRole("tab", { name: "Agents" }).click();
await settle(page, 300);
await page.locator('.panel-view[data-view="lines-2"]').click();
await settle(page, 300);
const restored = { lines: await page.evaluate(() => document.querySelector(".panel-view")?.getAttribute("data-view")), boards: await boardsView() };
say("…and both are back where they were", restored.lines === "lines-1" && restored.boards === densityBefore, JSON.stringify(restored));
await page.getByRole("tab", { name: "Agents" }).click();
await settle(page, 300);

/* And the dropdown, where two named workspaces are two runs to tell apart. */
/* The list opens from the composer's chip now: the pill has no agent segment. */
await page.locator(".dock-to-chip").click();
await page.waitForSelector(".popover", { timeout: 4000 });
await settle(page, 300);
const dropdown = await page.evaluate(() => {
	/*
	 * Read in document order, tracking which heading each row is under — because what the
	 * dropdown promises is *filing*, not an order. Its rows are ranked by urgency, and the
	 * groups are ordered by their best-ranked member, so the order of the headings is a
	 * consequence of that ranking rather than a rule of its own.
	 */
	const card = document.querySelector(".popover");
	const filed = [];
	let group;
	for (const child of card?.children ?? []) {
		if (child.classList.contains("group")) group = child.textContent;
		else for (const row of child.querySelectorAll('[data-agent="true"]')) filed.push(`${group}:${row.querySelector(".row-label")?.textContent}`);
	}
	return { groups: [...document.querySelectorAll(".popover .group")].map((one) => one.textContent), filed };
});
const expected = ["political-llm:Ada", "political-llm:Pi", "No workspace:Iris", "irb-84069:Wren", "No workspace:Basil"].sort();
say(
	"the dropdown files each agent under its own project",
	JSON.stringify([...dropdown.filed].sort()) === JSON.stringify(expected),
	JSON.stringify(dropdown.filed),
);
say("…and it is the same three words as the panel's headings", JSON.stringify([...dropdown.groups].sort()) === JSON.stringify(["No workspace", "irb-84069", "political-llm"]), JSON.stringify(dropdown.groups));
await page.keyboard.press("Escape");

/*
 * Past thirteen agents the dropdown stops listing and counts the rest. The count is a row,
 * not a sentence: pressing it opens the panel on its Agents tab, which is where the rest are.
 */
await feed({
	type: "agents",
	chats: Array.from({ length: 16 }, (_, index) => chat(`m${index}`, `Many ${index}`, "claude", "idle", undefined, 60_000 * (index + 1))),
});
await settle(page, 500);
await page.getByRole("tab", { name: "Boards" }).click();
await settle(page, 300);
await page.locator(".dock-to-chip").click();
await page.waitForSelector(".popover .agent-menu-more", { timeout: 4000 });
const overflow = await page.evaluate(() => ({
	rows: document.querySelectorAll('.popover [data-agent="true"]').length,
	more: document.querySelector(".popover .agent-menu-more .row-label")?.textContent?.trim(),
}));
say("past the cap the dropdown lists thirteen and counts the rest, as a row", overflow.rows === 13 && overflow.more === "3 more agents", JSON.stringify(overflow));
await page.locator(".popover .agent-menu-more").click();
await settle(page, 500);
const landed = await page.evaluate(() => ({
	popover: document.querySelectorAll(".popover").length,
	panel: document.querySelector(".panel-shell")?.dataset.open === "true",
	tab: document.querySelector('.panel-shell [role="tab"][aria-selected="true"]')?.textContent?.trim(),
	rows: document.querySelectorAll(".panel-shell .agent-row").length,
}));
say("…and pressing it opens the panel on its Agents tab, with every agent listed", landed.popover === 0 && landed.panel && landed.tab === "Agents" && landed.rows === 16, JSON.stringify(landed));

/*
 * The choice outlives the page. A second tab in the same browser, because the harness clears
 * storage on every load of the first one — which is exactly the thing being tested.
 */
const second = await context.newPage();
await second.goto(page.url(), { waitUntil: "load" });
await settle(second, 1500);
if (!(await second.evaluate(() => Boolean(document.querySelector(".panel-shell"))))) await second.locator('[aria-label*="boards panel" i]').first().click();
await second.waitForSelector(".panel-shell", { timeout: 5000 });
await second.getByRole("tab", { name: "Agents" }).click();
await settle(second, 400);
/* Wait for the square to be the agents' one: the tab switch is a render away. */
await second.waitForFunction(() => /^lines-/.test(document.querySelector(".panel-view")?.getAttribute("data-view") ?? ""), null, { timeout: 4000 }).catch(() => {});
const reopened = await second.evaluate(() => document.querySelector(".panel-view")?.getAttribute("data-view"));
say("one line per agent survives a new page", reopened === "lines-1", String(reopened));
await second.close();

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
