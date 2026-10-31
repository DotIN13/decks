/**
 * A board left on a friend's shared canvas, drawn as its picture.
 *
 * Boards are retired: the deck's own canvases hold cards, and a migration turns every board on them
 * into one. A friend's canvas is theirs and is never rewritten, so a board on it stays a board, and
 * the canvas draws it as a picture the server takes of it, never as a page that runs. The fixture's
 * one leftover board is `shared/canvases/ada/old-notes/boards/notes.html`, on Ada's view-only canvas.
 */
import { canvasFrame, open, rest, say, settle, SHARED_BOARD, SHARED_CANVAS, socket } from "../harness.mjs";

const link = await socket();
const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const agent = await until(() => link.last("agents")?.focused);
link.send({ type: "agent.stage", id: agent, stage: SHARED_CANVAS });
const opened = await until(() => link.received.some((m) => m.type === "stage.pen" && m.agentId === agent && m.stage === SHARED_CANVAS));
say("the focused agent opens the friend's canvas", !!opened);
link.close();

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 }).catch(() => {});
const canvas = await canvasFrame(page);
const listed = await canvas.waitForFunction((path) => (window.__decksCards?.() ?? []).some((one) => one.path === path), SHARED_BOARD, { timeout: 15000 }).then(() => true, () => false);
say("the board is on the canvas", listed, JSON.stringify(await canvas.evaluate(() => (window.__decksCards?.() ?? []).map((one) => one.path))));

// A picture, never a page: no frame and no card root for it.
const live = await canvas.evaluate((path) => {
	const node = document.querySelector(`.card-node[data-path="${CSS.escape(path)}"]`);
	return { node: !!node, frame: !!node?.querySelector("iframe"), host: !!node?.querySelector(".card-host") };
}, SHARED_BOARD);
say("it runs no page of its own: no frame, no card", !live.frame && !live.host, JSON.stringify(live));

// Its picture comes from the server, and the engine holds it to draw where the board is.
const held = await until(() => canvas.evaluate((path) => window.__decksRust?.heldWidth?.get(`card:${path}`) ?? 0, SHARED_BOARD));
say("its picture is fetched and held by the engine", held > 0, `${held}px wide`);
await settle(page, 800);
const under = await canvas.evaluate((path) => {
	const r = (window.__decksCards?.() ?? []).find((one) => one.path === path)?.rect;
	if (!r) return null;
	const x = r.x + r.width / 2;
	const y = r.y + r.height / 2;
	const node = document.elementFromPoint(x, y)?.closest(".card-node");
	return { picture: window.__decksPictureAt?.(x, y) ?? null, node: node?.dataset.path ?? null, inert: node?.dataset.inert ?? null };
}, SHARED_BOARD);
// Below the live zoom the stage finds the picture; above it the board's slot is there, inert: it shows the picture and runs nothing.
say("what is under its middle is the board's picture", under?.picture === SHARED_BOARD || (under?.node === SHARED_BOARD && under.inert === "true"), JSON.stringify(under));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
