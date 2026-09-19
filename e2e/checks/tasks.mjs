/**
 * The dispatch dashboard: a real task, pressed into a real agent.
 *
 * The unit tests pin the rule, the schedule arithmetic and the store. What only a
 * browser can prove is the whole path a person walks:
 *
 * - the app lands on the dashboard, and a sentence in the bar becomes a task;
 * - the task is dispatched through the real rule into the real agent's queue and the
 *   Tasks tab draws it assigned with the agent's name;
 * - stop takes it out of the queue, retry puts it back, and the row's state follows;
 * - a schedule the server holds is drawn on the Cron tab with its next run, and
 *   remove takes it away.
 *
 * No model is needed anywhere: the task never runs, because the check stops it while
 * it is still queued, which is itself the assertion that cancel reaches the queue.
 */
import { open, say, settle, socket, WEB } from "../harness.mjs";

// The harness opens on the stage; this check is about the dashboard, so it goes there.
const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.goto(`${WEB}/#/boards`, { waitUntil: "load" });
await page.waitForSelector(".surface");
await settle(page, 1200);
const LINK = await socket();

let agentId = "";
let agentName = "";
// The first *visible* agent: the deck also has a dispatcher, which is not one a person
// hands work to and is not in the panel.
for (let i = 0; i < 30 && !agentId; i++) {
	const agents = LINK.last("agents");
	const real = agents?.chats?.find((chat) => chat.role !== "dispatcher");
	agentId = real?.id ?? "";
	agentName = real?.name ?? "";
	if (!agentId) await settle(page, 200);
}
say("the deck has a dispatcher, and it is not in the agent panel", (LINK.last("agents")?.chats ?? []).some((chat) => chat.role === "dispatcher") && !((await page.locator(".panel-shell").textContent()) ?? "").includes("Dispatcher"));
if (!agentId) throw new Error("the fixture deck has no agent to dispatch to");

// A workspace for the agent, so the gallery has a real shelf and a schedule a place to write.
LINK.send({ type: "agent.workspace", id: agentId, workspace: "political-llm" });
await settle(page, 600);

say("the app lands on the dashboard", (await page.getAttribute(".surface", "data-surface")) === "dispatch");
say("the gallery has a shelf for the workspace", ((await page.locator(".dispatch").textContent()) ?? "").includes("political-llm"));

// --- a task, from the bar ------------------------------------------------------
const TASK = "Remeasure the panel widths across every board";
await page.fill(".dockfield", TASK);
await page.keyboard.press("Enter");
await page.locator('.pill [role="tab"]', { hasText: "Tasks" }).click();

const rowText = (state) =>
	page.evaluate(
		([state, task]) => [...document.querySelectorAll(`.dispatch-task[data-state="${state}"]`)].map((row) => row.textContent ?? "").find((text) => text.includes(task)) ?? "",
		[state, TASK],
	);
const waitRow = async (state) => {
	let text = "";
	for (let i = 0; i < 30 && !text; i++) {
		await settle(page, 250);
		text = await rowText(state);
	}
	return text;
};

/*
 * A plain sentence goes to the dispatcher *agent*, which decides in a turn of its own: the
 * task is open while it thinks, and the row says so. No model answers in this fixture, so
 * the check asserts the hand-off, not the placement.
 */
const opened = await waitRow("open");
say("a sentence in the bar is handed to the dispatcher, and the task is open while it decides", opened.includes("dispatcher is deciding"), opened);
/*
 * The cards are a grid with air between them. A rule once landed between `.dispatch-tasks,` and
 * the block it shared with `.dispatch-cron`, which handed the list the new rule's declarations
 * instead: one 480px column of cards with their borders touching, and nothing went red.
 */
const lay = await page.evaluate(() => {
	const style = getComputedStyle(document.querySelector(".dispatch-tasks"));
	return { display: style.display, gap: style.rowGap };
});
say("the task cards are laid out as a grid with a gap", lay.display === "grid" && lay.gap === "10px", JSON.stringify(lay));
const openRow = page.locator('.dispatch-task[data-state="open"]', { hasText: TASK }).first();
say("the open task's row offers its own dispatcher log", (await openRow.getByRole("button", { name: "dispatcher log" }).count()) === 1);
await openRow.getByRole("button", { name: "dispatcher log" }).click();
await settle(page, 500);
say("…which opens the conversation float on a dispatcher spawned for it", (await page.getAttribute(".stream", "data-shown")) === "true" && ((await page.locator(".stream-head-name").textContent()) ?? "").includes("Dispatcher"));
say("…and that dispatcher is a child of the template, hidden like it", (LINK.last("agents")?.chats ?? []).filter((chat) => chat.role === "dispatcher" && chat.parentId).length >= 1);
await page.keyboard.press("Escape");
await settle(page, 300);

