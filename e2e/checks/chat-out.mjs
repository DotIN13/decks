/**
 * The conversation is taken out of the side panel as a float over the canvas, and put back, by its
 * grip (`app/chat-float.ts`, `shell/ChatSection.tsx`).
 *
 * What is checked, on a desktop: the head has a grip and no button for this; a drag of the grip
 * takes the conversation out of the panel under the pointer, leaving a slot in the panel that is
 * exactly the box the conversation had, the list beside it unmoved; let go over the canvas it stays
 * there as a float, with the list taking the whole panel; it is a float as the composer is: thrown,
 * it glides on past where it was let go, a hard throw at the right edge puts it away behind its tab
 * and the tab brings it back, and it follows the side panel as that folds; it is where it was after
 * a reload; its corner sizes it from its top left; its title still folds it and a drag does not;
 * held over the panel the slot shows again, the same box, and let go there it is in the panel
 * again; and a double-click on the grip sends it home too. `LOOK_SHOTS=<dir>` keeps pictures.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { open, resetStage, say, settle } from "../harness.mjs";

const OUT = process.env.LOOK_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await page.waitForSelector(".panel-shell .v3-chat .v3-chat-grip");
await settle(page, 400);

const look = () =>
	page.evaluate(() => {
		const box = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
		};
		const float = document.querySelector('.v3-chat[data-float="true"]');
		const docked = document.querySelector(".panel-shell .v3-chat:not(.v3-chat-slot)");
		const shell = document.querySelector(".panel-shell");
		const at = float ?? docked;
		return {
			float: box(float),
			floating: float?.getAttribute("data-floating") ?? null,
			snapping: float?.getAttribute("data-snapping") === "true",
			glides: float ? getComputedStyle(float).transitionProperty : "",
			stowed: float?.getAttribute("data-stowed") ?? null,
			tab: box(float?.querySelector(":scope > .stowtab")),
			docked: box(docked),
			grip: box(at?.querySelector(".v3-chat-grip")),
			title: box(at?.querySelector(".v3-chat-title")),
			buttons: [...(at?.querySelectorAll(".v3-chat-head button") ?? [])].map((one) => one.getAttribute("aria-label") ?? one.textContent.trim()),
			folded: at?.getAttribute("data-folded") === "true",
			slot: box(document.querySelector(".panel-shell .v3-chat-slot")),
			panel: box(shell),
			panelOpen: shell?.getAttribute("data-open") !== "false",
			work: box(document.querySelector(".work")),
			list: box(document.querySelector(".panel-shell .panel-list")),
			stream: !!at?.querySelector(".stream"),
			out: localStorage.getItem("decks.chatOut"),
		};
	});
const inside = (box, x, y) => !!box && x >= box.x - 24 && x <= box.r + 24 && y >= box.y - 6 && y <= box.b + 10;
const same = (a, b, by = 1) => !!a && !!b && Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by && Math.abs(a.w - b.w) <= by && Math.abs(a.h - b.h) <= by;
/** A drag that pauses before letting go: a placement, not a throw. */
const drag = async (from, to, { steps = 12, hold } = {}) => {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
		if (hold && i === hold.at) await hold.then();
	}
	await settle(page, 150);
	await page.mouse.move(to.x, to.y);
	await settle(page, 150);
	await page.mouse.up();
	await settle(page, 600);
};
const gripOf = async () => {
	const { grip } = await look();
	return { x: grip.cx, y: grip.cy };
};

const start = await look();
if (OUT) await page.screenshot({ path: join(OUT, "0-in-the-panel.png"), clip: { x: 0, y: 300, width: 520, height: 600 } });
say("the conversation starts in the side panel", !!start.docked && !start.float && start.out !== "1", JSON.stringify({ docked: start.docked, float: start.float }));
say("its head has a grip, and no button for taking it out", !!start.grip && start.grip.w === 36 && !start.buttons.some((one) => /side panel|out of/i.test(one ?? "")), JSON.stringify({ grip: start.grip, buttons: start.buttons }));
const home = start.docked;
const listBefore = start.list;

