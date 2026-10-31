/**
 * The three tiers (DESIGN §2), driven the way a user drives them.
 *
 * `board.play` attaches as well as showing, so the whole thing can be set up over the
 * socket — no model needed. The agent-side half (`show`/`hide` from the `decks` command) is
 * checked in stage-api.mjs, which does need one.
 */
import { canvasFrame, deckState, emptyCanvas, freshAgent, nameOf, open, openPanel, pressCardAction, say, selectCard, settle, socket } from "../harness.mjs";

const deck = await deckState();
const paths = deck.boards.map((board) => board.path).sort();

const { browser, page, errors } = await open({ width: 1600, height: 1000, panelTab: "canvas" });
/*
 * What is on the stage: a board is only its picture, so the stage's own list is what is read, in
 * the canvas frame (asked for again each time: the frame is made again on another canvas).
 */
const onCanvas = async () => (await canvasFrame(page)).evaluate(() => (window.__decksCards?.() ?? []).map((board) => board.path).sort());

const base = nameOf;
const names = paths.map(base).sort();

/*
 * The panel's Canvas tab: one row per board on this canvas (`panel/LeftPanel.tsx`, `itemRow`). It
 * says a board's title, not its file, so it is compared with the stage by count. The panel no
 * longer has the agent's "held" and "deck" headings; what the agent holds is read off the
 * server's `context.changed` instead (below).
 */
const panelBoards = () => page.evaluate(() => document.querySelectorAll('.panel-list[data-tab="canvas"] .v3-item[data-kind="board"]').length);

await openPanel(page);
say("the stage shows what the agent has up", (await onCanvas()).join() === paths.join(), (await onCanvas()).join(" "));
say("…and the panel's Canvas tab lists the same boards", (await panelBoards()) === paths.length, `${await panelBoards()} rows for ${paths.length} boards`);
await page.mouse.move(800, 500);

/*
 * A fresh agent holds nothing, so it puts nothing on its stage. The stage used to fall back
 * to every board, which claimed the agent was working from all of them and made its first
 * act — narrowing to one — look like boards disappearing.
 *
 * The panel used to fall back the same way, on the argument that it was the only place to
 * find a board so it had to list every one. It does not have to: the deck is the last
 * section of its list, always there under whatever the agent is holding. So both say what is
 * true rather than one of them saying two things depending on state nobody is looking at —
 * the stage is what the agent put in play, and the panel's first two headings are what it
 * holds.
 */
/*
 * A new agent opens its workspace's latest canvas, which here is the deck's: so this one is made in
 * a workspace of its own, where there is no canvas yet and it gets an empty one, and picked from
 * the composer's agent list, which goes to its stage.
 */
const made = await freshAgent(page, "tiers-fresh");
await emptyCanvas(page);
say("an agent holding nothing puts nothing on its stage", (await onCanvas()).length === 0, (await onCanvas()).join(" ") || "(empty)");
await openPanel(page);
await page.waitForFunction(() => document.querySelectorAll('.panel-list[data-tab="canvas"] .v3-item').length === 0, null, { timeout: 4000 }).catch(() => {});
say("…and the panel's Canvas tab lists nothing", (await panelBoards()) === 0, `${await panelBoards()} rows`);
/*
 * And it is called something nothing else is called.
 *
 * Every unnamed chat used to be `Agent`, which is an address two of them shared: `@Agent`
 * from the bar could mean either. The roster is read off a fresh socket, because the
 * greeting carries it and this is a fact about the server rather than about the pill.
 */
const roster = await socket();
await settle(page, 600);
const chatNames = (roster.last("agents")?.chats ?? []).map((chat) => chat.name);
roster.close();
say("…with a number of its own: Agent 1, Agent 2", chatNames.every((name) => /^Agent \d+$/.test(name)), JSON.stringify(chatNames));
say("…and no two chats share one", new Set(chatNames.map((name) => name.toLowerCase())).size === chatNames.length, JSON.stringify(chatNames));

/*
 * Two plays narrow the stage to them. Sent over a socket of the check's own, which starts on
 * the conversation last opened anywhere — the agent the page has just made — so they land on
 * the stage on screen.
 */
/*
 * Played as the fixture canvas's cards; the agent's canvas holds its own copies of them
 * (`canvases/<canvas>/cards/<name>/`), so what is on the stage is compared by card name.
 */
const twoNames = names.slice(0, 2);
const two = twoNames.map((name) => paths.find((path) => base(path) === name));
const link = await socket();
if (made) link.send({ type: "agent.focus", id: made.id });
for (const path of two) link.send({ type: "card.play", path });
await (await canvasFrame(page)).waitForFunction((wanted) => (window.__decksCards?.() ?? []).length === wanted, two.length, { timeout: 8000 });
say("the stage narrows to what the agent holds", (await onCanvas()).map(base).sort().join() === twoNames.join(), (await onCanvas()).join(" "));
await openPanel(page);
await page.waitForFunction((wanted) => document.querySelectorAll('.panel-list[data-tab="canvas"] .v3-item[data-kind="board"]').length === wanted, two.length, { timeout: 4000 }).catch(() => {});
say("the panel's Canvas tab lists the same two", (await panelBoards()) === two.length, `${await panelBoards()} rows`);

// The hide button on a board takes it off the stage, and the agent keeps it.
//
// Fitted first, on purpose: it is at a board's top-right corner, so with the camera left
// wherever the previous check put it the button can sit off-screen or exactly where the
// neighbouring board begins — which is a fact about the camera, not about hiding.
const first = (await onCanvas()).find((path) => base(path) === twoNames[0]) ?? two[0];
await selectCard(page, first);
await pressCardAction(page, "Hide");
await (await canvasFrame(page)).waitForFunction((wanted) => !(window.__decksCards?.() ?? []).some((board) => board.path === wanted), first, { timeout: 8000 });
say("the hide button takes a board off the stage", !(await onCanvas()).includes(first), `canvas=${(await onCanvas()).join(" ") || "(empty)"}`);
/*
 * And the agent still holds it: hiding takes a board off the stage and deliberately does not
 * detach it (`wire/boards.ts`, `board.play`'s note), so it stays in the agent's context and out
 * of its in-play list. The server says so in `context.changed`.
 */
const told = async () => {
	for (let i = 0; i < 40; i += 1) {
		const said = link.received.filter((m) => m.type === "context.changed" && (!made || m.agentId === made.id)).at(-1);
		if (said && !said.inPlay.some((path) => base(path) === base(first))) return said;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return link.received.filter((m) => m.type === "context.changed").at(-1);
};
const context = await told();
say(
	"…without dropping it from the agent's context: it is held, not shown",
	Boolean(context) && context.boards.some((path) => base(path) === base(first)) && !context.inPlay.some((path) => base(path) === base(first)),
	JSON.stringify(context && { boards: context.boards, inPlay: context.inPlay }),
);
await page.mouse.move(800, 500);

// The agent this check made is its own: removed, so the checks after it see the deck they expect.
if (made) link.send({ type: "agent.remove", id: made.id });
await new Promise((resolve) => setTimeout(resolve, 300));
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
