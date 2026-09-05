/**
 * Browse mode and edit mode — and the caret that is no longer in the column.
 *
 * Two changes from one request (`boards/方案②` and `方案③`), and they share a file because they
 * share a subject: what the app does when you have not asked it to do anything. It opens in
 * **browse**, where a board is a document — text selects, a game plays, nothing drags — and
 * a streaming reply grows quietly with `typing…` beside it rather than a block blinking at
 * the end of its text.
 *
 * The mode is the interesting half. `EditorHost.enabled()` is the whole switch, so the risk
 * is not that it half-works but that something *else* was relying on editing being on: the
 * inspector, the tools, file drops. Those are the assertions here.
 */
import { editMode, open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

const state = () =>
	page.evaluate(() => ({
		mode: document.querySelector(".stage")?.dataset.mode ?? null,
		badge: getComputedStyle(document.querySelector(".stage"), "::before").content,
		ring: getComputedStyle(document.querySelector(".stage"), "::after").boxShadow,
		tools: document.querySelectorAll(".float.pill .palette .iconbtn").length,
		inspector: document.querySelectorAll(".inspector").length,
		toggle: document.querySelector('[aria-label="Edit the boards"], [aria-label="Stop editing"]')?.getAttribute("aria-label") ?? null,
	}));

// --- browse is where a session starts -------------------------------------------------

const browse = await state();
/*
 * Browse by default, and not persisted: a mode that enables dragging and is remembered
 * across a reload is a mode you can be in without having chosen it this session. The failure
 * modes are not symmetrical — browsing when you meant to edit costs one press, editing when
 * you meant to browse means a component has moved and been written to disk.
 */
say("the canvas opens in browse mode", browse.mode === "browse", browse.mode);
say("…with no editing tools, because they insert components", browse.tools === 0, String(browse.tools));
say("…no inspector, because it is a properties panel", browse.inspector === 0);
say("…and nothing drawn to say editing is on", browse.badge === "none" && browse.ring === "none", `${browse.badge} / ${browse.ring}`);
say("the pencil offers to start editing", browse.toggle === "Edit the boards", browse.toggle);

// --- a board is a document -------------------------------------------------------------

/*
 * The point of browse mode: the frame still takes pointer events, so the board's own content
 * is live. Only the *editor* stands down. This is what makes a board that is a game playable
 * and a board that is prose copyable.
 */
await page.locator(".board-node .chrome").first().click();
await page.keyboard.press("1");
await settle(page, 900);

const selected = await page.evaluate(() => {
	const doc = document.querySelector(".board-node iframe")?.contentDocument;
	const element = doc?.querySelector("p, li, td");
	if (!doc || !element) return "no text on the board";
	const range = doc.createRange();
	range.selectNodeContents(element);
	doc.getSelection()?.removeAllRanges();
	doc.getSelection()?.addRange(range);
	return (doc.getSelection()?.toString() ?? "").trim().slice(0, 40);
});
say("text on a board can be selected while browsing", selected.length > 4 && selected !== "no text on the board", JSON.stringify(selected));

/* And a click reaches the board rather than selecting a component for the inspector. */
const clicked = await page.evaluate(() => {
	const frame = document.querySelector(".board-node iframe");
	const element = frame?.contentDocument?.querySelector("[data-id]");
	const box = element?.getBoundingClientRect();
	if (!frame || !box) return null;
	const outer = frame.getBoundingClientRect();
	return { x: outer.x + box.x + box.width / 2, y: outer.y + box.y + 10 };
});
if (clicked) {
	await page.mouse.click(clicked.x, clicked.y);
	await settle(page, 500);
}
const afterClick = await page.evaluate(() => ({
	editing: document.querySelector(".board-node iframe")?.contentDocument?.querySelectorAll(".decks-editing").length ?? 0,
	inspector: document.querySelectorAll(".inspector").length,
}));
say("a click while browsing selects no component", afterClick.editing === 0 && afterClick.inspector === 0, JSON.stringify(afterClick));

// --- the pencil ------------------------------------------------------------------------

await editMode(page);
const editing = await state();
say("the pencil turns editing on", editing.mode === "edit", editing.mode);
say("…the five tools come with it", editing.tools === 5, String(editing.tools));
/*
 * The indication is what stands in for a confirmation dialog: one press is right for
 * something this reversible, so what stops an accident is that editing *looks* different for
 * as long as it lasts. A question asked every time is a question dismissed without reading.
 */
say("…and the canvas says so, in a ring and a word", editing.badge.includes("Editing") && editing.ring !== "none", `${editing.badge}`);
say("…and the button now offers to stop", editing.toggle === "Stop editing", editing.toggle);

if (clicked) {
	await page.mouse.click(clicked.x, clicked.y);
	await settle(page, 600);
}
const nowClicked = await page.evaluate(() => ({
	editing: document.querySelector(".board-node iframe")?.contentDocument?.querySelectorAll(".decks-editing").length ?? 0,
	inspector: document.querySelectorAll(".inspector").length,
}));
say("a click while editing selects a component", nowClicked.editing === 1, JSON.stringify(nowClicked));
say("…and the inspector arrives with it", nowClicked.inspector === 1);

await editMode(page, false);
const back = await state();
say("and pressing it again puts everything back", back.mode === "browse" && back.tools === 0 && back.badge === "none", JSON.stringify(back));
say("…including dropping the selection's inspector", back.inspector === 0);

// --- the column has no caret ------------------------------------------------------------

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2500);

