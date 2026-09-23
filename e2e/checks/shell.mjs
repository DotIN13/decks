/**
 * The shell around the stage: one screen, and the floats on it.
 *
 * There is one screen in the app now — the focused agent's stage — so what used to be a
 * dashboard, a slide between the two and a hash that said which is gone, and what is left to
 * prove with a browser is what floats over the stage:
 *
 * - the app opens at the plain web root, on the stage, and writes nothing into the address;
 * - the left panel's board rows are drawn from pictures the server took, with no document mounted;
 * - the composer's recipient chip opens the agent list, and `@` completes a name into the line;
 * - the composer, dragged off its home, is where it was dropped after a reload;
 * - thrown hard at the right edge it is put away behind a tab, and the tab brings it back.
 *
 * The panel's width handle is `panel.mjs`'s, and switching agent is `per-agent.mjs`'s.
 */
import { open, say, settle, socket } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await settle(page, 600);
const LINK = await socket();

let agentName = "";
for (let i = 0; i < 30 && !agentName; i++) {
	const agents = LINK.last("agents");
	agentName = agents?.chats?.find((chat) => chat.id === agents.focused)?.name ?? "";
	if (!agentName) await settle(page, 200);
}
if (!agentName) throw new Error("the fixture deck has no agent to address");

const hash = () => page.evaluate(() => location.hash);
say("the app opens on the stage, at the plain root, and writes nothing into the address", (await hash()) === "" && (await page.getAttribute(".surface", "data-surface")) === "stage", `${JSON.stringify(await hash())} ${await page.getAttribute(".surface", "data-surface")}`);
/* The pill kept its tools and lost the three things that were about other places: Home, the dashboard's tabs and the canvas's name. */
const pill = await page.evaluate(() => ({
	home: document.querySelectorAll(".pill-home").length,
	canvas: document.querySelectorAll(".pill-canvas, .canvas-menu").length,
	tabs: document.querySelectorAll('.pill [role="tab"]').length,
	boards: document.querySelectorAll('.pill button[aria-label$="the boards panel"]').length,
}));
say("the top-left pill has the boards panel's button, and no Home, dashboard tabs or canvas name", pill.home === 0 && pill.canvas === 0 && pill.tabs === 0 && pill.boards === 1, JSON.stringify(pill));

/*
 * The left panel's board rows draw pictures the server took (`boards/thumbs.ts`), of boards
 * this browser may never have had open: there is no second way to picture a board, and no
 * board is mounted as a document to make one. 720 real pixels wide, and asked for by revision
 * so it can be cached for a year.
 */
{
	const boardsTab = page.locator('.panel-shell [role="tab"]', { hasText: "Boards" });
	if ((await page.evaluate(() => document.querySelector(".panel-shell")?.dataset.open)) !== "true") {
		await page.locator('.pill button[aria-label$="the boards panel"]').first().click();
		await settle(page, 400);
	}
	await boardsTab.click();
	await settle(page, 400);
	const ready = await page
		.waitForFunction(
			() => {
				const pictures = [...document.querySelectorAll(".board-thumb .board-picture")];
				return pictures.length > 0 && pictures.every((one) => one.dataset.state === "ready");
			},
			undefined,
			{ timeout: 30000 },
		)
		.then(() => true)
		.catch(() => false);
	const rows = await page.evaluate(() => ({
		rows: document.querySelectorAll(".board-row").length,
		ready: document.querySelectorAll('.board-thumb .board-picture[data-state="ready"]').length,
		pictures: [...document.querySelectorAll(".board-thumb img")].map((one) => ({ w: one.naturalWidth, src: one.getAttribute("src") ?? "" })),
		frames: document.querySelectorAll(".panel-shell iframe").length,
	}));
	say("the left panel's rows draw the server's pictures, with no document mounted", ready && rows.rows > 0 && rows.ready === rows.rows && rows.pictures.every((one) => one.src.startsWith("/api/thumb/")) && rows.frames === 0, JSON.stringify({ ...rows, pictures: rows.pictures.length }));
	say("…720 pixels wide, asked for by revision and scheme", rows.pictures.length > 0 && rows.pictures.every((one) => one.w === 720 && /\/api\/thumb\/.+\?v=\d+&scheme=(light|dark)$/.test(one.src)), JSON.stringify(rows.pictures.slice(0, 3)));
	const again = await page.evaluate(async (src) => {
		const started = performance.now();
		const answer = await fetch(src, { cache: "no-store" });
		return { status: answer.status, type: answer.headers.get("content-type"), cache: answer.headers.get("cache-control"), ms: Math.round(performance.now() - started) };
	}, rows.pictures[0]?.src);
	say("…and a second ask is answered from the disk, cacheable for a year", again.status === 200 && again.type === "image/jpeg" && /immutable/.test(again.cache ?? "") && again.ms < 300, JSON.stringify(again));
}

/*
 * The word is a chip, and the chip is the control: it opens the pill's agent list with New
 * agent at the foot, and nothing else — there is no dispatcher to hand a line to any more.
 * Picking a row there goes to that agent's stage, which `per-agent.mjs` drives. Typing `@`
 * opens the same rows as a completion under the caret, and a completed name sends that line
 * to the named agent without moving you.
 */
