/**
 * The agent's half of the tiers: `attach` and `show` from inside `stage_eval`.
 *
 * Needs a model. The user-facing half — hiding, the rail click, the empty-context fallback
 * — is in tiers.mjs and needs nothing.
 */
import { ask, deckState, emptyCanvas, open, openPanel, say, settle } from "../harness.mjs";

const deck = await deckState();
const two = deck.boards.map((board) => board.path).slice(0, 2);

const { browser, page, errors } = await open({ width: 1600, height: 1000 });
const onCanvas = () => page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path).sort());
const inRail = () => page.evaluate(() => [...document.querySelectorAll(".rail-item .file")].map((n) => n.textContent).sort());

// A fresh agent, so nothing it holds is inherited.
await openPanel(page, "agents");
await page.locator('.chats .rail-head button[title="Start another agent"]').click();
await settle(page, 1200);
await page.mouse.move(800, 500);
// A fresh agent holds nothing, so its canvas is empty until it attaches something.
await emptyCanvas(page);

await ask(page, `With one stage_eval call, attach ${two[0]} and ${two[1]}, then return stage.inPlay().`);
say("attaching narrows the canvas to what is held", (await onCanvas()).join() === two.join(), (await onCanvas()).join(" "));
say("the rail lists the same two", (await inRail()).join() === two.join(), (await inRail()).join(" "));

await ask(page, `With one stage_eval call, show only ${two[0]}.`);
say("show narrows the canvas further", (await onCanvas()).join() === two[0], (await onCanvas()).join(" "));
say("…and the rail still lists both", (await inRail()).length === 2, (await inRail()).join(" "));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
