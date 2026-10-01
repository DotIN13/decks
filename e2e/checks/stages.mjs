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
import { open, resetStage, say, settle, socket } from "../harness.mjs";

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
// In a workspace nobody is in, so it gets a canvas of its own: a new agent otherwise joins its workspace's latest.
link.send({ type: "agent.create", workspace: "stages-check" });
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
			title: card.querySelector(".row-label")?.textContent?.trim() ?? null,
			here: card.dataset.here ?? null,
			shot: card.querySelector(".stage-shot")?.getAttribute("src") ?? null,
			empty: !!card.querySelector(".stage-empty"),
		})),
	);
const wall = await cards();
say("pressing it opens a panel with a card per stage", wall.length === (listed ?? []).length && wall.length >= 2, JSON.stringify(wall.map((one) => one.name)));
say("…and the card of the stage you are on is the marked one", wall.filter((one) => one.here).length === 1 && wall.find((one) => one.here)?.title === mine, JSON.stringify(wall.map((one) => [one.name, one.title, one.here])));
/* The picture is the server's, taken once per revision — the `v` is what makes that cacheable. */
// An empty canvas has nothing for the server to draw: its card says "Empty canvas" instead (`StageManager`, `.stage-empty`).
say("…each card with boards asks for the stage's own picture, by revision, and an empty one says it is empty", wall.every((one) => /^\/api\/stage-thumb\/.+[?&]v=\d+/.test(one.shot ?? "") || one.empty) && wall.some((one) => (one.shot ?? "").startsWith("/api/stage-thumb/")), JSON.stringify(wall.map((one) => one.shot?.slice(0, 60) ?? (one.empty ? "empty" : null))));

// --- the field filters the wall to what matches -------------------------------------------------

// One whose name no other card's contains, so a search for it matches it alone: checks that ran
// before this one in the same deck may have left agent-2, agent-2-2 and so on.
const wanted = (wall.find((one) => !one.here && !wall.some((other) => other !== one && other.name.includes(one.name))) ?? wall.find((one) => !one.here))?.name ?? "";
/* The pill says a stage's name as the person reads it (`stage.json`); the folder is the card's id. */
const wantedTitle = wall.find((one) => one.name === wanted)?.title ?? wanted;
await page.fill(".stage-manager input", wanted);
await settle(page, 400);
const searched = await cards();
say("a search leaves only the canvases that match", searched.length === 1 && searched[0]?.name === wanted, JSON.stringify(searched.map((one) => one.name)));
say("…and the count says how many of how many", (await page.textContent(".stage-count"))?.trim() === `1 of ${wall.length}`, (await page.textContent(".stage-count"))?.trim());

// --- a click moves this agent, and lands the camera ---------------------------------------------

await page.locator(`.stage-card[data-name="${wanted}"]`).click();
await settle(page, 2500);
const sent = link.received.filter((m) => m.type === "stages").at(-1)?.stages ?? [];
say("the panel closes on a pick", await page.evaluate(() => !document.querySelector(".stage-manager")));
say("…the agent you are talking to is on that stage now", (await pillStage()) === wantedTitle, `${mine} → ${await pillStage()}`);
say("…and the server says so too", sent.find((one) => one.name === wanted)?.agents.some((agent) => agent.id === focused) === true, JSON.stringify(sent.map((one) => [one.name, one.agents.length])));
/*
 * Landed at the arriving zoom, which is the same one every time (`camera.STAGE_ZOOM`).
 *
 * A looking scale rather than a working one: what an arrival answers is "what is on this stage",
 * several boards at once. Pinned here as well as in the unit test because the number that matters
 * is the one that comes out of the whole round trip — the pick, the boards arriving, the camera.
 */
const zoom = await page.evaluate(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
say("…at the arriving zoom, the same for every stage", zoom === 30, `${zoom}%`);
say("…and says nothing about it: a toast for a thing you just did is noise", (await page.evaluate(() => document.querySelectorAll(".notice").length)) === 0);

// --- and Escape leaves everything as it was -----------------------------------------------------

await page.locator(".pill [aria-label^='Stages']").click();
await page.waitForSelector(".stage-manager", { timeout: 6000 });
await page.keyboard.press("Escape");
await settle(page, 500);
{
	const gone = await page.evaluate(() => !document.querySelector(".stage-manager"));
	const now = await pillStage();
	say("Escape closes it, and the stage is the one it was", gone && now === wantedTitle, JSON.stringify({ gone, now, wantedTitle }));
}

link.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
