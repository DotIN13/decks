import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Page } from "@decks/protocol";
import { pageClip, THUMB_WIDTH, thumbName, PictureService } from "./service.ts";

/**
 * The picture service, with a browser that is a list of what it was asked.
 *
 * What is worth holding still is the scheduling, because it is the part with no picture to
 * look at: two at a time, the newest request first, one picture for everybody who asked for
 * the same one, nothing drawn for a browser that has gone, and a machine with no Chromium
 * refusing at once rather than once per card.
 */
type Browser = import("playwright").Browser;

const board = (path: string, rev = 1, w = 1000, h = 2000): Page => ({ path, rev, w, h, title: path, x: 0, y: 0, inContext: [] }) as Page;

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
				setViewportSize: async () => {},
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

test("a card is laid out and pictured at its full width and its own height, up to a limit", () => {
	assert.deepEqual(pageClip({ w: 1000, h: 3000 }), { width: 1000, height: 3000 });
	assert.deepEqual(pageClip({ w: 960, h: 50_000 }), { width: 960, height: 12_000 });
	assert.equal(THUMB_WIDTH, 720, "in every picture's name: changing it remakes every picture");
});

test("a picture's name is safe for a file system and changes with the revision and the scheme", () => {
	const name = thumbName("boards/深海/plan one.html", 7, "light");
	assert.match(name, /^[0-9a-f]{16}-7-light-720-whole-l\d+\.webp$/);
	assert.notEqual(name, thumbName("boards/深海/plan one.html", 8, "light"));
	assert.notEqual(name, thumbName("boards/深海/plan one.html", 7, "dark"));
});

test("two at a time, the newest request first, and the picture is kept on disk", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
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
	assert.deepEqual(chrome.opened[0]?.viewport, { width: 1000, height: 2000 });
	assert.deepEqual(chrome.clips, [2000, 2000, 2000, 2000], "a card is pictured at its own height");

	// Asked again: answered from the disk, with no page.
	const before = chrome.opened.length;
	assert.equal(await thumbs.get(board("boards/a.html"), "light"), files[0]);
	assert.equal(chrome.opened.length, before);
	thumbs.dispose();
});

test("everybody asking for one picture shares one page, and a newer revision removes the older picture", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
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
	// The whole picture of revision 2, and the rungs cut from it; nothing of revision 1.
	assert.deepEqual(readdirSync(dir).filter((name) => !/-whole-w\d+/.test(name)), [thumbName("boards/a.html", 2, "dark")]);
	assert.ok(readdirSync(dir).every((name) => name.includes("-2-dark-")));
	thumbs.dispose();
});

test("a request whose browser has gone is not drawn", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
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
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir }, async () => {
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
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir, settleMs: 10 }, async () => chrome.browser);

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
	// Retaken as its far rungs, of revision 4; the whole picture of revision 1 stays to stand in until a whole one is asked for.
	assert.deepEqual(readdirSync(dir).sort(), [thumbName("boards/a.html", 1, "dark"), ...[192, 480].map((width) => thumbName("boards/a.html", 4, "dark", "small", width))].sort());
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
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
	const both = [thumbs.get(board("boards/a.html"), "light"), thumbs.get(board("boards/b.html"), "dark")];
	await tick();
	await chrome.release();
	await chrome.release();
	await Promise.all(both);
	thumbs.forget("boards/a.html");
	assert.deepEqual(readdirSync(dir).filter((name) => !/-whole-w\d+/.test(name)), [thumbName("boards/b.html", 1, "dark")]);
	thumbs.dispose();
});

test("a flow document is measured in the page and pictured to that height, without changing the board's size", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir }, async () => chrome.browser);
	// The record still carries the 240px placeholder; the page says 1234.
	const flow = board("boards/notes.html", 3, 720, 240);
	const asked = thumbs.get(flow, "light");
	await tick();
	await chrome.release();
	await asked;
	assert.deepEqual(chrome.opened[0]?.viewport, { width: 720, height: 540 }, "laid out in a window no shorter than three quarters of its width");
	assert.deepEqual(chrome.clips, [1234], "pictured to the height its page measured");
	assert.equal(flow.h, 240, "the board keeps the size its file states");
	thumbs.dispose();
});

