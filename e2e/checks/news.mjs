/**
 * The mark on a gallery card: what makes a board news, and what the mark is made of.
 *
 * The rule is unit-tested (`dispatch-view.test.ts`) and the stamping is (`wrote.test.ts`), so
 * what is left for a browser is the part a person actually sees:
 *
 * - a board written from outside the app is news, with all four carriers drawn: the accent
 *   spine, the accent frame and its ring, the chip that says how long ago, the count on its
 *   shelf, and the dot on the Boards tab;
 * - reading the card's preview clears every one of them, which is the read stamp doing its
 *   work rather than a local recolor;
 * - writing the board again brings them back, and pulses once while somebody is looking;
 * - a board read since its last act is not marked, which is what makes the shelf worth reading.
 *
 * The fixture's own boards arrive with a fresh copy's timestamps, so every one of them starts
 * out looking new. They are read first, over the wire, which both clears them and proves that a
 * read clears a mark: after that the only marked card is the one this check writes.
 */
import { rmSync } from "node:fs";
import { boardPath, deckState, open, say, settle, socket, write, WEB } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.goto(`${WEB}/#/boards`, { waitUntil: "load" });
await page.waitForSelector(".dispatch");
await settle(page, 1200);
const LINK = await socket();

/* The deck has no workspaces in a bare fixture, so the shelf holding an unheld board starts
   folded. Unfold every shelf: a folded one draws no cards at all. Re-queried each time, because
   a press on one head re-renders the shelf under it. */
const unfold = async () => {
	for (let i = 0; i < 8; i++) {
		const head = page.locator('.dispatch-shelf[data-folded="true"] .dispatch-shelf-head').first();
		if ((await head.count()) === 0) break;
		await head.click();
		await settle(page, 300);
	}
};
await unfold();

/** One card's state, as the DOM and the cascade report it. */
const cardState = (name) =>
	page.evaluate((wanted) => {
		const card = [...document.querySelectorAll(".dispatch-card")].find((one) => one.querySelector(".dispatch-card-name")?.textContent === wanted);
		if (!card) return null;
		const pic = card.querySelector(".dispatch-card-pic");
		const spine = getComputedStyle(pic, "::before");
		const shelf = card.closest(".dispatch-shelf");
		const count = shelf?.querySelector(".dispatch-shelf-changed");
		return {
			changed: card.getAttribute("data-changed"),
			chip: card.querySelector(".dispatch-chip")?.textContent?.trim() ?? "",
			border: getComputedStyle(pic).borderColor,
			ring: getComputedStyle(pic).boxShadow,
			spine: `${spine.width} ${spine.backgroundColor}`,
			shelfName: shelf?.querySelector(".dispatch-shelf-name")?.textContent ?? "",
			shelfCount: count?.textContent?.trim() ?? "",
			shelfAny: count?.getAttribute("data-any") ?? "",
			shelfColor: count ? getComputedStyle(count).color : "",
		};
	}, name);

const marked = () => page.evaluate(() => [...document.querySelectorAll('.dispatch-card[data-changed="true"]')].map((one) => one.querySelector(".dispatch-card-name")?.textContent ?? ""));
const dot = () => page.evaluate(() => document.querySelectorAll(".pill .dispatch-tab-dot").length);
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
const body = (title) => `<!doctype html>\n<html lang="en">\n\t<head>\n\t\t<meta charset="utf-8" />\n\t\t<title>${title}</title>\n\t\t<meta name="board" content='{"w":880,"h":400,"bg":"grid"}' />\n\t\t<link rel="stylesheet" href="../lib/board.css" />\n\t</head>\n\t<body class="board">\n\t\t<section class="card" data-id="note" style="left: 48px; top: 48px; width: 400px">\n\t\t\t<p>Written from outside the app, so the file is the only thing that says it changed.</p>\n\t\t</section>\n\t</body>\n</html>\n`;

// Everything the fixture copied is read, so the only news left is what this check makes.
const deck = await deckState();
for (const board of deck.boards) LINK.send({ type: "board.seen", path: board.path });
const cleared = await wait(marked, (list) => list.length === 0);
say("reading every board over the wire clears every mark", cleared.length === 0, JSON.stringify(cleared));
say("…and takes the count off the shelf, and the dot off the tab", (await dot()) === 0);

// --- a board written from outside the app is news -------------------------------------
write(file, body("A board written by a script"));
const news = await wait(() => cardState(PROBE), (one) => one !== null);
say("a board written from outside the app is news", news?.changed === "true", JSON.stringify(news));
say("…and it is the only card marked", (await marked()).length === 1, JSON.stringify(await marked()));

const plainName = await page.evaluate(() => [...document.querySelectorAll(".dispatch-card")].find((one) => one.getAttribute("data-changed") !== "true")?.querySelector(".dispatch-card-name")?.textContent ?? "");
const plain = await cardState(plainName);
say("the card says how long ago, and has no byline, so the chip carries only the news", /^changed (now|\d+[mhd])$/.test(news?.chip ?? ""), `${news?.chip} on ${PROBE}, ${plain?.chip} on ${plainName}`);
say("the picture's frame is no longer the line colour", news?.border !== plain?.border, `${news?.border} vs ${plain?.border}`);
say("…and it carries a ring the plain card does not", /3px/.test(news?.ring ?? "") && !/3px/.test(plain?.ring ?? ""), `${news?.ring} vs ${plain?.ring}`);
say("…and a spine down its left edge, in the accent colour", /^3px rgb/.test(news?.spine ?? "") && !/(0, 0, 0, 0)$/.test(news?.spine ?? ""), news?.spine);
say("the shelf says how many of its cards are news", news?.shelfAny === "true" && /^[1-9]\d* changed$/.test(news.shelfCount), JSON.stringify(news));
say("…in the accent colour, which is the spine's own colour", news?.shelfColor === (news?.spine ?? "").split(" ").slice(1).join(" "), `${news?.shelfColor} vs ${news?.spine}`);
say("the Boards tab carries a dot when something is news", (await dot()) === 1);

// --- reading it is what clears it ----------------------------------------------------
await page.locator(".dispatch-card", { hasText: PROBE }).first().locator(".dispatch-card-open").click();
await page.waitForSelector(".dispatch-preview-frame");
const after = await wait(() => cardState(PROBE), (one) => one?.changed === "false");
say("opening the preview reads the board, and the mark goes", after?.changed === "false", JSON.stringify(after));
say("…and the count and the dot go with it", (await dot()) === 0 && after?.shelfAny === "false", `${after?.shelfCount} / dot ${await dot()}`);
await page.keyboard.press("Escape");
await settle(page, 400);

// --- and writing it again brings it back, visibly arriving ---------------------------
write(file, body("A board written by a script, again"));
const again = await wait(() => cardState(PROBE), (one) => one?.changed === "true");
say("a board written again after being read is news again", again?.changed === "true", JSON.stringify(again));
/* The one pulse is for a mark that arrives under a reader's eyes, and it lasts a second: poll
   for it rather than waiting a fixed step past it. */
let arrived = "false";
for (let i = 0; i < 20 && arrived !== "true"; i++) {
	arrived = await page.evaluate((name) => [...document.querySelectorAll(".dispatch-card")].find((one) => one.querySelector(".dispatch-card-name")?.textContent === name)?.getAttribute("data-arrived") ?? "false", PROBE);
	if (arrived !== "true") await settle(page, 80);
}
say("…and it pulses once, because somebody was looking when it arrived", arrived === "true", arrived);

// The probe is the check's own board: the next check should not find it.
rmSync(file, { force: true });
LINK.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
