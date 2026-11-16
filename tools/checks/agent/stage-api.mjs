/**
 * The agent's half of the canvas: putting cards on it and taking one off with the `decks` command in
 * its shell, as the stage and the Canvas tab then show; once in the new words (decks item …), once in
 * today's (decks canvas …), which resumed sessions and the person's scripts still use. Needs a model.
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
	const paths = canvas ? await canvas.evaluate(() => (window.__decksProbes?.cards?.() ?? []).map((one) => one.path)) : [];
	return paths.map(base).sort();
};
/*
 * The side panel's Canvas tab, which lists what is drawn on the canvas on screen: its "Cards" rows
 * (`LeftPanel.tsx`, `.v3-item[data-kind="board"]`), each saying the card's title.
 */
const inPanel = () =>
	page.evaluate(() => [...document.querySelectorAll('.panel-section[data-kind="canvas"] .v3-item[data-kind="board"] .v3-item-name')].map((n) => n.textContent.trim()).sort());

/** Whether the decks command answers today's words yet (protocol/compat's table, Lexicon's): until then that round is expected to fail. */
const OLD_WORDS_ANSWER = false;

/** One round on a fresh agent, in one wording; a round expected to fail says what it saw without failing the check. */
async function round(label, words, expected = true) {
	// A fresh agent, in a workspace of its own, so it holds nothing: a new agent otherwise joins its workspace's latest canvas.
	const made = await freshAgent(page, `stage-api-${label.replace(/\W+/g, "-")}`);
	await settle(page, 400);
	await page.mouse.move(800, 500);
	await emptyCanvas(page);
	const check = (name, ok, detail) => (expected ? say(`${label}: ${name}`, ok, detail) : console.log(`${ok ? "PASS" : "EXPECTED FAIL"}  ${label}: ${name} — ${detail}`));
	await ask(page, `${words}, put the cards ${two[0]} and ${two[1]} on your canvas, then read your canvas.`);
	// The panel has to be up for its rows to exist at all; `open` puts it on the Canvas tab.
	await openPanel(page);
	await settle(page, 400);
	check("showing puts exactly those two up", (await onCanvas()).join() === two.map(base).sort().join(), (await onCanvas()).join(" "));
	check("the Canvas tab lists the same two", (await inPanel()).join() === two.map(labelOf).sort().join(), (await inPanel()).join(" | "));
	await ask(page, `${words}, take ${two[1]} off your canvas.`);
	await settle(page, 400);
	check("taking one off leaves the other", (await onCanvas()).join() === base(two[0]), (await onCanvas()).join(" "));
	check("…and the Canvas tab lists only that one", (await inPanel()).join() === labelOf(two[0]), (await inPanel()).join(" | "));
	const tidy = await socket();
	tidy.send({ type: "agent.remove", id: made.id });
	await new Promise((resolve) => setTimeout(resolve, 300));
	tidy.close();
}

await round("new words", "With the new decks commands");
await round("today's words", "With the decks command", OLD_WORDS_ANSWER);
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
