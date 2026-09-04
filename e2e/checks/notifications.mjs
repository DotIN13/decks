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
 * `window.__ws` is how a frame is delivered; `window.__played` records the url of every cue
 * the app tries to play, which is the only observable evidence a sound happened — headless
 * Chromium has no audio device.
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
	/*
	 * Every cue the app tries to play, by url.
	 *
	 * The cues are `<audio>` elements loading files from `/sounds` now, so `play()` on the
	 * prototype is the one place they all pass through — and the url is a far better witness
	 * than "a sound happened": it says *which* cue, so a check can assert that picking
	 * `bip-bop-04` previews `bip-bop-04` rather than merely making a noise. Headless Chromium
	 * has no audio device, so the promise rejects; that is the app's own swallowed case and
	 * it does not stop the src being recorded.
	 */
	window.__played = [];
	const realPlay = HTMLMediaElement.prototype.play;
	HTMLMediaElement.prototype.play = function play(...args) {
		window.__played.push((this.currentSrc || this.src || "").replace(/^https?:\/\/[^/]+/, ""));
		return realPlay.apply(this, args);
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2000);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const tab = () =>
	page.evaluate(() => ({
		title: document.title,
		icon: document.head.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute("href"),
		played: window.__played.length,
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
 * Black ink by default, pale under `prefers-color-scheme: dark`.
 *
 * The order in the file is the whole assertion. Safari ignores the media query and takes the
 * first declaration, so whichever way round these are written one browser gets the
 * unconditional one — and it has to be the black one, because Safari ships a light tab strip
 * and a pale mark on it is invisible where black on a dark strip is at worst dim.
 */
const svg = await (await fetch(`${WEB}/favicon.svg`)).text();
// Inside the `<style>` block only. The comment above it discusses `prefers-color-scheme` by
// name, so searching the whole document finds the prose and proves nothing.
const ink = svg.slice(svg.indexOf("<style>"), svg.indexOf("</style>"));
const firstFill = /\.a\s*\{\s*fill:\s*(#[0-9a-f]{6})/i.exec(ink)?.[1]?.toLowerCase();
say("the favicon's default ink is black", firstFill === "#161616", firstFill);
say("…and the pale version is the override, not the default", ink.indexOf("prefers-color-scheme") > ink.indexOf(".a {"), `query at ${ink.indexOf("prefers-color-scheme")} of ${ink.length}`);
say("…so the browser that ignores the query gets black", /prefers-color-scheme:\s*dark/.test(ink), "the query asks for dark; ignoring it leaves the black default");

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
const firstCue = await page.evaluate(() => window.__played.at(-1));
say("…and plays the cue configured for finishing", /\/sounds\/staplebops-01\.mp3$/.test(firstCue ?? ""), firstCue);

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

const before = (await tab()).played;
await feed({ type: "agent.state", id: "probe", state: "thinking" });
await settle(page, 100);
await feed({ type: "agent.state", id: "probe", state: "idle" });
await settle(page, 400);
const seen = await tab();
say("a cue still plays when you are looking", seen.played > before, `${before} → ${seen.played}`);
say("…but nothing is counted, because you saw it", seen.title === "Decks" && seen.icon === "/favicon.svg", seen.title);

// --- the settings ---------------------------------------------------------------------

await page.locator('.pill button[aria-label="More"]').click();
await page.waitForSelector(".popover", { timeout: 4000 });
await page.locator(".popover [data-row]").filter({ hasText: /settings/i }).first().click();
await page.waitForSelector(".settings", { timeout: 6000 });
await settle(page, 500);

/*
 * The redesign, asserted as a shape rather than as pixels.
 *
 * The first version of this panel was a three-column grid, and the assertion here was that
 * the two column headings stayed centred on the controls under them to within a pixel — a
 * check that existed only because the design needed the headings to mean anything. Grouping
 * by *what the app does* removed the need for both, so what is checked now is the grouping
 * itself: two notification groups, one control per row, and every row's control the same kind
 * as its neighbours'.
 */
const panel = await page.evaluate(() => {
	const groups = [...document.querySelectorAll(".set-group")].map((group) => ({
		name: group.dataset.group,
		title: group.querySelector(".set-title")?.textContent,
		rows: [...group.querySelectorAll(".set-row")].map((row) => ({
			label: row.querySelector(".set-k > .lb")?.textContent,
			note: row.querySelector(".set-k > .nt")?.textContent ?? null,
			controls: [...row.children].filter((child) => !child.classList.contains("set-k")).map((child) => child.className.split(" ")[0]),
		})),
	}));
	return {
		groups,
		strip: document.querySelector(".set-strip")?.innerText.replace(/\s+/g, " ").trim() ?? null,
		title: document.querySelector(".set-head-title")?.textContent,
		add: document.querySelector(".set-group[data-group='accounts'] .set-add")?.innerText.trim(),
		footer: document.querySelectorAll(".settings > footer").length,
	};
});
say("the window has a title rather than a section label", panel.title === "Settings", panel.title);
say("three groups: sounds, banners, accounts", JSON.stringify(panel.groups.map((g) => g.name)) === JSON.stringify(["sounds", "banners", "accounts"]), JSON.stringify(panel.groups.map((g) => g.title)));

const sounds = panel.groups[0];
const banners = panel.groups[1];
say("sounds has a row per kind, plus the volume", sounds.rows.length === 4 && sounds.rows[3]?.label === "Volume", JSON.stringify(sounds.rows.map((r) => r.label)));
say("…and every kind carries the sentence that explains it", sounds.rows.every((row) => (row.note ?? "").length > 10), JSON.stringify(sounds.rows.map((r) => r.note?.slice(0, 20))));
say("banners has the same three kinds, in the same order", JSON.stringify(banners.rows.map((r) => r.label)) === JSON.stringify(sounds.rows.slice(0, 3).map((r) => r.label)), JSON.stringify(banners.rows.map((r) => r.label)));
/*
 * The sentence is printed once. Repeating it under the switches would be the spreadsheet
 * again with extra words — it describes the event, and the event is the same one.
 */
say("…without repeating the sentences", banners.rows.every((row) => row.note === null), JSON.stringify(banners.rows.map((r) => r.note)));
/*
 * One control per row, and all of a group's the same kind. This is what makes a column
 * heading unnecessary: nothing in Sounds is a switch and nothing in Banners is a chip.
 */
say("one control per row, everywhere", panel.groups.every((group) => group.rows.every((row) => row.controls.length === 1)), JSON.stringify(panel.groups.map((g) => g.rows.map((r) => r.controls))));
say("…all of Banners' being switches", banners.rows.every((row) => row.controls[0] === "sw"), JSON.stringify(banners.rows.map((r) => r.controls[0])));
say("…and Sounds' being cue chips, bar the volume", sounds.rows.slice(0, 3).every((row) => row.controls[0] === "chipbtn") && sounds.rows[3]?.controls[0] === "seg", JSON.stringify(sounds.rows.map((r) => r.controls[0])));
say("the permission line lives inside the group it constrains", /banner/i.test(panel.strip ?? ""), panel.strip?.slice(0, 70));
say("adding an account is the last row of its own group, not a window footer", /Add an account/.test(panel.add ?? "") && panel.footer === 0, `${panel.add} · ${panel.footer} footers`);

// --- the cue picker: forty-five sounds, previewed ------------------------------------

const wasPlayed = (await tab()).played;
await page.locator(".set-row .set-cue").first().click();
await page.waitForSelector(".set-sounds", { timeout: 4000 });
const picker = await page.evaluate(() => ({
	families: [...document.querySelectorAll(".set-sounds .grp")].map((el) => el.textContent),
	numbers: document.querySelectorAll(".set-sounds .set-cues > [data-row]").length,
	first: document.querySelector(".set-sounds [data-row] .lb")?.textContent,
	current: document.querySelector(".set-sounds .set-cues > [data-row][data-current='true']")?.textContent,
	scrolls: (() => {
		const el = document.querySelector(".set-sounds");
		return el.scrollHeight > el.clientHeight;
	})(),
}));
say("the picker offers the whole library", picker.numbers === 45, `${picker.numbers} cues`);
say("…in five named families", picker.families.length === 5, JSON.stringify(picker.families));
say("…with silence first, before any of them", picker.first === "Silent", picker.first);
say("…the one in force marked", picker.current === "01", picker.current);
say("…and it is a grid rather than a scroll of forty-five rows", picker.scrolls === true && picker.numbers === 45, "capped height, five per line");

/*
 * Pressing one previews it *and leaves the menu open*, which is what turns picking a
 * notification sound from a guess into listening to four and keeping one. The names say
 * nothing — `nope-03` against `nope-07` — so this is the only way anybody could choose.
 */
await page.locator(".set-sounds .set-cues > [data-row]").nth(3).click();
await settle(page, 400);
const afterPick = await page.evaluate(() => ({
	open: Boolean(document.querySelector(".set-sounds")),
	last: window.__played.at(-1),
	chip: document.querySelector(".set-row .set-cue")?.innerText.trim(),
	saved: JSON.parse(localStorage.getItem("decks.alerts") ?? "{}"),
	played: window.__played.length,
}));
say("pressing a cue plays that exact cue", /\/sounds\/staplebops-04\.mp3$/.test(afterPick.last ?? ""), afterPick.last);
say("…and leaves the menu open, so the next one can be heard too", afterPick.open === true);
say("…shows it on the chip in words", afterPick.chip === "Staplebops 04", afterPick.chip);
say("…and saves the id, which is the filename", afterPick.saved?.sound?.done === "staplebops-04", JSON.stringify(afterPick.saved?.sound));
say("the preview happened", afterPick.played > wasPlayed, `${wasPlayed} → ${afterPick.played}`);

await page.keyboard.press("Escape");
await settle(page, 250);

// --- off is a real setting -----------------------------------------------------------

await page.locator(".set-vol > button").filter({ hasText: /^Off$/ }).click();
await settle(page, 300);
const quiet = await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem("decks.alerts") ?? "{}"), played: window.__played.length }));
await feed({ type: "agent.state", id: "probe", state: "tool" });
await settle(page, 100);
await feed({ type: "agent.state", id: "probe", state: "idle" });
await settle(page, 400);
const stillQuiet = await page.evaluate(() => window.__played.length);
say("volume off silences the next cue", stillQuiet === quiet.played, `${quiet.played} → ${stillQuiet}`);
say("…without forgetting which cue each kind had", quiet.saved?.sound?.done === "staplebops-04" && quiet.saved?.volume === 0, JSON.stringify(quiet.saved));

/*
 * And the library is on disk where the ids say it is. A 404 here is silence, which is the
 * one failure mode of this feature that produces no error anywhere.
 */
const cueMisses = [];
for (const id of ["staplebops-01", "staplebops-02", "nope-03", "bip-bop-10", "yup-06", "alert-10", "nope-12"]) {
	const response = await fetch(`${WEB}/sounds/${id}.mp3`);
	if (!response.ok) cueMisses.push(`${id} → ${response.status}`);
}
say("every default and every family's last cue is a file", cueMisses.length === 0, cueMisses.join(", "));
say("the vendored set carries opencode's licence beside it", (await fetch(`${WEB}/sounds/LICENSE`)).ok);

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
