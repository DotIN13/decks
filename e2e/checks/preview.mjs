/**
 * The time machine's preview, seen from the canvas.
 *
 * Previewing a past point turns every board amber and takes pointer events off every frame
 * — one CSS rule pair on `.stage`, so the colour and the deadness are the same fact. The
 * state was invisible from the canvas and had no way out of it: the only handle was a row
 * inside one message's own menu, in a transcript that is away by default. Somebody stuck in
 * it saw a canvas of yellow boards that would not take a click and nothing saying why.
 *
 * So this file is mostly about the *sign*: that it says what is happening, that pressing it
 * ends it, that Escape does too, and — the assertion that would have caught the first
 * attempt — that the thing is actually reachable rather than sitting under the left panel.
 *
 * The preview is fed as a `timeline.preview` frame. The real one is a reply to
 * `rewind.preview`, which needs a session entry, which needs a turn and a model; the frame
 * is the same shape the server sends and the browser cannot tell the difference.
 */
import { editMode, open, say, settle } from "../harness.mjs";

const wrap = () => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.__frames = [];
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
			this.addEventListener("message", (event) => {
				try {
					window.__frames.push(JSON.parse(event.data));
				} catch {
					/* not ours */
				}
			});
		}
	};
};

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await page.addInitScript(wrap);
await page.reload({ waitUntil: "load" });
await settle(page, 2500);
/*
 * Edit mode *after* the reload, not `open({ edit: true })` before it: the mode is
 * deliberately not persisted, so the reload that installs the socket wrapper puts the app
 * back in browse. It is needed at all because half of what is checked here is the editing
 * sign standing down while a preview is up, and coming back afterwards.
 */
await editMode(page);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
/*
 * The real focused agent, not a made-up one: the canvas draws the boards *that agent* has in
 * play, so a synthetic `agents` frame would empty it and leave nothing to be amber.
 */
const focused = await page.evaluate(() => window.__frames.filter((frame) => frame.type === "agents").at(-1)?.focused);
const context = await page.evaluate(() => window.__frames.filter((frame) => frame.type === "context.changed").at(-1));

const stage = () =>
	page.evaluate(() => ({
		previewing: document.querySelector(".stage")?.dataset.mode !== undefined ? document.querySelector(".stage")?.dataset.previewing : null,
		mode: document.querySelector(".stage")?.dataset.mode,
		badge: getComputedStyle(document.querySelector(".stage"), "::before").content,
		ring: getComputedStyle(document.querySelector(".stage"), "::after").boxShadow !== "none",
		boards: [...document.querySelectorAll(".board-node")].map((node) => ({
			path: node.dataset.path,
			outline: getComputedStyle(node.querySelector(".surface")).outlineColor,
			pointer: node.querySelector("iframe") ? getComputedStyle(node.querySelector("iframe")).pointerEvents : "unmounted",
		})),
		sign: document.querySelector(".preview-sign")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
	}));

/** `--color-warn`, which is what the boards and the sign share. */
const AMBER = "rgb(231, 175, 54)";

// --- at rest --------------------------------------------------------------------------

const rest = await stage();
say("nothing is previewing to begin with", rest.previewing === "false", String(rest.previewing));
say("…no sign on the canvas", rest.sign === null);
say("…and no board is amber", rest.boards.every((board) => board.outline !== AMBER), JSON.stringify(rest.boards.map((board) => board.outline)));
/* Opened in edit mode, so the editing sign is up — which is the thing the preview has to
   stand down for a moment later. */
say("the editing sign is up, because this check opened in edit mode", rest.badge.includes("Editing") && rest.ring, `${rest.badge}`);

// --- previewing -----------------------------------------------------------------------

await feed({ type: "timeline.preview", agentId: focused, entryId: "entry-1", boards: {} });
await settle(page, 700);

const during = await stage();
say("a preview marks the canvas", during.previewing === "true", String(during.previewing));
say("…every board goes amber", during.boards.length > 0 && during.boards.every((board) => board.outline === AMBER), JSON.stringify(during.boards.map((board) => board.outline)));
/*
 * The colour and the deadness are one rule pair, so they are asserted together: a board that
 * looked amber and still took clicks would be a lie in the other direction.
 */
say("…and every frame stops taking the cursor", during.boards.every((board) => board.pointer === "none" || board.pointer === "unmounted"), JSON.stringify(during.boards.map((board) => board.pointer)));

say("the canvas says so, in words", /showing an earlier version/i.test(during.sign ?? ""), JSON.stringify(during.sign));
/*
 * And the editing sign stands down. While a preview is up nothing can be edited, so a ring
 * and the word "Editing" over a canvas of inert boards is the app claiming something untrue
 * — the mode itself is untouched and comes back below.
 */
say("…and the editing sign stands down, because nothing here can be edited", during.badge === "none" && !during.ring, `${during.badge}`);
say("…without leaving edit mode, which is a different fact", during.mode === "edit", String(during.mode));

/*
 * The assertion that would have caught the first attempt: the sign was placed at the
 * canvas's bottom-left corner, which is where the boards panel is, so its button was under
 * the panel and could not be pressed at all. A control nobody can reach is worse than no
 * control, because the state now looks answerable.
 */
const reachable = await page.evaluate(() => {
	const button = document.querySelector(".preview-sign button");
	if (!button) return { ok: false, why: "no button" };
	const box = button.getBoundingClientRect();
	const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
	return { ok: button.contains(hit) || hit === button, why: hit?.className ?? hit?.tagName ?? "nothing" };
});
say("the way out is actually reachable, not under a panel", reachable.ok, String(reachable.why));