// --- its title still folds it -----------------------------------------------------------------
await page.mouse.click(start.title.cx, start.title.cy);
await settle(page, 400);
say("its title pressed folds the conversation, as before", (await look()).folded === true && !(await look()).float);
await page.mouse.click((await look()).title.cx, (await look()).title.cy);
await settle(page, 400);
say("…and pressed again opens it", (await look()).folded === false && same((await look()).docked, home), JSON.stringify((await look()).docked));

// --- dragged out of the panel by its grip -----------------------------------------------------
const from = await gripOf();
const drop = { x: 820, y: 240 };
let lifted;
await drag(from, drop, {
	steps: 20,
	hold: {
		// One step in: still over the panel.
		at: 1,
		then: async () => {
			lifted = { at: await look(), pointer: { x: from.x + (drop.x - from.x) / 20, y: from.y + (drop.y - from.y) / 20 } };
			if (OUT) await page.screenshot({ path: join(OUT, "1-lifted-over-the-panel.png") });
		},
	},
});
say("a drag of the grip takes it out of the panel at once, as a float with its grip under the pointer", !!lifted?.at.float && !lifted.at.docked && inside(lifted.at.grip, lifted.pointer.x, lifted.pointer.y), JSON.stringify({ grip: lifted?.at.grip, pointer: lifted?.pointer }));
say("…leaving a slot in the panel that is exactly the box the conversation had", same(lifted?.at.slot, home), JSON.stringify({ slot: lifted?.at.slot, had: home }));
say("…with the list beside it unmoved", same(lifted?.at.list, listBefore), JSON.stringify({ list: lifted?.at.list, was: listBefore }));
const out = await look();
say("let go over the canvas it stays there, its grip where the pointer let go", !!out.float && !out.docked && out.floating === "true" && inside(out.grip, drop.x, drop.y) && out.out === "1", JSON.stringify({ grip: out.grip, drop }));
say("…clear of the side panel, the slot gone", out.float.x >= out.panel.r && !out.slot, JSON.stringify({ float: out.float, panel: out.panel, slot: out.slot }));
say("…unfolded, with the conversation in it, and the list has the whole panel", out.folded === false && out.stream && out.list.h > listBefore.h + 100, `${listBefore.h} → ${out.list.h}`);
if (OUT) await page.screenshot({ path: join(OUT, "2-out-over-the-canvas.png") });

// --- a float as the composer is: thrown, it glides on -----------------------------------------
{
	const grip = await gripOf();
	await page.mouse.move(grip.x, grip.y);
	await page.mouse.down();
	// Upwards, quickly, and let go while still moving: no edge to be put away behind that way.
	for (let i = 1; i <= 4; i++) await page.mouse.move(grip.x + i * 2, grip.y - i * 15);
	await page.mouse.up();
	const letGo = await look();
	await settle(page, 900);
	const rest = await look();
	say("thrown, it glides on past where it was let go, by the float system's own transition", letGo.snapping && /top/.test(letGo.glides) && rest.float.y < out.float.y - 60 - 20 && rest.stowed === null && !rest.snapping, JSON.stringify({ letGoAt: out.float.y - 60, snapping: letGo.snapping, glides: letGo.glides, rest: rest.float.y }));
}

// --- thrown hard at the right edge it is put away behind its tab -------------------------------
{
	const before = await look();
	const grip = await gripOf();
	await page.mouse.move(grip.x, grip.y);
	await page.mouse.down();
	for (let i = 1; i <= 5; i++) await page.mouse.move(grip.x + i * 110, grip.y);
	await page.mouse.up();
	await settle(page, 900);
	const away = await look();
	say("a hard throw at the right edge puts it away, only its tab left, against the edge", away.stowed === "right" && !!away.tab && Math.abs(away.tab.r - away.work.r) <= 2 && away.float.x > away.work.r - 60, JSON.stringify({ stowed: away.stowed, tab: away.tab, float: away.float }));
	if (OUT) await page.screenshot({ path: join(OUT, "3-put-away.png") });
	await page.click('.v3-chat[data-float="true"] > .stowtab');
	await settle(page, 900);
	const again = await look();
	say("its tab brings it back to where it was", again.stowed === null && same(again.float, before.float, 2), JSON.stringify({ before: before.float, again: again.float }));
}

