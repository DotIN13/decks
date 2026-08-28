/**
 * The three tiers (DESIGN §2), driven the way a user drives them.
 *
 * `board.play` attaches as well as showing, so the whole thing can be set up over the
 * socket — no model needed. The agent-side half (`attach`/`show` from `stage_eval`) is
 * checked in stage-api.mjs, which does need one.
 */
import { deckState, open, ready, say, settle, socket } from "../harness.mjs";

const deck = await deckState();
const paths = deck.boards.map((board) => board.path).sort();

const { browser, page, errors } = await open({ width: 1600, height: 1000 });
const onCanvas = () => page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path).sort());
const inRail = () => page.evaluate(() => [...document.querySelectorAll(".rail-item .file")].map((n) => n.textContent).sort());

// A fresh agent holds nothing, so the canvas falls back to the whole deck. Without that
// fallback a new agent on an existing deck opens onto a blank canvas and reads as data loss.
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
await page.locator(".chats .rail-head button", { hasText: "+" }).click();
await settle(page, 1200);
await page.mouse.move(800, 500);
await ready(page);
say("an agent holding nothing shows the whole deck", (await onCanvas()).join() === paths.join(), (await onCanvas()).join(" "));

// Holding two boards narrows the canvas to them.
const two = paths.slice(0, 2);
const link = await socket();
for (const path of two) link.send({ type: "board.play", path });
await page.waitForFunction((wanted) => document.querySelectorAll(".board-node").length === wanted, two.length, { timeout: 8000 });
say("the canvas narrows to what the agent holds", (await onCanvas()).join() === two.join(), (await onCanvas()).join(" "));
say("the rail lists the same two", (await inRail()).join() === two.join(), (await inRail()).join(" "));

// The × on a board takes it off the canvas, and the rail keeps it.
const first = two[0];
await page.locator(`.board-node[data-path="${first}"] .chrome`).hover();
await page.locator(`.board-node[data-path="${first}"] .chrome .hide`).click();
await page.waitForFunction((wanted) => !document.querySelector(`.board-node[data-path="${wanted}"]`), first, { timeout: 8000 });
say("the × takes a board off the canvas", !(await onCanvas()).includes(first), `canvas=${(await onCanvas()).join(" ") || "(empty)"}`);
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
