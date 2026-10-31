/**
 * The agent's half of the canvas: putting cards on it and taking one off with the `decks` command
 * in the agent's shell, as the stage and the side panel's Canvas tab then show.
 *
 * Needs a model.
 */
import { ask, canvasFrame, deckState, emptyCanvas, freshAgent, nameOf, open, openPanel, say, settle, socket } from "../harness.mjs";

const deck = await deckState();
const two = deck.boards.map((card) => card.path).slice(0, 2);
/* The stage's nodes carry the path, and the Canvas tab's rows a card's title (its item's name), or its folder when it has none (`model/layers.ts`). */
const base = nameOf;
const labelOf = (path) => deck.library.find((card) => card.path === path)?.title || nameOf(path);

const { browser, page, errors } = await open({ width: 1600, height: 1000 });
// What is on the stage, in the canvas frame (none while the conversation has no canvas); a card placed on a canvas is its copy there, so compared by folder.
const onCanvas = async () => {
	const canvas = await canvasFrame(page, { timeout: 5000 }).catch(() => undefined);
	const paths = canvas ? await canvas.evaluate(() => (window.__decksCards?.() ?? []).map((one) => one.path)) : [];
	return paths.map(base).sort();
};
/*
 * The side panel's Canvas tab, which lists what is drawn on the canvas on screen: its "Cards" rows
 * (`LeftPanel.tsx`, `.v3-item[data-kind="board"]`), each saying the card's title.
 */
const inPanel = () =>
	page.evaluate(() => [...document.querySelectorAll('.panel-section[data-kind="canvas"] .v3-item[data-kind="board"] .v3-item-name')].map((n) => n.textContent.trim()).sort());

// A fresh agent, so nothing it holds is inherited: in a workspace of its own, since a new agent
// otherwise joins its workspace's latest canvas and holds what is on it.
const made = await freshAgent(page, "stage-api-fresh");
await settle(page, 400);
await page.mouse.move(800, 500);
// A fresh agent holds nothing, so its canvas is empty until it shows something.
await emptyCanvas(page);

await ask(page, `With the decks command, put the cards ${two[0]} and ${two[1]} on your canvas, then read your canvas.`);
// The panel has to be up for its rows to exist at all; `open` puts it on the Canvas tab.
await openPanel(page);
await settle(page, 400);
say("showing puts exactly those two up", (await onCanvas()).join() === two.map(base).sort().join(), (await onCanvas()).join(" "));
say("the Canvas tab lists the same two", (await inPanel()).join() === two.map(labelOf).sort().join(), (await inPanel()).join(" | "));

await ask(page, `With the decks command, take ${two[1]} off your canvas.`);
await settle(page, 400);
say("taking one off leaves the other", (await onCanvas()).join() === base(two[0]), (await onCanvas()).join(" "));
say("…and the Canvas tab lists only that one", (await inPanel()).join() === labelOf(two[0]), (await inPanel()).join(" | "));

const tidy = await socket();
tidy.send({ type: "agent.remove", id: made.id });
await new Promise((resolve) => setTimeout(resolve, 300));
tidy.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
