/**
 * A mirror: a board that is a live view of a conversation (DESIGN §4, §7).
 *
 * Every other board on the canvas draws itself from its own file. A mirror's file is a stub
 * that never changes — one component carrying `data-live="chat"` — and its turns arrive in
 * the browser, from a transcript the app is already holding for every agent. So what is
 * worth a browser here is exactly the part that is not in a unit test: that the two
 * documents find each other, that the list scrolls without trapping the canvas, and that it
 * lets go of the bottom when a reader does.
 *
 * The delta rule itself — what to send a board that already holds some turns — is
 * `canvas/live-chat.test.ts`. This drives the button a person would press.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 980 });

const MIRROR = '.board-node[data-path^="boards/mirrors/"]';
const inside = (fn, arg) =>
	page.evaluate(
		({ fn, arg }) => {
			const doc = document.querySelector('.board-node[data-path^="boards/mirrors/"] iframe')?.contentDocument;
			// eslint-disable-next-line no-new-func
			return new Function("doc", "arg", `return (${fn})(doc, arg)`)(doc, arg);
		},
		{ fn: fn.toString(), arg },
	);

// --- making one ------------------------------------------------------------------

await page.locator('button:has-text("Agents")').first().click();
await settle(page, 500);
say("the Agents tab lists somebody to mirror", (await page.locator(".agent-row").count()) > 0);

const button = page.locator('[aria-label^="Mirror "]').first();
say("every row offers a mirror", (await button.count()) > 0);
// Clicked through the DOM: the control is revealed by hover and this is about what it
// does, not about when it appears — `panel.mjs` is where the hover affordances are.
await page.evaluate(() => document.querySelector('[aria-label^="Mirror "]').click());
await page.waitForSelector(MIRROR, { timeout: 15000 });
say("pressing it puts a mirror on the canvas", true, await page.locator(MIRROR).getAttribute("data-path"));

await page.waitForFunction(
	() => document.querySelector('.board-node[data-path^="boards/mirrors/"] iframe')?.contentDocument?.querySelector(".live")?.dataset.state === "live",
	null,
	{ timeout: 15000 },
);
say("the board and the app find each other with no handshake to lose", true);
say(
	"…and it wears the agent's own name",
	(await inside((doc) => doc.querySelector(".live-name")?.textContent ?? "")).length > 0,
	await inside((doc) => doc.querySelector(".live-name")?.textContent),
);

/*
 * The file it wrote, and the point of the whole design: it is a stub. Anything that grew
 * as the conversation did would be a write per turn, a watcher event per write, and a
 * revision history nobody asked for.
 */
const source = await page.evaluate(async (path) => (await fetch(`/api/board/${path}`)).text(), await page.locator(MIRROR).getAttribute("data-path"));
say("the file is a stub, not a transcript", source.length < 900 && source.includes('data-live="chat"'), `${source.length} bytes`);

// --- feeding it ------------------------------------------------------------------

/*
 * Turns pushed in the way the app pushes them, so the rest of this is about the board's
 * own behaviour and not about whichever conversation the fixture happens to have.
 */
const agent = await inside((doc) => doc.querySelector(".live").dataset.agent);
const feed = (from, items) =>
	page.evaluate(
		({ agent, from, items }) => {
			const frame = document.querySelector('.board-node[data-path^="boards/mirrors/"] iframe');
			frame.contentWindow.postMessage({ decks: "live.chat", agent, from, items, total: from + items.length, identity: { name: "Probe", color: "#2eaf5a" } }, "*");
		},
		{ agent, from, items },
	);

/*
 * Enough turns to overflow the board several times over, and a tool call in every one.
 *
 * The count is load-bearing rather than arbitrary. A flex column only shrinks its children
 * when they do not fit, so twenty exchanges — which is what this fed before — sat inside a
 * 900px board at their natural height and the collapse this now guards against could not
 * happen. A real mirror of a working session is a hundred rows and mostly tool calls, and a
 * tool row is the one that collapses worst: it has `overflow: hidden` and no text of its own
 * pushing back.
 */
