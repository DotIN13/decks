import { open, say, settle } from "../harness.mjs";

/*
 * Agents are the way in: pressing one goes to the canvas it is working on.
 *
 * Fed frames, no agent. Three canvases, two agents each on a different one (`AgentChat.canvas`),
 * and the question is where a press lands — from the panel's Agents tab and from a face in the
 * corner's stack — and that a `context.changed` naming a new canvas (the agent moved itself with
 * `stage.canvas`) moves where the next press goes. Before this, a press in a room kept you in
 * the room and only changed who you were talking to.
 */

const { browser, page, errors } = await open({ width: 1400, height: 980, scheme: "light" });

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
await settle(page, 2000);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const hash = () => page.evaluate(() => decodeURIComponent(location.hash));

const now = Date.now();
const canvas = (id, name, agents) => ({ id, name, workspace: "political-llm", boards: [], links: [], groups: [], changedAt: now, openedAt: now, agents });
await feed({
	type: "canvases",
	canvases: [canvas("cv_bench", "Bench surfaces", ["a1"]), canvas("cv_neutral", "Neutral image", ["a1", "a2"]), canvas("cv_s7", "Family chat", ["a2"])],
});
const chat = (id, name, state, on) => ({
	id,
	name,
	kind: "claude",
	state,
	lastAt: now,
	unread: 0,
	identity: { name, color: "#3b5cf6", workspace: "political-llm" },
	boards: [],
	inPlay: [],
	canvas: on,
});
await feed({ type: "agents", defaultKind: "claude", focused: "a1", chats: [chat("a1", "Iris", "tool", "cv_neutral"), chat("a2", "Wren", "waiting", "cv_s7")] });
await settle(page, 400);

// Start in a room neither of them is in now: a press used to keep you here.
await page.evaluate(() => { location.hash = "#/canvas/cv_bench"; });
await settle(page, 800);

const shown = await page.evaluate(() => Boolean(document.querySelector(".panel-shell")));
if (!shown) await page.locator('[aria-label*="boards panel" i]').first().click();
await page.waitForSelector(".panel-shell", { timeout: 5000 });
await page.getByRole("tab", { name: "Agents" }).click();
await settle(page, 400);

await page.locator(".agent-row", { hasText: "Iris" }).first().click();
await settle(page, 600);
let at = await hash();
say("pressing an agent's row goes to the canvas it is working on", at.includes("cv_neutral") && at.includes("a1"), at);

await page.locator(".agent-row", { hasText: "Wren" }).first().click();
await settle(page, 600);
at = await hash();
say("…and pressing another from a room goes to that one's canvas, not staying put", at.includes("cv_s7") && at.includes("a2"), at);

// Iris moves itself: `stage.canvas("Bench surfaces")` is heard as a context.changed naming it.
await feed({ type: "context.changed", agentId: "a1", boards: [], inPlay: [], canvas: "cv_bench" });
await settle(page, 300);
const face = page.locator(".agent-facebtn[aria-label^='Switch to Iris']").first();
say("the corner's stack shows Iris", (await face.count()) === 1);
await face.click();
await settle(page, 600);
at = await hash();
say("a face in the corner goes where the agent moved to", at.includes("cv_bench") && at.includes("a1"), at);

await page.locator(".agent-row", { hasText: "Iris" }).first().click();
await settle(page, 600);
say("pressing the agent you are with, in its own room, moves nothing", (await hash()) === at, await hash());

// --- the Boards tab: what the canvas took off is held, not shown ------------------------
/* Boards belong to the canvas, so the second section is the room's, not the agent's: a board
   the canvas has taken off and keeps a place for. Fed on the canvas we are standing in. */
await feed({
	type: "canvases",
	canvases: [
		{ ...canvas("cv_bench", "Bench surfaces", ["a1"]), boards: ["boards/plan.html"], kept: ["boards/notes.html"] },
		canvas("cv_neutral", "Neutral image", ["a1", "a2"]),
		canvas("cv_s7", "Family chat", ["a2"]),
	],
});
await page.getByRole("tab", { name: "Boards" }).click();
await settle(page, 500);
const held = await page.evaluate(() =>
	[...document.querySelectorAll('.panel-section[data-kind="held"] .row-label, .panel-section[data-kind="held"] [data-path]')].map((row) => row.getAttribute("data-path") ?? row.textContent?.trim()),
);
const heldText = await page.evaluate(() => document.querySelector('.panel-section[data-kind="held"]')?.textContent ?? "");
say("the canvas's taken-off board is under Held, not shown", heldText.includes("Held, not shown") && /notes/i.test(heldText), `${heldText.slice(0, 120)} ${JSON.stringify(held)}`);

// --- the agent you are with moves itself, and you go with it ---------------------------
/* What `stage.useCanvas("Neutral image")` is heard as. Before this the view stayed put, and the
   next line typed here brought the agent back to this room, undoing its move. */
await feed({ type: "context.changed", agentId: "a1", boards: [], inPlay: [], canvas: "cv_neutral" });
await settle(page, 700);
at = await hash();
say("when the agent you are with moves canvas, the view follows it", at.includes("cv_neutral") && at.includes("a1"), at);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