say("the bar's word is the focused agent's", ((await page.locator(".dock-to").getAttribute("data-dest")) ?? "").startsWith(`to ${agentName}`), await page.locator(".dock-to").getAttribute("data-dest"));
await page.locator(".dock-to-chip").click();
await page.waitForSelector(".popover [data-row]", { timeout: 4000 });
const chipMenu = await page.evaluate(() => ({
	agents: [...document.querySelectorAll(".popover [data-row][data-agent]")].map((row) => row.querySelector(".row-label")?.textContent?.trim()),
	current: document.querySelector('.popover [data-row][data-agent][data-current="true"] .row-label')?.textContent?.trim(),
	dispatcher: document.querySelectorAll(".popover .dock-to-dispatcher").length,
	fresh: [...document.querySelectorAll(".popover [data-row]")].some((row) => row.textContent?.includes("New agent")),
}));
say("the chip opens the agent list, the focused agent marked, New agent at the foot and no dispatcher", chipMenu.agents.length >= 1 && chipMenu.current === agentName && chipMenu.fresh && chipMenu.dispatcher === 0, JSON.stringify(chipMenu));
await page.keyboard.press("Escape");
await settle(page, 300);

await page.locator(".dockfield").click();
await page.keyboard.type(`look at this @${agentName.slice(0, 2)}`);
await page.waitForSelector(".mention-menu [data-row]", { timeout: 4000 });
const completion = await page.evaluate(() => [...document.querySelectorAll(".mention-menu [data-row] .row-label")].map((lb) => lb.textContent?.trim()));
say("@ and two letters open the completion, narrowed to the names that start so", completion.length >= 1 && completion.every((name) => name.toLowerCase().startsWith(agentName.slice(0, 2).toLowerCase())), JSON.stringify(completion));
/* No row says where the agent is any more: "here", "elsewhere" and "as a task" were about canvases and the dispatcher. */
const notes = await page.evaluate(() => (document.querySelector(".mention-menu")?.textContent ?? "").toLowerCase());
say("…and no row says here, elsewhere or as a task", !/\bhere\b|elsewhere|as a task/.test(notes), JSON.stringify(notes));
/* The first row is the one Enter takes; it is the focused agent when its name is the only one starting so. */
const firstName = completion[0] ?? agentName;
await page.keyboard.press("Enter");
await settle(page, 300);
const completed = await page.evaluate(() => ({ text: document.querySelector(".dockfield")?.textContent, menu: document.querySelectorAll(".mention-menu").length, dest: document.querySelector(".dock-to")?.getAttribute("data-dest") }));
say("Enter completes the name into the line, and the chip follows the words", completed.text === `look at this @${firstName} ` && completed.menu === 0 && completed.dest?.startsWith(`to ${firstName}`), JSON.stringify(completed));
await page.fill(".dockfield", "");
await settle(page, 200);

// The composer, dragged off its home, and still there after a reload.
const box = await page.locator(".composer-box").boundingBox();
await page.mouse.move(box.x + 16, box.y + 6);
await page.mouse.down();
await page.mouse.move(box.x - 300, box.y - 260, { steps: 12 });
await page.mouse.up();
// A release with velocity is a throw, and the glide after it can take up to 420ms.
await settle(page, 700);
const dropped = await page.evaluate(() => document.querySelector(".dock")?.getBoundingClientRect().left);
say("the composer floats where it is dropped", (await page.getAttribute(".dock", "data-floating")) === "true", `left ${dropped}`);
const saved = await page.evaluate(() => localStorage.getItem("decks.floats") ?? "");
say("the drop is written to storage as a share of the column", /"composer":\{"fx":[0-9.]+,"fy":[0-9.]+\}/.test(saved), saved);
// The harness wipes storage on every load, so the saved value is put back by an init
// script of this check's own: what is tested across the reload is the restore.
await page.addInitScript((value) => {
	try {
		localStorage.setItem("decks.floats", value);
	} catch {
		/* no storage */
	}
}, saved);
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".surface");
await settle(page, 1500);
const after = await page.evaluate(() => document.querySelector(".dock")?.getBoundingClientRect().left);
say("a reload puts the composer back where it was dropped", (await page.getAttribute(".dock", "data-floating")) === "true" && Math.abs((after ?? 0) - (dropped ?? -1)) < 2, `${dropped} -> ${after}`);
await page.dblclick(".dock-grip");
await settle(page, 700);
say("a double-click on the grip sends it home", (await page.getAttribute(".dock", "data-floating")) === null);

/*
 * Thrown hard at the right edge, the bar is put away and leaves a tab; the tab brings it
 * back. Five moves of 60px with no pause between them is a throw: the velocity at release
 * is what decides, and a drag that pauses before letting go parks against the edge instead.
 */
const grip = await page.locator(".dock-grip").boundingBox();
await page.mouse.move(grip.x + grip.width / 2, grip.y + 2);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(grip.x + grip.width / 2 + i * 60, grip.y + 2);
await page.mouse.up();
await settle(page, 800);
const away = await page.evaluate(() => {
	const dock = document.querySelector(".dock");
	const tab = dock?.querySelector(".dock-stowtab")?.getBoundingClientRect();
	return { stowed: dock?.hasAttribute("data-stowed") ?? false, left: dock?.getBoundingClientRect().left ?? 0, tabRight: tab?.right ?? 0, inert: Boolean(dock?.querySelector(".composer-box")?.closest("[inert]")), width: window.innerWidth };
});
say("a hard throw at the right edge puts the composer away", away.stowed && away.left > away.width - 60, JSON.stringify(away));
say("what is left on screen is its tab, against the edge, and the box is out of reach", Math.abs(away.tabRight - away.width) < 2 && away.inert, JSON.stringify(away));
await page.click(".dock-stowtab");
await settle(page, 900);
say("the tab brings it back to where it was", (await page.getAttribute(".dock", "data-stowed")) === null && (await page.getAttribute(".dock", "data-floating")) === null);

LINK.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