// --- it follows the side panel, and is there with the panel folded ------------------------------
const opened = await look();
await page.keyboard.press("Meta+Backslash");
await settle(page, 700);
const shut = await look();
say("with the side panel folded the float is still there, moved with the canvas's column as the composer is", !!shut.float && shut.float.w === opened.float.w && shut.float.x < opened.float.x, JSON.stringify({ open: opened.float, shut: shut.float }));
if (OUT) await page.screenshot({ path: join(OUT, "4-panel-folded.png") });
await page.keyboard.press("Meta+Backslash");
await settle(page, 700);
const before = await look();
say("…and back where it was when the panel opens again", same(before.float, opened.float, 2), JSON.stringify({ was: opened.float, now: before.float }));

// --- after a reload -----------------------------------------------------------------------------
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
say("after a reload it is out, where it was", !!after.float && same(after.float, before.float, 2), JSON.stringify({ before: before.float, after: after.float }));

// --- its corner sizes it ------------------------------------------------------------------------
const sizeFrom = { x: after.float.r - 6, y: after.float.b - 6 };
await drag(sizeFrom, { x: sizeFrom.x + 60, y: sizeFrom.y + 50 });
const sized = await look();
say("its corner dragged sizes it, the top left staying put", sized.float.w === after.float.w + 60 && sized.float.h === after.float.h + 50 && sized.float.x === after.float.x && sized.float.y === after.float.y, JSON.stringify({ before: after.float, after: sized.float }));

// --- its title folds it; a drag of the grip does not ---------------------------------------------
{
	const grip = await gripOf();
	await drag(grip, { x: grip.x + 60, y: grip.y + 60 });
	const moved = await look();
	say("its grip dragged moves it and does not fold it", moved.folded === false && Math.abs(moved.float.x - (sized.float.x + 60)) <= 2 && Math.abs(moved.float.y - (sized.float.y + 60)) <= 2, JSON.stringify({ before: sized.float, after: moved.float }));
	await page.mouse.click(moved.title.cx, moved.title.cy);
	await settle(page, 300);
	const small = await look();
	say("its title pressed folds it to its head", small.folded === true && small.float.h === 44 && small.float.w === moved.float.w, JSON.stringify(small.float));
	if (OUT) await page.screenshot({ path: join(OUT, "5-float-folded.png") });
	await page.mouse.click(small.title.cx, small.title.cy);
	await settle(page, 300);
}

// --- dragged back over the panel ------------------------------------------------------------------
let held;
await drag(await gripOf(), { x: 180, y: 520 }, {
	steps: 16,
	hold: {
		at: 16,
		then: async () => {
			held = await look();
			if (OUT) await page.screenshot({ path: join(OUT, "6-held-over-the-panel.png") });
		},
	},
});
say("held over the side panel, the float is over it and the panel shows the slot, the box the conversation had", !!held?.slot && same(held.slot, home) && held.float.x < held.panel.r, JSON.stringify({ slot: held?.slot, had: home, float: held?.float }));
const docked = await look();
say("let go there it is in the panel again, in that box, open", same(docked.docked, home) && !docked.float && !docked.slot && docked.folded === false && docked.out === "0", JSON.stringify({ docked: docked.docked, had: home }));
say("…and the list is as it was", same(docked.list, listBefore), JSON.stringify({ list: docked.list, was: listBefore }));

// --- a double-click on the grip sends it home ------------------------------------------------------
await drag(await gripOf(), { x: 900, y: 300 });
say("taken out again", !!(await look()).float);
const g = await gripOf();
await page.mouse.dblclick(g.x, g.y);
await settle(page, 600);
const end = await look();
say("a double-click on its grip sends it home, to the panel", same(end.docked, home) && !end.float && end.out === "0", JSON.stringify({ docked: end.docked, float: end.float }));

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