const many = [];
for (let i = 1; i <= 40; i++) {
	many.push({ kind: "user", id: `u${i}`, text: `Question ${i}`, at: 0 });
	many.push({ kind: "tool", id: `t${i}`, name: "Bash", title: `cd /home/decks/projects/decks && something ${i}`, at: 0 });
	many.push({ kind: "assistant", id: `a${i}`, text: `Answer **${i}**, long enough to take a line or two of the board it is drawn on.`, at: 0 });
}
await feed(0, many);
await settle(page, 800);

const list = () =>
	inside((doc) => {
		const box = doc.querySelector(".live-list");
		const chip = doc.querySelector(".live-new");
		return {
			turns: box.children.length,
			top: Math.round(box.scrollTop),
			max: Math.round(box.scrollHeight - box.clientHeight),
			chip: chip.hidden ? null : chip.textContent,
		};
	});

let state = await list();
say("every turn is drawn", state.turns === many.length, `${state.turns} of ${many.length}`);
say("more than fits means it scrolls", state.max > 0, `${state.max}px of overflow`);

/*
 * …and every one of them is its own height.
 *
 * `.live-list` is a scrolling flex column, and a flex column's first move when its children
 * do not fit is to *shrink them* rather than to scroll. Forty turns in a 900px board came
 * out at **6 pixels each** — a sliver of a pill with the text clipped out of it — and every
 * assertion above still passed, because forty turns were drawn and the box did overflow.
 *
 * So this measures the rows rather than counting them. The floor is deliberately below a
 * real line (13px at 1.5 is ~20px, a tool pill ~19px) and far above the collapsed state:
 * anything under 16px is not a row anybody can read.
 */
const shortest = await inside((doc) =>
	[...doc.querySelectorAll(".live-turn")].reduce(
		(worst, el) => {
			const h = Math.round(el.getBoundingClientRect().height);
			return h < worst.h ? { h, cls: el.className, text: (el.textContent ?? "").slice(0, 30) } : worst;
		},
		{ h: Infinity, cls: "", text: "" },
	),
);
say("…rather than squeezing every turn to fit", shortest.h >= 16, `shortest turn ${shortest.h}px — ${shortest.cls} ${JSON.stringify(shortest.text)}`);
say("and it opens at the newest turn", state.max - state.top <= 8, JSON.stringify(state));

// --- pinned to now, until you scroll away ------------------------------------------

await feed(many.length, [{ kind: "user", id: "u99", text: "one more", at: 0 }]);
await settle(page, 400);
state = await list();
say("a new turn while you are at the bottom follows", state.max - state.top <= 8 && state.turns === many.length + 1, JSON.stringify(state));

await inside((doc) => {
	doc.querySelector(".live-list").scrollTop = 40;
});
await settle(page, 300);
await feed(many.length + 1, [
	{ kind: "user", id: "u100", text: "and another", at: 0 },
	{ kind: "assistant", id: "a100", text: "and a reply", at: 0 },
]);
await settle(page, 400);
state = await list();
say("scroll away and it lets go rather than yanking you back", state.top === 40, JSON.stringify(state));
say("…and says how many you are missing", state.chip === "↓ 2 new", state.chip);

/*
 * A turn *growing* is not a turn you have missed. Without this the chip counted every
 * frame of a streaming answer, which is a number that means nothing and never stops.
 */
await feed(many.length + 2, [{ kind: "assistant", id: "a100", text: "and a reply, still arriving", at: 0, streaming: true }]);
await settle(page, 300);
state = await list();
say("a turn growing in place is not something you missed", state.chip === "↓ 2 new", state.chip);

await inside((doc) => doc.querySelector(".live-new").click());
await settle(page, 400);
state = await list();
say("pressing the chip goes back to now", state.chip === null && state.max - state.top <= 8, JSON.stringify(state));

// --- and it does not trap the canvas ------------------------------------------------

/*
 * The property the whole design leans on. `frame-gestures.ts` gives a wheel to the nearest
 * box inside a board that can still take it and hands it to the camera at the ends — so a
 * mirror scrolls under the pointer, and a flick past the last turn keeps going as a pan.
 * A board that swallowed the wheel outright would be a hole in an infinite canvas.
 */
const world = () => page.evaluate(() => document.querySelector(".world").style.transform);
const zoom = () => page.evaluate(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));

/*
 * Fly to it first, and *assert the zoom*, because below `INTERACT_ZOOM` a board takes no
 * pointer events at all: every wheel assertion below would pass for the wrong reason on a
 * canvas fitted to twenty boards, which is exactly how this check first went green.
 */