await feed({
	type: "agents",
	defaultKind: "pi",
	focused: "A",
	chats: [{ id: "A", name: "Ada", kind: "claude", state: "streaming", lastAt: Date.now(), unread: 0, contextCount: 0, capabilities: { modes: [] }, commands: [] }],
});
await feed({ type: "chat.item", agentId: "A", item: { id: "u1", kind: "user", text: "Say something", at: Date.now() - 4000 } });
await feed({ type: "chat.item", agentId: "A", item: { id: "a1", kind: "assistant", text: "", at: Date.now(), streaming: true } });
await settle(page, 400);
await page.evaluate(() => {
	const button = [...document.querySelectorAll(".pill button")].find((candidate) => /conversation/i.test(candidate.getAttribute("aria-label") ?? ""));
	button?.click();
});
await settle(page, 600);
for (const chunk of ["The reply ", "arrives a few ", "words at a time."]) {
	await feed({ type: "chat.delta", agentId: "A", itemId: "a1", delta: chunk });
	await settle(page, 160);
}
await settle(page, 400);

const column = await page.evaluate(() => ({
	carets: document.querySelectorAll(".caret").length,
	blinking: [...document.querySelectorAll(".stream *")].filter((el) => (getComputedStyle(el).animationName || "").includes("blink")).length,
	sign: document.querySelector(".stream-working")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
	text: document.querySelector(".stream-card:last-of-type")?.innerText?.trim().slice(-24) ?? null,
}));
/*
 * The caret was a block blinking at the end of a streaming reply. A good deal of care had
 * gone into where it sat — sized in `em` so it landed on the text's ink — and none of that
 * was the complaint: it was there at all, appearing and vanishing twice a second at the one
 * place the eye was already resting.
 */
say("a streaming reply has no caret", column.carets === 0, String(column.carets));
say("…and nothing in the column blinks", column.blinking === 0, String(column.blinking));
/*
 * The sign used to stand down mid-reply, because the caret was carrying "still going" in the
 * place the words were arriving. With no caret there was nothing carrying it at all, so it
 * stays up for the whole reply — see `signPlacement`.
 */
say("the indicator says typing… throughout", /typing/i.test(column.sign ?? ""), JSON.stringify(column.sign));
say("…while the text grows quietly behind it", column.text?.includes("at a time."), JSON.stringify(column.text));

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
