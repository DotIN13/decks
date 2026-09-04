/**
 * The mark in the tab strip, and the three things that happen when an agent wants you.
 *
 * Almost everything here is invisible until it is broken, which is the whole reason it is
 * checked in a browser rather than left to the unit tests. `alerts.test.ts` already asserts
 * the *policy* — that arriving at idle is an event and being idle is not, that a banner is
 * suppressed while the page is in view — with no DOM anywhere near it. What that cannot
 * reach is whether the policy is wired to anything: whether a frame off the socket actually
 * reaches `raise`, whether the favicon element is swapped in a way the browser repaints, and
 * whether the icons the `<head>` promises are files the server will serve.
 *
 * The socket is driven directly. Every alert here would otherwise need a real agent, a model
 * and a minute of waiting per assertion, and the interesting cases — the same state twice,
 * a window that is not focused — cannot be produced on demand at all.
 */
import { open, say, settle, WEB } from "../harness.mjs";

const { browser, page, errors } = await open();

/*
 * Wrap the socket and the audio context before the app starts.
 *
 * `window.__ws` is how a frame is delivered; `window.__notes` records every oscillator the
 * app starts, which is the only observable evidence that a cue played — an `AudioContext` in
 * headless Chromium makes no sound and reports nothing about what it was asked to make.
 */
