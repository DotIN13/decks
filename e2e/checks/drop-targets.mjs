/**
 * Files dropped where they were never taken before — the input bar and bare canvas — and the
 * mention that would not go away.
 *
 * The mention first, because it is a report: a file attached with the paperclip put
 * `@assets/…` in the input bar, and after the message was sent the mention came back into the
 * emptied field, and came back again after switching agent. The composer's draft was never
 * forgotten, and its effect re-ran with the same stale draft whenever a focus listener it had
 * picked up by accident changed. So this sends, waits, switches away and back, and looks.
 *
 * Then the two drops. On the input bar a file is copied into the deck and mentioned where the
 * caret was, beside what was already typed. On empty canvas it gets a board of its own, centred
 * where it landed, holding the file as a component.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { deckState, newAgent, open, openAgents, say, settle } from "../harness.mjs";

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAABgAAAAwCAIAAACE6i30AAAAK0lEQVR4nO3MMQ0AAAgDsMlBE9oRg4mdTXo3t1MRkUgkEolEIpFIJBI1oweXkCdb46qvjQAAAABJRU5ErkJggg==";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const deck = await deckState();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
/** The board the canvas drop makes, which this check clears so the checks after it see their own deck. */
let made = null;
const field = () => page.evaluate(() => document.querySelector(".dockfield")?.value ?? null);

/** Drop files on whatever is at a point, the way a desktop drag delivers them. */
const dropAt = (at, files) =>
	page.evaluate(
		({ at, files }) => {
			const transfer = new DataTransfer();
			for (const file of files) {
				const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
				transfer.items.add(new File([bytes], file.name, { type: file.type ?? "" }));
			}
			const target = document.elementFromPoint(at.x, at.y) ?? document.body;
			for (const type of ["dragenter", "dragover", "drop"]) {
				target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
			}
		},
		{ at, files },
	);
const centreOf = (selector) =>
	page.evaluate((selector) => {
		const box = document.querySelector(selector)?.getBoundingClientRect();
		return box ? { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) } : null;
	}, selector);
const switchTo = async (index) => {
	await openAgents(page);
	await page.locator('.popover [data-row][data-flat="true"]').nth(index).click();
	await settle(page, 1000);
};

try {
	await newAgent(page);
	await settle(page, 800);
	await newAgent(page);
	await settle(page, 800);

	// --- the report: attached, sent, and back it came ------------------------------------
	await page.locator('button[aria-label="Attach a file"]').first().click();
	await settle(page, 500);
	const attached = `attached-${unique()}.txt`;
	await page.locator('input[type="file"]').first().setInputFiles({ name: attached, mimeType: "text/plain", buffer: Buffer.from(`attached ${unique()}\n`) });
	await page.waitForFunction((name) => document.querySelector(".dockfield")?.value.includes(name), attached, { timeout: 15000 });
	const mentioned = await field();
	say("the paperclip mentions the file by its deck path", mentioned?.startsWith(`@assets/${attached}`) === true, JSON.stringify(mentioned));
	await page.locator(".dockfield").click();
	await page.keyboard.press("End");
	await page.keyboard.type("look at this");
	await page.keyboard.press("Enter");
	await settle(page, 2500);
	say("after sending, the mention is gone and stays gone", (await field()) === "", JSON.stringify(await field()));
	await switchTo(0);
	await switchTo(1);
	await switchTo(0);
	say("switching agent does not bring it back", (await field()) === "", JSON.stringify(await field()));

	// --- a file dropped on the input bar ---------------------------------------------------
	await page.locator(".dockfield").click();
	await page.keyboard.type("see");
	const note = `note-${unique()}.txt`;
	const bar = await centreOf(".dockbox");
	await dropAt(bar, [{ name: note, type: "text/plain", base64: Buffer.from(`note ${unique()}\n`).toString("base64") }]);
	await page.waitForFunction((name) => document.querySelector(".dockfield")?.value.includes(name), note, { timeout: 15000 });
	const withNote = await field();
	say("a file dropped on the input bar is copied in and mentioned after what was typed", withNote === `see @assets/${note} `, JSON.stringify(withNote));
	say("…and the bar says it will take a file only while one is over it", (await page.locator('.dockbox[data-dropping="true"]').count()) === 0);
	await page.keyboard.press("Escape");
	await settle(page, 1500);
	say("a mention cleared by Escape does not come back", (await field()) === "", JSON.stringify(await field()));

	// --- a file dropped on empty canvas -----------------------------------------------------
	const empty = await page.evaluate(() => {
		const stage = document.querySelector(".stage")?.getBoundingClientRect();
		if (!stage) return null;
		for (let y = stage.top + 120; y < stage.bottom - 160; y += 40) {
			for (let x = stage.left + 160; x < stage.right - 160; x += 40) {
				const hit = document.elementFromPoint(x, y);
				if (!hit || hit.closest(".board-node, .dock, .dockbox, .popover, .pill, [data-inset], button, input, textarea")) continue;
				if (hit.closest(".stage")) return { x: Math.round(x), y: Math.round(y) };
			}
		}
		return null;
	});
	say("there is empty canvas to drop on", Boolean(empty), JSON.stringify(empty));
	const picture = `picture-${unique()}.png`;
	await dropAt(empty, [{ name: picture, type: "image/png", base64: PNG }]);
	const boardNamed = async (name) => {
		const answer = await fetch("/api/deck").then((response) => response.json());
		return (answer.deck?.boards ?? answer.boards ?? []).find((board) => board.title === name)?.path ?? null;
	};
	made = await page
		.waitForFunction(boardNamed, picture, { timeout: 20000, polling: 500 })
		.then(() => page.evaluate(boardNamed, picture))
		.catch(() => null);
	say("a file dropped on empty canvas becomes a board named after it", typeof made === "string", String(made));
	if (typeof made === "string") {
		// The upload and the insert follow the board, so wait for the file to be written into it.
		const holds = await page
			.waitForFunction(
				async ({ path, name }) => (await fetch(`/api/board/${path}`).then((response) => response.text())).includes(`assets/${name}`),
				{ path: made, name: picture },
				{ timeout: 20000, polling: 500 },
			)
			.then(() => true)
			.catch(() => false);
		const source = await page.evaluate(async (path) => fetch(`/api/board/${path}`).then((response) => response.text()), made);
		say("…holding the file as a component", holds && source.includes(`data-embed="../assets/${picture}"`), source.slice(0, 240));
		await settle(page, 1200);
		const underDrop = await page.evaluate(({ at, path }) => document.elementFromPoint(at.x, at.y)?.closest(".board-node")?.getAttribute("data-path") === path, { at: empty, path: made });
		say("…centred where it was dropped", underDrop, `${made} under ${JSON.stringify(empty)}`);
	}

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
	if (typeof made === "string") rmSync(join(deck.path, made), { force: true });
}
