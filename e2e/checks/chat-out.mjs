/**
 * The conversation is taken out of the side panel as a float over the canvas, and put back
 * (`app/chat-float.ts`, `shell/ChatSection.tsx`).
 *
 * What is checked, on a desktop: a press on the docked head that does not move still folds the
 * conversation; a drag of the head takes the conversation out of the panel under the pointer, with
 * the panel showing where it would land while the pointer is still over it; let go over the canvas
 * it stays there as a float, with the list taking the whole panel; it shows with the panel folded,
 * and is where it was after a reload; its corner sizes it from its top left; dragged back over the
 * panel and let go it is in the panel again; each head's button does the same, the float going
 * home under the top-right bar; and a drag never folds it. `LOOK_SHOTS=<dir>` keeps pictures.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { open, resetStage, say, settle } from "../harness.mjs";

const OUT = process.env.LOOK_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await page.waitForSelector(".panel-shell .v3-chat .v3-chat-head");
await settle(page, 400);

const look = () =>
	page.evaluate(() => {
		const box = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) };
		};
		const float = document.querySelector('.v3-chat[data-float="true"]');
		const docked = document.querySelector(".panel-shell .v3-chat");
		const shell = document.querySelector(".panel-shell");
		const work = document.querySelector(".work");
		return {
			float: box(float),
			floatHead: box(float?.querySelector(".v3-chat-head")),
			floating: float?.getAttribute("data-floating") ?? null,
			docked: box(docked),
			dockedHead: box(docked?.querySelector(".v3-chat-head")),
			folded: (float ?? docked)?.getAttribute("data-folded") === "true",
			landing: shell?.getAttribute("data-chat-drop") === "true",
			panel: box(shell),
			panelOpen: shell?.getAttribute("data-open") !== "false",
			work: box(work),
			list: box(document.querySelector(".panel-shell .panel-list")),
			stream: !!(float ?? docked)?.querySelector(".stream"),
			out: localStorage.getItem("decks.chatOut"),
		};
	});
const inside = (box, x, y) => !!box && x >= box.x && x <= box.r && y >= box.y && y <= box.b;
const drag = async (from, to, { steps = 12, hold } = {}) => {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
		if (hold && i === hold.at) await hold.then();
	}
	// A pause before letting go: a placement, not a throw.
	await settle(page, 150);
	await page.mouse.move(to.x, to.y);
	await settle(page, 150);
	await page.mouse.up();
	await settle(page, 500);
};

const start = await look();
say("the conversation starts in the side panel", !!start.docked && !start.float && start.out !== "1", JSON.stringify({ docked: start.docked, float: start.float }));
const listBefore = start.list;

// --- a press that does not move is still a click on the title -----------------------------------
const grip = { x: start.dockedHead.x + 60, y: start.dockedHead.y + 22 };
await page.mouse.click(grip.x, grip.y);
await settle(page, 400);
say("a press on the head that does not move folds the conversation, as before", (await look()).folded === true && !(await look()).float);
const foldedHead = (await look()).dockedHead;
await page.mouse.click(foldedHead.x + 60, foldedHead.y + 22);
await settle(page, 400);
say("…and another opens it again", (await look()).folded === false);

// --- dragged out of the panel -------------------------------------------------------------------
const head = (await look()).dockedHead;
const from = { x: head.x + 60, y: head.y + 22 };
const drop = { x: 820, y: 260 };
let lifted;
await drag(from, drop, {
	steps: 20,
	hold: {
		// One step in: 38px moved, still over the panel.
		at: 1,
		then: async () => {
			lifted = { at: await look(), pointer: { x: from.x + (drop.x - from.x) / 20, y: from.y + (drop.y - from.y) / 20 } };
			if (OUT) await page.screenshot({ path: join(OUT, "1-lifted-over-the-panel.png") });
		},
	},
});
say("a drag of the head takes it out of the panel at once, as a float under the pointer", !!lifted?.at.float && !lifted.at.docked && inside(lifted.at.floatHead, lifted.pointer.x, lifted.pointer.y), JSON.stringify({ head: lifted?.at.floatHead, pointer: lifted?.pointer }));
say("…and while it is held over the panel, the panel shows where it would land", lifted?.at.landing === true);
const out = await look();
say("let go over the canvas it stays there, its head where the pointer let go", !!out.float && !out.docked && out.floating === "true" && inside(out.floatHead, drop.x, drop.y) && out.out === "1", JSON.stringify({ head: out.floatHead, drop }));
say("…clear of the side panel, with its landing no longer shown", out.float.x >= out.panel.r && out.landing === false, JSON.stringify({ float: out.float, panel: out.panel }));
say("…unfolded, with the conversation in it", out.folded === false && out.stream);
say("…and the list has the whole panel", out.list.h > listBefore.h + 100, `${listBefore.h} → ${out.list.h}`);
if (OUT) await page.screenshot({ path: join(OUT, "2-out-over-the-canvas.png") });

// --- it shows with the panel folded, and after a reload -------------------------------------------
await page.keyboard.press("Meta+Backslash");
await settle(page, 600);
const shut = await look();
say("with the side panel folded the float is still there", !!shut.float && shut.float.w > 200, JSON.stringify({ float: shut.float, panelOpen: shut.panelOpen }));
if (OUT) await page.screenshot({ path: join(OUT, "3-panel-folded.png") });
await page.keyboard.press("Meta+Backslash");
await settle(page, 600);
const before = await look();
// The harness empties the page's storage at every load: what this device kept is put back after it, as a real reload would find it.
const kept = await page.evaluate(() => Object.fromEntries(["decks.chatOut", "decks.floats", "decks.chatFloatSize"].map((key) => [key, localStorage.getItem(key)])));
await page.addInitScript((was) => {
	if (window.top !== window.self || sessionStorage.getItem("chat-out-restored")) return;
	sessionStorage.setItem("chat-out-restored", "1");
	for (const [key, value] of Object.entries(was)) if (value !== null) localStorage.setItem(key, value);
}, kept);
await page.reload({ waitUntil: "load" });
await page.waitForSelector('.v3-chat[data-float="true"]');
await settle(page, 800);
const after = await look();
say("after a reload it is out, where it was", !!after.float && Math.abs(after.float.x - before.float.x) <= 2 && Math.abs(after.float.y - before.float.y) <= 2, JSON.stringify({ before: before.float, after: after.float }));

// --- its corner sizes it ------------------------------------------------------------------------
const sizeFrom = { x: after.float.r - 6, y: after.float.b - 6 };
await drag(sizeFrom, { x: sizeFrom.x + 90, y: sizeFrom.y + 70 });
const sized = await look();
say("its corner dragged sizes it, the top left staying put", sized.float.w === after.float.w + 90 && sized.float.h === after.float.h + 70 && sized.float.x === after.float.x && sized.float.y === after.float.y, JSON.stringify({ before: after.float, after: sized.float }));

// --- a drag of the float never folds it, and its title pressed does -------------------------------
const fh = sized.floatHead;
await drag({ x: fh.x + 60, y: fh.y + 22 }, { x: fh.x + 60 - 120, y: fh.y + 22 - 100 });
const moved = await look();
say("the float's head dragged moves it and does not fold it", moved.folded === false && Math.abs(moved.float.x - (sized.float.x - 120)) <= 2 && Math.abs(moved.float.y - (sized.float.y - 100)) <= 2 && moved.float.w === sized.float.w, JSON.stringify({ before: sized.float, after: moved.float }));
await page.mouse.click(moved.floatHead.x + 60, moved.floatHead.y + 22);
await settle(page, 300);
const small = await look();
say("its title pressed folds it to its head", small.folded === true && small.float.h === 44 && small.float.w === moved.float.w, JSON.stringify(small.float));
if (OUT) await page.screenshot({ path: join(OUT, "4-float-folded.png") });
await page.mouse.click(small.floatHead.x + 60, small.floatHead.y + 22);
await settle(page, 300);

// --- dragged back over the panel ------------------------------------------------------------------
const back = await look();
let held;
await drag({ x: back.floatHead.x + 60, y: back.floatHead.y + 22 }, { x: 140, y: 620 }, {
	steps: 16,
	hold: {
		at: 16,
		then: async () => {
			held = await look();
			if (OUT) await page.screenshot({ path: join(OUT, "5-held-over-the-panel.png") });
		},
	},
});
say("held over the side panel, the float is over it and the panel shows the landing", held?.landing === true && held.float.x < held.panel.r, JSON.stringify({ float: held?.float, panel: held?.panel }));
const docked = await look();
say("let go there it is in the panel again, open", !!docked.docked && !docked.float && docked.folded === false && docked.landing === false && docked.out === "0", JSON.stringify({ docked: docked.docked, float: docked.float }));
say("…and the list gives the room back", Math.abs(docked.list.h - listBefore.h) <= 2, `${listBefore.h} → ${docked.list.h}`);

// --- the buttons ----------------------------------------------------------------------------------
// Its place is forgotten for this one, so the button's float is seen at home.
await page.evaluate(() => {
	const kept = JSON.parse(localStorage.getItem("decks.floats") ?? "{}");
	delete kept.conversation;
	localStorage.setItem("decks.floats", JSON.stringify(kept));
});
await page.locator('.panel-shell .v3-chat [aria-label="Take the conversation out of the side panel"]').click();
await settle(page, 500);
const home = await look();
say("the docked head's button takes it out, to its home under the top-right bar", !!home.float && !home.docked && home.float.y === 64 && home.float.r === home.work.r - 12, JSON.stringify({ float: home.float, work: home.work }));
if (OUT) await page.screenshot({ path: join(OUT, "6-at-home.png") });
await page.locator('.v3-chat[data-float="true"] [aria-label="Put the conversation back in the side panel"]').click();
await settle(page, 500);
const end = await look();
say("the float's button puts it back", !!end.docked && !end.float && end.out === "0");

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
