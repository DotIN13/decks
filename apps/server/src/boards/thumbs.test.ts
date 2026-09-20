import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Board } from "@decks/protocol";
import { THUMB_WIDTH, thumbClip, thumbName, ThumbService } from "./thumbs.ts";

/**
 * The picture service, with a browser that is a list of what it was asked.
 *
 * What is worth holding still is the scheduling, because it is the part with no picture to
 * look at: two at a time, the newest request first, one picture for everybody who asked for
 * the same one, nothing drawn for a browser that has gone, and a machine with no Chromium
 * refusing at once rather than once per card.
 */
type Browser = import("playwright").Browser;

const board = (path: string, rev = 1, w = 1000, h = 2000): Board => ({ path, rev, w, h, title: path, x: 0, y: 0, inContext: [], format: "component" }) as unknown as Board;

function fake() {
	const opened: Array<{ url: string; viewport: unknown; scale: unknown; scheme: unknown }> = [];
	const clips: number[] = [];
	const gates: Array<() => void> = [];
	let live = 0;
	let most = 0;
	const browser = {
		newContext: async (options: { viewport: unknown; deviceScaleFactor: unknown; colorScheme: unknown }) => ({
			newPage: async () => ({
				goto: async (url: string) => {
					opened.push({ url, viewport: options.viewport, scale: options.deviceScaleFactor, scheme: options.colorScheme });
					live++;
					most = Math.max(most, live);
					await new Promise<void>((resolve) => gates.push(resolve));
				},
				waitForFunction: async () => {},
				evaluate: async () => 1234,
				screenshot: async (options: { clip: { height: number } }) => {
					clips.push(options.clip.height);
					return Buffer.from("jpeg");
				},
			}),
			close: async () => {
				live--;
			},
		}),
		close: async () => {},
	} as unknown as Browser;
	const release = async () => {
		gates.shift()?.();
		await new Promise((resolve) => setTimeout(resolve, 5));
	};
	return { browser, opened, clips, release, most: () => most, waiting: () => gates.length };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a card shows the board's full width and as much height as 4:3 allows", () => {
	assert.deepEqual(thumbClip({ w: 1000, h: 3000 }), { width: 1000, height: 750, scale: THUMB_WIDTH / 1000 });
	assert.equal(THUMB_WIDTH, 720);
	// A slide is shorter than 4:3, and is not padded out to it.
	assert.deepEqual(thumbClip({ w: 960, h: 540 }), { width: 960, height: 540, scale: THUMB_WIDTH / 960 });
});

test("a picture's name is safe for a file system and changes with the revision and the scheme", () => {
	const name = thumbName("boards/深海/plan one.html", 7, "light");
	assert.match(name, /^[0-9a-f]{16}-7-light-720\.jpg$/);
	assert.notEqual(name, thumbName("boards/深海/plan one.html", 8, "light"));
	assert.notEqual(name, thumbName("boards/深海/plan one.html", 7, "dark"));
});

test("two at a time, the newest request first, and the picture is kept on disk", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new ThumbService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
	const asked = ["a", "b", "c", "d"].map((name) => thumbs.get(board(`boards/${name}.html`), "light"));
	await tick();
	assert.equal(chrome.waiting(), 2, "two pages are open");
	// a and b started at once, because nothing was queued then; of the two left, d is newer.
	await chrome.release();
	await chrome.release();
	await tick();
	assert.deepEqual(chrome.opened.map((one) => one.url.split("/").at(-1)), ["a.html", "b.html", "d.html", "c.html"]);
	await chrome.release();
	await chrome.release();
	const files = await Promise.all(asked);
	assert.equal(chrome.most(), 2);
	assert.ok(files.every((file) => existsSync(file) && readFileSync(file, "utf8") === "jpeg"));
	assert.equal(chrome.opened[0]?.scheme, "light");
	assert.deepEqual(chrome.opened[0]?.viewport, { width: 1000, height: 750 });
	assert.deepEqual(chrome.clips, [750, 750, 750, 750], "a component board is clipped to its own height, at most 4:3");

	// Asked again: answered from the disk, with no page.
	const before = chrome.opened.length;
	assert.equal(await thumbs.get(board("boards/a.html"), "light"), files[0]);
	assert.equal(chrome.opened.length, before);
	thumbs.dispose();
});

test("everybody asking for one picture shares one page, and a newer revision removes the older picture", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new ThumbService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
	const both = [thumbs.get(board("boards/a.html", 1), "dark"), thumbs.get(board("boards/a.html", 1), "dark")];
	await tick();
	await chrome.release();
	const [first, second] = await Promise.all(both);
	assert.equal(first, second);
	assert.equal(chrome.opened.length, 1);

	const next = thumbs.get(board("boards/a.html", 2), "dark");
	await tick();
	await chrome.release();
	await next;
	assert.deepEqual(readdirSync(dir), [thumbName("boards/a.html", 2, "dark")]);
	thumbs.dispose();
});