// A task that names its agent skips the dispatcher: the rule checks the agent and the
// queue takes it, which is the path stop and retry are exercised on.
const NAMED = "Remeasure the panel widths on the plan board";
LINK.send({ type: "task.create", task: { text: NAMED, agentId }, requestedBy: "you" });
const rowText2 = (state) =>
	page.evaluate(
		([state, task]) => [...document.querySelectorAll(`.dispatch-task[data-state="${state}"]`)].map((row) => row.textContent ?? "").find((text) => text.includes(task)) ?? "",
		[state, NAMED],
	);
const waitRow2 = async (state) => {
	let text = "";
	for (let i = 0; i < 30 && !text; i++) {
		await settle(page, 250);
		text = await rowText2(state);
	}
	return text;
};
const assigned = await waitRow2("assigned");
say("a task that names an agent is queued with that agent", assigned.includes(agentName), assigned);

const row = (state) => page.locator(`.dispatch-task[data-state="${state}"]`, { hasText: NAMED }).first();
await row("assigned").getByRole("button", { name: "stop" }).click();
const cancelled = await waitRow2("cancelled");
say("stop takes the task back, out of the queue it was queued in", cancelled.length > 0, "cancelled row present");

await row("cancelled").getByRole("button", { name: "retry" }).click();
const retried = await waitRow2("open");
say("retry asks the dispatcher again", retried.includes("dispatcher is deciding"), retried);

// --- a schedule the server holds, on the Cron tab -----------------------------
LINK.send({ type: "schedule.create", schedule: { name: "Morning digest", at: "09:00", days: [0, 1, 2, 3, 4, 5, 6], workspace: "political-llm", task: "Write a digest of what changed since yesterday." } });
await page.locator('.pill [role="tab"]', { hasText: "Cron" }).click();
let scheduled = "";
for (let i = 0; i < 30 && !scheduled; i++) {
	await settle(page, 250);
	scheduled = await page.evaluate(() => [...document.querySelectorAll(".dispatch-cron, .dispatch-rows li")].map((row) => row.textContent ?? "").find((text) => text.includes("Morning digest")) ?? "");
}
say("a schedule is drawn on the Cron tab with its next run and its own words", /next in/.test(scheduled) && scheduled.includes("political-llm") && scheduled.includes("what changed since yesterday"), scheduled);

/*
 * The deck's timezone. The hour on a card is the person's hour, so the card says which clock
 * it is on, and choosing a zone moves every job that follows the deck's clock at once. A job
 * made with a zone of its own keeps it.
 */
LINK.send({ type: "schedule.create", schedule: { name: "London nine", at: "09:00", days: [1], workspace: "political-llm", task: "x", timezone: "Europe/London" } });
LINK.send({ type: "settings.set", timezone: "America/Los_Angeles" });
const cronCard = async (name) => {
	for (let i = 0; i < 30; i++) {
		await settle(page, 200);
		const text = await page.evaluate((wanted) => [...document.querySelectorAll(".dispatch-rows li")].map((row) => row.textContent ?? "").find((row) => row.includes(wanted)) ?? "", name);
		if (text) return text;
	}
	return "";
};
let zoned = "";
for (let i = 0; i < 20 && !/P[DS]T/.test(zoned); i++) zoned = await cronCard("Morning digest");
say("a job on the deck's clock names the zone chosen in Settings", /09:00\s*P[DS]T/.test(zoned), zoned);
const pinned = await cronCard("London nine");
say("a job made with its own timezone keeps it", /09:00\s*(GMT|BST)/.test(pinned) && !/P[DS]T/.test(pinned), pinned);
const told = LINK.last("settings");
say("every browser is told the deck's zone and the machine's", told?.settings?.timezone === "America/Los_Angeles" && typeof told?.machineZone === "string" && told.machineZone.length > 0, JSON.stringify(told));
LINK.send({ type: "settings.set", timezone: "Not/AZone" });
await settle(page, 400);
say("a name that is not a timezone is refused, and the zone stays", LINK.last("settings")?.settings?.timezone === "America/Los_Angeles");
LINK.send({ type: "settings.set", timezone: null });
await page.locator(".dispatch-rows li", { hasText: "London nine" }).first().getByRole("button", { name: "remove" }).click();

await page.locator(".dispatch-rows li", { hasText: "Morning digest" }).first().getByRole("button", { name: "remove" }).click();
let gone = false;
for (let i = 0; i < 30 && !gone; i++) {
	await settle(page, 250);
	gone = !((await page.locator(".dispatch").textContent()) ?? "").includes("Morning digest");
}
say("removing a schedule takes it off the list", gone);

LINK.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