await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const RealSocket = window.WebSocket;
	window.WebSocket = class extends RealSocket {
		constructor(...args) {
			super(...args);
			window.__ws = this;
		}
	};
	window.__notes = [];
	const RealAudio = window.AudioContext;
	window.AudioContext = class extends RealAudio {
		constructor(...args) {
			super(...args);
			const make = this.createOscillator.bind(this);
			this.createOscillator = () => {
				const osc = make();
				const start = osc.start.bind(osc);
				osc.start = (...at) => {
					window.__notes.push(Math.round(osc.frequency.value));
					return start(...at);
				};
				return osc;
			};
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2000);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const tab = () =>
	page.evaluate(() => ({
		title: document.title,
		icon: document.head.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute("href"),
		notes: window.__notes.length,
	}));
/** Pretend the window went behind another one. `hasFocus` is a function, so it can be told. */
const leave = () => page.evaluate(() => ((document.hasFocus = () => false), window.dispatchEvent(new Event("blur"))));
const comeBack = () => page.evaluate(() => ((document.hasFocus = () => true), window.dispatchEvent(new Event("focus"))));

// --- what the head promises, and what the server has ---------------------------------

const head = await page.evaluate(() => ({
	svg: document.head.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute("href"),
	png: document.head.querySelector('link[rel="icon"][type="image/png"]')?.getAttribute("href"),
	apple: document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
	manifest: document.head.querySelector('link[rel="manifest"]')?.getAttribute("href"),
	themes: [...document.head.querySelectorAll('meta[name="theme-color"]')].map((meta) => meta.getAttribute("media")),
}));
say("the page has an SVG favicon", head.svg === "/favicon.svg", head.svg);
say("…a raster fallback for the browsers that ignore it", head.png === "/favicon-32.png", head.png);
say("…an apple-touch icon, for a deck added to a home screen", head.apple === "/apple-touch-icon.png", head.apple);
say("…and a manifest", head.manifest === "/site.webmanifest", head.manifest);
say("a theme colour per scheme, not one for both", head.themes.length === 2 && head.themes.every((media) => /prefers-color-scheme/.test(media ?? "")), JSON.stringify(head.themes));

/*
 * Every icon the head or the manifest names is fetched, because a 404 favicon is invisible:
 * the browser silently falls back to a blank page glyph and nothing is logged.
 */
const manifest = await (await fetch(`${WEB}/site.webmanifest`)).json();
const named = [head.svg, head.png, head.apple, "/favicon-badge.svg", ...manifest.icons.map((icon) => icon.src)];
const missing = [];
for (const path of [...new Set(named)]) {
	const response = await fetch(`${WEB}${path}`);
	if (!response.ok) missing.push(`${path} → ${response.status}`);
}
say("every icon named anywhere is a file the server has", missing.length === 0, missing.join(", "));
say("the manifest is a standalone app called Decks", manifest.name === "Decks" && manifest.display === "standalone", `${manifest.name} / ${manifest.display}`);

const start = await tab();
say("the tab is called Decks, with nothing on it", start.title === "Decks" && start.icon === "/favicon.svg", `${start.title} ${start.icon}`);

// --- an agent finishing while you are elsewhere ---------------------------------------

await leave();
await settle(page, 150);
await feed({ type: "agent.state", id: "probe", state: "streaming" });
await settle(page, 120);
await feed({ type: "agent.state", id: "probe", state: "idle" });
await settle(page, 400);

const first = await tab();
say("finishing counts the tab up", first.title === "(1) Decks", first.title);
say("…and puts a dot on the mark", first.icon === "/favicon-badge.svg", first.icon);
say("…and plays a cue", first.notes > 0, `${first.notes} oscillators`);

// Being told "idle" again is not finishing again. This is what a reconnection looks like,
// and it is why the rule is written on the transition rather than on the value.
await feed({ type: "agent.state", id: "probe", state: "idle" });
await settle(page, 300);
say("being told it is idle a second time is not a second finish", (await tab()).title === "(1) Decks", (await tab()).title);

await feed({ type: "agent.state", id: "probe", state: "tool" });
await settle(page, 100);
await feed({ type: "agent.state", id: "probe", state: "idle" });
await settle(page, 300);
say("a real second finish does count", (await tab()).title === "(2) Decks", (await tab()).title);

await comeBack();
await settle(page, 300);
const back = await tab();
say("coming back to the window is reading it", back.title === "Decks" && back.icon === "/favicon.svg", `${back.title} ${back.icon}`);

// --- in view: the cue plays, the tab stays clean --------------------------------------

const before = (await tab()).notes;
await feed({ type: "agent.state", id: "probe", state: "thinking" });
await settle(page, 100);
await feed({ type: "agent.state", id: "probe", state: "idle" });
await settle(page, 400);
const seen = await tab();
say("a cue still plays when you are looking", seen.notes > before, `${before} → ${seen.notes}`);
say("…but nothing is counted, because you saw it", seen.title === "Decks" && seen.icon === "/favicon.svg", seen.title);

// --- the settings ---------------------------------------------------------------------

await page.locator('.pill button[aria-label="More"]').click();
await page.waitForSelector(".popover", { timeout: 4000 });
await page.locator(".popover [data-row]").filter({ hasText: /settings/i }).first().click();
await page.waitForSelector(".settings", { timeout: 6000 });
await settle(page, 500);

const grid = await page.evaluate(() => {
	const mid = (el) => {
		const box = el.getBoundingClientRect();
		return Math.round(box.left + box.width / 2);
	};
	const heads = [...document.querySelectorAll(".alerts-h")];
	return {
		heads: heads.map((el) => el.textContent),
		headMids: heads.map(mid),
		chips: [...document.querySelectorAll(".alerts > .chipbtn")].map(mid),
		switches: [...document.querySelectorAll(".alerts > .sw")].map(mid),
		kinds: [...document.querySelectorAll(".alerts-k > .lb")].map((el) => el.textContent),
		notes: [...document.querySelectorAll(".alerts-k > .nt")].length,
		perm: document.querySelector(".alerts-perm")?.innerText.replace(/\s+/g, " ").trim(),
	};
});
say("Settings has a notifications section with the three kinds", grid.kinds.length === 4 && grid.kinds[3] === "Volume", JSON.stringify(grid.kinds));
say("…each with a sentence saying what it means", grid.notes === 4);
say("…and two labelled columns", JSON.stringify(grid.heads) === JSON.stringify(["Sound", "Banner"]), JSON.stringify(grid.heads));
/*
 * The columns have to line up with what is under them, or the heading is decoration: a
 * switch beside a dropdown could plausibly mean either, and this is the only thing that says
 * which. One pixel of slack for a sub-pixel grid track.
 */
say(
	"…that line up with the controls under them",
	grid.chips.every((x) => Math.abs(x - grid.headMids[0]) <= 1) && grid.switches.every((x) => Math.abs(x - grid.headMids[1]) <= 1),
	`sound ${grid.headMids[0]} vs ${grid.chips.join()} · banner ${grid.headMids[1]} vs ${grid.switches.join()}`,
);
say("…and a line about whether a banner can appear at all", /banner/i.test(grid.perm ?? ""), grid.perm);

// Picking a sound writes the preference and previews it.
const wasNotes = (await tab()).notes;
await page.locator(".alerts > .chipbtn").first().click();
await page.waitForSelector(".popover", { timeout: 4000 });
const choices = await page.locator(".popover [data-row] .lb").allTextContents();
say("the sound picker offers silence first, then the cues", choices[0] === "Silent" && choices.length >= 5, choices.join(" "));
await page.locator(".popover [data-row]").filter({ hasText: /^Ping$/ }).first().click();
await settle(page, 400);
const afterPick = await page.evaluate(() => ({
	chip: document.querySelector(".alerts > .chipbtn")?.innerText.trim(),
	saved: JSON.parse(localStorage.getItem("decks.alerts") ?? "{}"),
	notes: window.__notes.length,
}));
say("picking a cue shows it on the chip", afterPick.chip === "Ping", afterPick.chip);
say("…plays it, so it can be heard before it is committed to", afterPick.notes > wasNotes, `${wasNotes} → ${afterPick.notes}`);
say("…and saves it", afterPick.saved?.sound?.done === "ping", JSON.stringify(afterPick.saved?.sound));

// Off is a real setting: the choices are kept and all three go quiet.
await page.locator(".alerts .seg > button").filter({ hasText: /^Off$/ }).click();
await settle(page, 300);
const quiet = await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem("decks.alerts") ?? "{}"), notes: window.__notes.length }));
await feed({ type: "agent.state", id: "probe", state: "tool" });
await settle(page, 100);
await feed({ type: "agent.state", id: "probe", state: "idle" });
await settle(page, 400);
const stillQuiet = await page.evaluate(() => window.__notes.length);
say("volume off silences the next cue", stillQuiet === quiet.notes, `${quiet.notes} → ${stillQuiet}`);
say("…without forgetting which cue each kind had", quiet.saved?.sound?.done === "ping" && quiet.saved?.volume === 0, JSON.stringify(quiet.saved));

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