test("a request whose browser has gone is not drawn", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new ThumbService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
	const kept = [thumbs.get(board("boards/a.html"), "light"), thumbs.get(board("boards/b.html"), "light")];
	let gone = false;
	const left = thumbs.get(board("boards/c.html"), "light", () => gone);
	const refused = assert.rejects(left, /nobody is waiting/);
	gone = true;
	await tick();
	await chrome.release();
	await chrome.release();
	await Promise.all(kept);
	await refused;
	assert.equal(chrome.opened.length, 2);
	thumbs.dispose();
});

test("with no Chromium the first request says so, and the rest are refused at once", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	let launches = 0;
	const thumbs = new ThumbService({ origin: () => "http://127.0.0.1:1", dir }, async () => {
		launches++;
		throw new Error("Executable doesn't exist at /nowhere\nrun npx playwright install");
	});
	await assert.rejects(thumbs.get(board("boards/a.html"), "light"), /No Chromium.*Executable doesn't exist at \/nowhere$/);
	assert.equal(thumbs.available(), false);
	await assert.rejects(thumbs.get(board("boards/b.html"), "light"), /No Chromium/);
	assert.equal(launches, 1);
	thumbs.dispose();
});

test("a changed board is pictured again once it settles, in the schemes somebody has asked for, behind any browser's request", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new ThumbService({ origin: () => "http://127.0.0.1:1", dir, settleMs: 10 }, async () => chrome.browser);

	// Nobody has asked for a picture in any scheme yet, so there is nothing to keep up.
	thumbs.changed(board("boards/a.html", 1));
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(chrome.opened.length, 0);

	const first = thumbs.get(board("boards/a.html", 1), "dark");
	await tick();
	await chrome.release();
	await first;

	// Three writes in a row are one picture, of the last of them.
	thumbs.changed(board("boards/a.html", 2));
	thumbs.changed(board("boards/a.html", 3));
	thumbs.changed(board("boards/a.html", 4));
	await new Promise((resolve) => setTimeout(resolve, 30));
	await chrome.release();
	await tick();
	assert.deepEqual(readdirSync(dir), [thumbName("boards/a.html", 4, "dark")]);
	assert.equal(chrome.opened.length, 2);
	assert.equal(chrome.opened[1]?.scheme, "dark");

	// A change that is not to the file (who wrote it, when it was seen) takes no picture.
	thumbs.changed(board("boards/a.html", 4));
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(chrome.opened.length, 2);

	// With both pages busy, a browser's request goes ahead of pictures taken ahead of time.
	const busy = [thumbs.get(board("boards/x.html"), "dark"), thumbs.get(board("boards/y.html"), "dark")];
	await tick();
	thumbs.changed(board("boards/b.html", 1));
	await new Promise((resolve) => setTimeout(resolve, 30));
	const asked = thumbs.get(board("boards/c.html", 1), "dark");
	await chrome.release();
	await chrome.release();
	await Promise.all(busy);
	await tick();
	assert.deepEqual(chrome.opened.slice(4).map((one) => one.url.split("/").at(-1)), ["c.html", "b.html"]);
	await chrome.release();
	await chrome.release();
	await asked;
	thumbs.dispose();
});

test("a deleted board's pictures are deleted with it", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new ThumbService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
	const both = [thumbs.get(board("boards/a.html"), "light"), thumbs.get(board("boards/b.html"), "dark")];
	await tick();
	await chrome.release();
	await chrome.release();
	await Promise.all(both);
	thumbs.forget("boards/a.html");
	assert.deepEqual(readdirSync(dir), [thumbName("boards/b.html", 1, "dark")]);
	thumbs.dispose();
});

test("a flow document is measured in the page, pictured to that height, and the deck is told", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const told: Array<[string, number, number]> = [];
	const thumbs = new ThumbService({ origin: () => "http://127.0.0.1:1", dir, measured: (path, rev, h) => told.push([path, rev, h]) }, async () => chrome.browser);
	// The record still carries the 240px placeholder; the page says 1234.
	const flow = { ...board("boards/notes.html", 3, 720, 240), format: "board" } as Board;
	const asked = thumbs.get(flow, "light");
	await tick();
	await chrome.release();
	await asked;
	assert.deepEqual(chrome.opened[0]?.viewport, { width: 720, height: 540 }, "laid out in the tallest window a picture can be");
	assert.deepEqual(chrome.clips, [540], "1234 is taller than 4:3 allows, so the picture is 4:3");
	assert.deepEqual(told, [["boards/notes.html", 3, 1234]]);
	thumbs.dispose();
});
