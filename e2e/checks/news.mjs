/**
 * The dot on the sidebar's Boards tab: what makes a board news, and what clears it.
 *
 * The rule is unit-tested (`dispatch-view.test.ts`) and the stamping is (`wrote.test.ts`), so
 * what is left for a browser is the part a person actually sees:
 *
 * - a board written from outside the app is news, and the Boards tab carries a dot for it;
 * - reading the board's preview clears it, which is the read stamp doing its work;
 * - writing the board again brings the dot back.
 *
 * The gallery that used to draw a card per board, with a spine, a ring and a chip, is gone:
 * the sidebar's Boards tab is the one list of boards on both surfaces, and the dot on its tab
 * is the one mark the dashboard has for news.
 *
 * The fixture's own boards arrive with a fresh copy's timestamps, so every one of them starts
 * out looking new. They are read first, over the wire, which both clears them and proves that a
 * read clears a mark: after that the only news is the board this check writes.
 */
import { rmSync } from "node:fs";
import { boardPath, deckState, open, say, settle, socket, write, WEB } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.goto(`${WEB}/#/canvases`, { waitUntil: "load" });
await page.waitForSelector(".dispatch");
await settle(page, 1200);
const LINK = await socket();

await page.locator('.panel-shell [role="tab"]', { hasText: "Boards" }).click();
await settle(page, 400);

const dot = () => page.evaluate(() => document.querySelectorAll('.panel-shell [role="tab"] .dispatch-tab-dot').length);
const wait = async (read, want, tries = 40, step = 250) => {
	let last = await read();
	for (let i = 0; i < tries && !want(last); i++) {
		await settle(page, step);
		last = await read();
	}
	return last;
};

const PROBE = "news-probe";
const file = await boardPath(`${PROBE}.html`);
const body = (title) => `<!doctype html>\n<html lang="en">\n\t<head>\n\t\t<meta charset="utf-8" />\n\t\t<title>${title}</title>\n\t\t<meta name="board" content='{"w":880,"h":400,"bg":"grid"}' />\n\t</head>\n\t<body class="board"><div class="text" data-id="t" style="left:24px;top:24px;width:400px">${title}</div></body>\n</html>\n`;

// Everything the fixture copied is read, so the only news left is what this check makes.
const deck = await deckState();
for (const board of deck.boards) LINK.send({ type: "board.seen", path: board.path });
say("reading every board over the wire takes the dot off the Boards tab", (await wait(dot, (n) => n === 0)) === 0, `${await dot()}`);
say("…and the dashboard has no Boards tab of its own to carry one", (await page.locator('.pill [role="tab"]', { hasText: "Boards" }).count()) === 0);

// --- a board written from outside the app is news -------------------------------------
write(file, body("A board written by a script"));
say("a board written from outside the app is news: the Boards tab carries a dot", (await wait(dot, (n) => n === 1)) === 1, `${await dot()}`);
const row = page.locator(".panel-shell .board-row", { hasText: PROBE });
say("…and the board is a row in the sidebar's list", (await wait(() => row.count(), (n) => n === 1)) === 1);

// --- reading it is what clears it ----------------------------------------------------
await row.first().click();
await page.waitForSelector(".dispatch-preview-frame");
say("opening the preview reads the board, and the dot goes", (await wait(dot, (n) => n === 0)) === 0, `${await dot()}`);
await page.keyboard.press("Escape");
await settle(page, 400);

// --- and writing it again brings it back --------------------------------------------
write(file, body("A board written by a script, again"));
say("a board written again after being read is news again", (await wait(dot, (n) => n === 1)) === 1, `${await dot()}`);

// The probe is the check's own board: the next check should not find it.
rmSync(file, { force: true });
LINK.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
