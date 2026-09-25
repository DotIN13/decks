/**
 * The stage manager: what stages there are, and moving between them.
 *
 * A stage is a folder of work — `stages/<name>/stage.pen`, its boards and its drawing — and
 * until this the browser was never told any existed. An agent could already list them and open
 * one (`stage.stages`, `stage.open`); the person had no surface at all, so two stages looked
 * like one canvas that had changed.
 *
 * What is checked here is the whole of the person's half: the pill names the stage, the button
 * opens a panel of every stage, the field narrows it without shortening it, and a click moves
 * **the agent you are talking to** onto that stage and lands the camera somewhere a board can be
 * read. The landing rule itself is unit-tested (`camera.middleOf`); what a browser is needed for
 * is that the zoom that comes out of it is above the line where a board takes clicks at all.
 *
 * Needs no model: every stage here is made the way a drawing makes one, over the socket.
 */
import { newAgent, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await settle(page, 1500);

const link = await socket();
const focused = await until(() => link.last("agents")?.focused);
say("the server says which agent is focused", !!focused);

/*
 * Two stages, made the way stages are made: an agent draws on one. `stage.pen.edit` claims a
 * folder for whoever sends it — the path `stage.newStage` takes as well — so two chats each
 * drawing a note is two stages, with no model and no agent turn. The fixture ships with one
 * chat, so the second one is made first.
 */
await newAgent(page);
await settle(page, 1500);
const chats = await until(async () => {
	const list = (link.last("agents")?.chats ?? []).map((chat) => chat.id);
	return list.length >= 2 ? list : undefined;
}, 15000);
say("there are two chats, so there can be two stages", !!chats && chats.length >= 2, String(chats?.length));
const note = (agentId, id) => ({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id, content: "Made for the stages check" }, box: { x1: 0, y1: 0, x2: 240, y2: 120 } }] });
for (const [index, id] of (chats ?? []).entries()) link.send(note(id, `s-${index}`));
const listed = await until(async () => {
	const rows = link.received.filter((m) => m.type === "stages").at(-1)?.stages ?? [];
	return rows.length >= 2 ? rows : undefined;
}, 12000);
say("the server tells the browser what stages exist", !!listed && listed.length >= 2, JSON.stringify((listed ?? []).map((one) => one.name)));

// --- the pill names it, and opens the manager -------------------------------------------------

const pillStage = () => page.evaluate(() => document.querySelector(".pill [aria-label^='Stages']")?.textContent?.trim() ?? null);
const mine = await until(async () => (await pillStage()) || undefined);
say("the pill names the stage this conversation is on", !!mine, String(mine));

await page.locator(".pill [aria-label^='Stages']").click();
await page.waitForSelector(".stage-manager", { timeout: 6000 });
const cards = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".stage-card")].map((card) => ({
			name: card.dataset.name,
			here: card.dataset.here ?? null,
			dim: card.dataset.dim ?? null,
			shot: card.querySelector(".stage-shot")?.getAttribute("src") ?? null,
		})),
	);
const wall = await cards();
say("pressing it opens a panel with a card per stage", wall.length === (listed ?? []).length && wall.length >= 2, JSON.stringify(wall.map((one) => one.name)));
say("…and the card of the stage you are on is the marked one", wall.filter((one) => one.here).length === 1 && wall.find((one) => one.here)?.name === mine, JSON.stringify(wall.map((one) => [one.name, one.here])));
/* The picture is the server's, taken once per revision — the `v` is what makes that cacheable. */
say("…each card asks for the stage's own picture, by revision", wall.every((one) => /^\/api\/stage-thumb\/.+[?&]v=\d+/.test(one.shot ?? "")), String(wall[0]?.shot));

// --- the field narrows the wall without shortening it -------------------------------------------

const wanted = wall.find((one) => !one.here)?.name ?? "";
await page.fill(".stage-manager input", wanted);
await settle(page, 400);
const searched = await cards();
say("a search dims what it does not match, and keeps every card where it was", searched.length === wall.length && searched.filter((one) => !one.dim).length === 1, JSON.stringify(searched.map((one) => [one.name, one.dim])));
say("…and the count says how many of how many", (await page.textContent(".stage-count"))?.trim() === `1 of ${wall.length}`, (await page.textContent(".stage-count"))?.trim());

// --- a click moves this agent, and lands the camera ---------------------------------------------

await page.locator(`.stage-card[data-name="${wanted}"]`).click();
await settle(page, 2500);
const sent = link.received.filter((m) => m.type === "stages").at(-1)?.stages ?? [];
say("the panel closes on a pick", await page.evaluate(() => !document.querySelector(".stage-manager")));
say("…the agent you are talking to is on that stage now", (await pillStage()) === wanted, `${mine} → ${await pillStage()}`);
say("…and the server says so too", sent.find((one) => one.name === wanted)?.agents.some((agent) => agent.id === focused) === true, JSON.stringify(sent.map((one) => [one.name, one.agents.length])));
/*
 * Landed somewhere a board can be read. Below half zoom a board takes no pointer events at all,
 * so a landing under it is a stage you have arrived at and cannot touch — which is the state the
 * manager exists to get somebody out of, not one it may leave them in.
 */
const zoom = await page.evaluate(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
say("…at a zoom where a board can be read and clicked into", zoom >= 50, `${zoom}%`);

// --- and Escape leaves everything as it was -----------------------------------------------------

await page.locator(".pill [aria-label^='Stages']").click();
await page.waitForSelector(".stage-manager", { timeout: 6000 });
await page.keyboard.press("Escape");
await settle(page, 500);
say("Escape closes it, and the stage is the one it was", (await page.evaluate(() => !document.querySelector(".stage-manager"))) && (await pillStage()) === wanted);

link.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