test("each rung of the ladder has a name of its own beside the whole picture", async () => {
	const whole = thumbName("boards/a.html", 3, "light", "whole");
	const rungs = [192, 480, 800].map((width) => thumbName("boards/a.html", 3, "light", "small", width));
	assert.equal(new Set([whole, ...rungs]).size, 4);
	assert.match(rungs[2]!, /-whole-w800-l\d+\.webp$/);
});

test("what stands in for a picture: this revision at the nearest size, else the newest earlier revision", () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir }, async () => fake().browser);
	const a = board("boards/a.html", 4);
	assert.equal(thumbs.nearest(a, "light", 192), undefined, "nothing at all: the caller waits");
	// An earlier revision's whole picture, from before a look change.
	const old = join(dir, thumbName("boards/a.html", 3, "light", "whole").replace(/-l\d+\.webp$/, ".jpg"));
	writeFileSync(old, "old");
	assert.deepEqual(thumbs.nearest(a, "light", 192), { file: old, exact: false });
	assert.equal(thumbs.nearest(a, "dark", 192), undefined, "another scheme's picture does not stand in");
	// This revision's 480 beats any earlier revision, for a 192 and for the whole picture alike.
	const whole = thumbName("boards/a.html", 4, "light", "whole");
	const at480 = join(dir, thumbName("boards/a.html", 4, "light", "small"));
	writeFileSync(at480, "480");
	assert.deepEqual(thumbs.nearest(a, "light", 192), { file: at480, exact: false });
	assert.deepEqual(thumbs.nearest(a, "light", "whole"), { file: at480, exact: false });
	assert.deepEqual(thumbs.nearest(a, "light", 480), { file: at480, exact: true });
	// Of this revision's, the smallest at least the size asked for.
	writeFileSync(join(dir, whole), "whole");
	assert.deepEqual(thumbs.nearest(a, "light", 192), { file: at480, exact: false });
	assert.deepEqual(thumbs.nearest(a, "light", "whole"), { file: join(dir, whole), exact: true });
	thumbs.dispose();
});

test("a whole picture somebody asks for is taken before the background's small ones", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const boards = ["a", "b", "c", "d"].map((n) => board(`boards/${n}.html`));
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir, boards: () => boards }, async () => chrome.browser);
	const sweep = thumbs.index();
	await tick();
	const asked = thumbs.picture(board("boards/z.html"), "light", "whole");
	// The two pages open are the background's; the next one opened is the one asked for.
	await chrome.release();
	await tick();
	assert.match(chrome.opened.at(-1)!.url, /z\.html$/);
	let done = false;
	void Promise.all([sweep, asked]).then(() => (done = true));
	for (let i = 0; i < 40 && !done; i++) await chrome.release();
	await asked;
	thumbs.dispose();
});

test("the indexer takes every board's small pictures, not its whole one, and says how far it has got", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thumbs-"));
	const chrome = fake();
	const boards = [board("boards/a.html"), board("boards/b.html"), board("boards/c.html")];
	const thumbs = new PictureService({ origin: () => "http://127.0.0.1:1", dir, boards: () => boards }, async () => chrome.browser);
	assert.deepEqual(thumbs.progress(), { total: 3, ready: 0, working: false, failed: 0 });
	const sweep = thumbs.index();
	await tick();
	assert.equal(thumbs.progress().working, true);
	// Two pages at a time, behind anything a browser asks for.
	assert.ok(chrome.most() <= 2);
	let done = false;
	void sweep.then(() => (done = true));
	for (let i = 0; i < 20 && !done; i++) await chrome.release();
	await sweep;
	assert.deepEqual(thumbs.progress(), { total: 3, ready: 3, working: false, failed: 0 });
	for (const one of boards) {
		const whole = thumbName(one.path, one.rev, "light", "whole");
		assert.ok(!existsSync(join(dir, whole)), `${one.path} has no whole picture until one is asked for`);
		assert.ok(existsSync(join(dir, thumbName(one.path, one.rev, "light", "small"))), `${one.path} has its 480 px picture`);
		assert.ok(readdirSync(dir).some((name) => name.startsWith(whole.replace(/-whole-l\d+\.\w+$/, "-whole-w192"))), `${one.path} has its 192 px copy`);
	}
	// Nothing missing: a second sweep takes nothing.
	const before = chrome.opened.length;
	await thumbs.index();
	assert.equal(chrome.opened.length, before);
});