// --- a board that arrives while it is up -----------------------------------------------

/*
 * The case that prompted all this: an agent draws a board *during* a preview. That board did
 * not exist at the point being previewed, so it is not in the revision map and renders its
 * current content — and it is still amber and still inert, which makes the thing the agent
 * just made the one thing on the canvas nobody can touch. Asserted as it stands, because it
 * is the behaviour, not because it is right.
 */
const parked = (context?.inPlay ?? []).slice(0, -1);
const all = context?.inPlay ?? [];
if (all.length > 1) {
	await feed({ type: "context.changed", agentId: focused, boards: context.boards, inPlay: parked });
	await settle(page, 600);
	await feed({ type: "context.changed", agentId: focused, boards: context.boards, inPlay: all });
	await settle(page, 900);
	const after = await stage();
	const late = after.boards.find((board) => board.path === all.at(-1));
	say("a board that arrives during a preview is amber too", late?.outline === AMBER, JSON.stringify(late));
	say("…and inert with the rest of them", late?.pointer === "none" || late?.pointer === "unmounted", JSON.stringify(late?.pointer));
} else {
	say("a board that arrives during a preview is amber too", true, "skipped: the canvas has one board");
	say("…and inert with the rest of them", true, "skipped: the canvas has one board");
}

// --- the two ways out -------------------------------------------------------------------

await page.locator(".preview-sign button").click();
await settle(page, 600);
const left = await stage();
say("pressing Leave ends the preview", left.previewing === "false" && left.sign === null, String(left.previewing));
say("…the boards come back", left.boards.every((board) => board.outline !== AMBER), JSON.stringify(left.boards.map((board) => board.outline)));
say("…and the editing sign returns, because the mode never changed", left.badge.includes("Editing") && left.ring, `${left.badge}`);

await feed({ type: "timeline.preview", agentId: focused, entryId: "entry-1", boards: {} });
await settle(page, 600);
say("a second preview marks it again", (await stage()).previewing === "true");

/*
 * Escape, read by the stage's own key handler rather than by a window listener — which is
 * what makes it work with focus inside a board as well, since `frame-gestures.ts` forwards a
 * board's keys to the same function.
 */
await page.keyboard.press("Escape");
await settle(page, 600);
say("Escape ends it too", (await stage()).previewing === "false");

// --- the one way in ---------------------------------------------------------------------

/*
 * Pointing at the handle used to start a preview, with no dwell delay, and pointing away
 * used to end it. That is how somebody ends up in this state without having asked for
 * anything — and a canvas that changes while a cursor crosses a transcript on its way
 * somewhere else is not a feature. There is one way in now and it is a press.
 *
 * The message is fed rather than sent: what is being checked is the handle on a message of
 * yours, and a real turn costs a model.
 */
await feed({ type: "chat.item", agentId: focused, item: { id: "u-preview", kind: "user", text: "Draw the risks board", at: Date.now() - 60000, entryId: "entry-1" } });
await settle(page, 400);
await page.evaluate(() => [...document.querySelectorAll(".pill button")].find((button) => /conversation/i.test(button.getAttribute("aria-label") ?? ""))?.click());
await settle(page, 700);

const handle = page.locator(".stream-rw").first();
await handle.hover();
await settle(page, 700);
const hovered = await page.evaluate(() => ({
	previewing: document.querySelector(".stage")?.dataset.previewing,
	asked: (window.__sent ?? []).filter((text) => text.includes("rewind.preview")).length,
}));
say("pointing at the handle previews nothing", hovered.previewing === "false", String(hovered.previewing));
say("…and asks the server for nothing", hovered.asked === 0, String(hovered.asked));

await handle.click();
await settle(page, 500);
const menu = await page.evaluate(() => [...document.querySelectorAll(".popover [data-row]")].map((row) => row.querySelector(".lb")?.textContent));
/*
 * Four rows, always. `Restore` used to appear only while a preview was up — which made sense
 * while hovering meant you were usually already previewing, and makes none now: a row that
 * is normally absent is a row nobody knows about.
 */
say("the menu is the four things you can do to a point", JSON.stringify(menu) === JSON.stringify(["Preview", "Rewind to here", "Fork from here", "Restore"]), JSON.stringify(menu));

await page.evaluate(() => [...document.querySelectorAll(".popover [data-row]")].find((row) => row.querySelector(".lb")?.textContent === "Preview")?.click());
await settle(page, 800);
say("pressing Preview is what starts one", (await stage()).previewing === "true");

/* And it outlives the pointer, which is the whole difference between a press and a hover. */
await page.mouse.move(900, 300);
await settle(page, 600);
say("…and it outlives the pointer leaving", (await stage()).previewing === "true");

await handle.click();
await settle(page, 500);
const open2 = await page.evaluate(() => [...document.querySelectorAll(".popover [data-row]")].map((row) => row.querySelector(".lb")?.textContent));
say("the row says how to undo itself", open2[0] === "Stop previewing", JSON.stringify(open2));
await page.evaluate(() => [...document.querySelectorAll(".popover [data-row]")].find((row) => /stop previewing/i.test(row.querySelector(".lb")?.textContent ?? ""))?.click());
await settle(page, 700);
say("…and does", (await stage()).previewing === "false");

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