await page.locator(`${MIRROR} .chrome`).first().dblclick();
await settle(page, 900);
await page.waitForFunction(
	() =>
		document.querySelector('.board-node[data-path^="boards/mirrors/"] iframe')?.contentWindow?.__boardReady === true &&
		Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")) >= 50,
	null,
	{ timeout: 15000 },
);
say("zoomed in far enough for the board to take a wheel at all", (await zoom()) >= 50, `${await zoom()}%`);

const point = await page.evaluate(() => {
	const box = document.querySelector('.board-node[data-path^="boards/mirrors/"]').getBoundingClientRect();
	return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
});
await inside((doc) => {
	doc.querySelector(".live-list").scrollTop = 0;
});
await settle(page, 200);

const before = { camera: await world(), top: (await list()).top };
await page.mouse.move(point.x, point.y);
await page.mouse.wheel(0, 240);
await settle(page, 400);
const scrolled = await list();
say("a wheel over a mirror scrolls the mirror", scrolled.top > before.top, `${before.top} → ${scrolled.top}`);
say("…and leaves the camera alone", (await world()) === before.camera);

// Now to the end, and past it.
await inside((doc) => {
	const box = doc.querySelector(".live-list");
	box.scrollTop = box.scrollHeight;
});
await settle(page, 250);
const parked = await world();
await page.mouse.wheel(0, 240);
await settle(page, 400);
say("past the last turn the canvas takes over", (await world()) !== parked, "a mirror cannot trap the pointer");

// --- what it draws ---------------------------------------------------------------

/*
 * The shapes, which are the conversation column's rather than a mirror's own.
 *
 * This is the half of a mirror that is not about scrolling and is the part a reader actually
 * looks at, so it is asserted the way it is seen: your turn is a bubble with a tint and a
 * border, the agent's is flat prose on the panel, a run of finished tool calls is *one* row
 * that opens, a notice is a line rather than a card, and the last row says the agent is still
 * going. All of it is `apps/web/src/chat/`'s anatomy — `float-rows.ts`, `tool-groups.ts`, and
 * the numbers in `styles/stream.css` — and none of it is a second opinion about what a
 * transcript looks like.
 *
 * Fed as a fresh transcript (`from: 0` is a reset) so the assertions are about a known list
 * rather than about whatever the section above left behind.
 */
const turns = [
	{ kind: "user", id: "l1", text: "Which cell was it?", at: 0 },
	{ kind: "tool", id: "l2", name: "read", title: "block-edits.ts", state: "done" },
	{ kind: "tool", id: "l3", name: "read", title: "grapes-typing.mjs", state: "done" },
	{ kind: "tool", id: "l4", name: "grep", title: "holds blocks rather than words", state: "done" },
	{ kind: "tool", id: "l5", name: "bash", title: "node e2e/run.mjs grapes-typing", state: "running" },
	{ kind: "notice", id: "l6", level: "warn", text: "This chat continues on the default model.", at: 0 },
	{ kind: "assistant", id: "l7", text: "The `<td>` holding a table gets the **inner** cell, not the table.", at: 0 },
];
await feed(0, turns);
await settle(page, 600);

const look = await inside((doc) => {
	const style = (selector, prop) => {
		const el = doc.querySelector(selector);
		return el ? getComputedStyle(el)[prop] : null;
	};
	const box = (selector) => {
		const el = doc.querySelector(selector);
		const rect = el?.getBoundingClientRect();
		return rect ? { w: Math.round(rect.width), left: Math.round(rect.left), right: Math.round(rect.right) } : null;
	};
	return {
		// Yours: a bubble, right-aligned, with a tint and an edge of its own.
		bubble: {
			bg: style(".live-bubble", "backgroundColor"),
			border: style(".live-bubble", "borderTopWidth"),
			radius: style(".live-bubble", "borderTopLeftRadius"),
			box: box(".live-bubble"),
			row: box(".live-mine"),
		},
		// The agent's: flat, because this panel is the box the column's card would be.
		say: {
			bg: style(".live-say", "backgroundColor"),
			border: style(".live-say", "borderTopWidth"),
			font: style(".live-say", "fontSize"),
			line: style(".live-say", "lineHeight"),
		},
		// The log: one row for a run of finished calls, one for the call still going.
		rows: [...doc.querySelectorAll(".live-turn.live-tools > .live-tool")].map((el) => ({
			group: el.dataset.group !== undefined,
			state: el.dataset.state,
			h: Math.round(el.getBoundingClientRect().height),
			name: el.querySelector(".name")?.textContent ?? "",
			title: el.querySelector(".title")?.textContent ?? "",
		})),
		name: {
			font: style(".live-tool .name", "fontFamily"),
			size: style(".live-tool .name", "fontSize"),
			transform: style(".live-tool .name", "textTransform"),
		},
		notice: {
			bg: style(".live-notice", "backgroundColor"),
			border: style(".live-notice", "borderTopWidth"),
			colour: style(".live-notice", "color"),
			text: doc.querySelector(".live-notice")?.textContent ?? "",
		},
		panel: style(".live", "backgroundColor"),
	};
});

