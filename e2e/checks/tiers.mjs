/**
 * The three tiers (DESIGN §2), driven the way a user drives them.
 *
 * `board.play` attaches as well as showing, so the whole thing can be set up over the
 * socket — no model needed. The agent-side half (`attach`/`show` from `stage_eval`) is
 * checked in stage-api.mjs, which does need one.
 */
import { deckState, emptyCanvas, open, say, settle, socket } from "../harness.mjs";

const deck = await deckState();
const paths = deck.boards.map((board) => board.path).sort();

const { browser, page, errors } = await open({ width: 1600, height: 1000 });
const onCanvas = () => page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path).sort());
const inRail = () => page.evaluate(() => [...document.querySelectorAll(".rail-item .file")].map((n) => n.textContent).sort());

/*
 * A fresh agent holds nothing, so it puts nothing on the canvas — and the rail still lists
 * the whole deck, so nothing is hidden. The canvas used to fall back to every board, which
 * claimed the agent was working from all of them and made its first act, narrowing to one,
 * look like boards disappearing.
 */
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
await page.locator('.chats .rail-head button[title="Start another agent"]').click();
await settle(page, 1200);
await emptyCanvas(page);
say("an agent holding nothing puts nothing on the canvas", (await onCanvas()).length === 0, (await onCanvas()).join(" ") || "(empty)");
say("…while the rail still lists the whole deck", (await inRail()).join() === paths.join(), (await inRail()).join(" "));
await page.mouse.move(800, 500);

// Holding two boards narrows the canvas to them.
const two = paths.slice(0, 2);
const link = await socket();
for (const path of two) link.send({ type: "board.play", path });
await page.waitForFunction((wanted) => document.querySelectorAll(".board-node").length === wanted, two.length, { timeout: 8000 });
say("the canvas narrows to what the agent holds", (await onCanvas()).join() === two.join(), (await onCanvas()).join(" "));
say("the rail lists the same two", (await inRail()).join() === two.join(), (await inRail()).join(" "));

// The hide button on a board takes it off the canvas, and the rail keeps it.
//
// Fitted first, on purpose: it is at a board's top-right corner, so with the camera left
// wherever the previous check put it the button can sit off-screen or exactly where the
// neighbouring board begins — which is a fact about the camera, not about hiding.
const first = two[0];
await page.locator(`.board-node[data-path="${first}"] .chrome`).hover();
await page.locator(`.board-node[data-path="${first}"] .chrome .hide`).click();
await page.waitForFunction((wanted) => !document.querySelector(`.board-node[data-path="${wanted}"]`), first, { timeout: 8000 });
say("the hide button takes a board off the canvas", !(await onCanvas()).includes(first), `canvas=${(await onCanvas()).join(" ") || "(empty)"}`);
say("…without dropping it from the agent's context", (await inRail()).length === 2, (await inRail()).join(" "));

// Clicking a rail item puts it back.
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
await page.locator(`.rail-item:has(.file:text-is("${first}"))`).click();
await page.waitForFunction((wanted) => Boolean(document.querySelector(`.board-node[data-path="${wanted}"]`)), first, { timeout: 8000 });
await page.mouse.move(800, 500);
say("clicking a rail item plays it", (await onCanvas()).includes(first), (await onCanvas()).join(" "));

link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