say("your turn is a bubble: tinted, edged, right-aligned", look.bubble.bg !== "rgba(0, 0, 0, 0)" && look.bubble.border === "1px" && look.bubble.radius === "12px", JSON.stringify(look.bubble));
say("…and narrower than the row it sits in", look.bubble.box.w < look.bubble.row.w - 20, `${look.bubble.box.w} of ${look.bubble.row.w}`);
say("…and it ends at the same edge as the column", look.bubble.box.right > look.bubble.row.right - 30, `${look.bubble.box.right} vs ${look.bubble.row.right}`);
say("the agent's reply is not in a box", look.say.bg === "rgba(0, 0, 0, 0)" && look.say.border === "0px", JSON.stringify(look.say));
say("…drawn at the column's own size", look.say.font === "12px" && Number.parseFloat(look.say.line) / 12 === 1.5, `${look.say.font}/${look.say.line}`);

say("a run of finished calls is one row, and a running call is not in it", look.rows.length === 2 && look.rows[0].group === true && look.rows[0].name === "3 done", JSON.stringify(look.rows));
say("…and the row still going keeps a line of its own", look.rows[1]?.state === "running" && look.rows[1]?.name === "bash", JSON.stringify(look.rows[1]));
say(
	"a tool row is a log line: a 24px row, mono, the name in capitals",
	look.rows[1]?.h === 24 && look.name.transform === "uppercase" && /mono|JetBrains/i.test(look.name.font),
	`${look.rows[1]?.h}px, ${look.name.size}, ${look.name.transform}`,
);

const opened = await inside((doc) => {
	doc.querySelector(".live-tool[data-group] > .live-row").click();
	return null;
});
void opened;
await settle(page, 200);
const nested = await inside((doc) => doc.querySelectorAll(".live-kids > .live-tool").length);
say("…which opens to the calls it was hiding", nested === 3, `${nested} nested calls`);

say("a notice is a line, not a card", look.notice.bg === "rgba(0, 0, 0, 0)" && look.notice.border === "0px" && look.notice.text.startsWith("This chat continues"), JSON.stringify(look.notice));

/*
 * The row at the foot, which is what makes a mirror live rather than merely recent: read off
 * the items, so it needs nothing in the protocol the column does not already send.
 */
const workingRow = () => inside((doc) => doc.querySelector(".live-working")?.textContent ?? null);
say("a call still running means the agent is working", (await workingRow()) === "running tools…", String(await workingRow()));

/*
 * …and the call finishing is what moves it on to the reply.
 *
 * Fed as a real turn is: the call ends, the reply streams, the reply ends. The two phrases the
 * column uses are both here because both are a claim about the agent, and a mirror that got
 * them wrong would be saying the wrong thing about a conversation somebody is watching.
 */
const finished = turns.slice(4).map((item) => (item.id === "l5" ? { ...item, state: "done" } : item));
await feed(4, [...finished, { kind: "assistant", id: "l8", text: "Done.", at: 0, streaming: true }]);
await settle(page, 400);
say("a reply still arriving means the same", (await workingRow()) === "working…", String(await workingRow()));

await feed(4, [...finished, { kind: "assistant", id: "l8", text: "Done.", at: 0 }]);
await settle(page, 400);
say("…and it goes when the turn does", (await workingRow()) === null, String(await workingRow()));

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
