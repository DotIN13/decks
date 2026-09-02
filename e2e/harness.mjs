/**
 * What the browser checks share: where the deck is, when the app is ready, and how a
 * result is reported.
 *
 * Two rules hold the suite together.
 *
 * **Nothing is hardcoded to one machine.** The deck under test comes from the running
 * server (`/api/deck`), not from a path written into the script, so the same check runs
 * against a throwaway fixture here and against whatever deck you point it at.
 *
 * **Wait for the app, never for the clock.** These scripts used to pad every page load
 * with `waitForTimeout(2500)`. Two thirds of the suite's runtime was those pads, and they
 * are the wrong tool twice over: 2.5s is ~2s longer than a board actually needs, and it is
 * still too short on a loaded machine, so it was simultaneously slow and flaky. Boards
 * publish `window.__boardReady`, which is the thing to wait on.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, devices } from "playwright";

export const WEB = process.env.DECKS_E2E_WEB ?? "http://127.0.0.1:4328";
export const API = process.env.DECKS_E2E_API ?? "http://127.0.0.1:4329";

let failures = 0;

/** Report one check. A failure sets the exit code, so a runner can trust it. */
export function say(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) {
		failures += 1;
		process.exitCode = 1;
	}
}

export function failed() {
	return failures;
}

/** The deck the server actually has open, straight from the API. */
export async function deckState() {
	const response = await fetch(`${API}/api/deck`);
	if (!response.ok) throw new Error(`GET /api/deck -> ${response.status}`);
	return (await response.json()).deck;
}

/**
 * Refuse to run against a deck that is not a fixture.
 *
 * This exists because it already happened: a stale server on the API port meant a run
 * went against the deck being worked in, and boards were dragged ~100px before anyone
 * noticed. A check that writes to boards has no business guessing.
 */
export async function preflight() {
	const deck = await deckState();
	const marker = process.env.DECKS_E2E_MARKER ?? "decks-e2e";
	if (!deck.path.includes(marker)) {
		console.error(`refusing to run: ${deck.path} does not look like a fixture (no "${marker}" in the path).`);
		console.error("start the server on a fixture deck, or set DECKS_E2E_MARKER.");
		process.exit(2);
	}
	return deck;
}

/** A board file inside the deck under test. */
export async function boardPath(name) {
	const deck = await deckState();
	return `${deck.path}/boards/${name}`;
}

export function read(file) {
	return readFileSync(file, "utf8");
}

export function write(file, text) {
	writeFileSync(file, text);
}

/**
 * Open the app.
 *
 * `localStorage` is cleared so a check never inherits the last one's camera, pins or
 * panel state, and the scheme is set explicitly so screenshots are stable.
 *
 * `device` names one of Playwright's device descriptors ("iPhone 15", "Pixel 7", "iPad
 * (gen 7)") and is what `mobile.mjs` needs: a viewport alone still has a mouse, and a
 * mouse hides exactly the bugs a touchscreen has. A device context brings `hasTouch`,
 * the pixel ratio and the user agent with it, and the returned `context` is what a check
 * attaches a CDP session to in order to dispatch real touches.
 */
export async function open({ width = 1500, height = 950, scheme = "dark", boards = true, device } = {}) {
	const browser = await chromium.launch();
	const descriptor = device ? devices[device] : undefined;
	if (device && !descriptor) throw new Error(`playwright has no device called "${device}"`);
	const context = descriptor ? await browser.newContext({ ...descriptor }) : await browser.newContext({ viewport: { width, height } });
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => {
		// The init script touches localStorage before the app has a chance to; that throw
		// is the harness's own noise, not the app's.
		if (!/localStorage/.test(error.message)) errors.push(error.message);
	});
	await page.addInitScript((wanted) => {
		try {
			localStorage.clear();
			localStorage.setItem("decks.scheme", wanted);
		} catch {
			/* private mode, or a page that has no storage access yet */
		}
	}, scheme);
	await page.goto(`${WEB}/`, { waitUntil: "load" });
	/*
	 * Answer permission questions, because a check cannot.
	 *
	 * A Claude agent's runtime asks before a command it judges risky, and an unanswered
	 * question stops the turn — so a suite with nobody watching would hang rather than
	 * fail. The fixture is a throwaway copy of `example/`, so allowing is safe here in a
	 * way it would not be in a real deck. Recorded on `asked` so a check can assert on it.
	 */
	const asked = [];
	const answer = async () => {
		try {
			const card = page.locator(".dialog-card");
			if ((await card.count()) === 0) return;
			asked.push((await card.locator(".q").first().textContent()) ?? "");
			await card.locator("button", { hasText: /^Allow$/ }).first().click({ timeout: 2000 });
		} catch {
			/* the dialog went away on its own, which is the outcome we wanted anyway */
		}
	};
	const watch = setInterval(() => void answer(), 700);
	page.on("close", () => clearInterval(watch));

	if (boards) await ready(page);
	return { browser, page, context, errors, asked, stopAnswering: () => clearInterval(watch) };
}

/**
 * Wait until every board on the canvas has finished mounting.
 *
 * `__boardReady` is set by `runtime/lib/board.js` once the document has rendered its
 * components, which is the same signal the app itself waits for.
 */
export async function ready(page, { timeout = 30000 } = {}) {
	await page.waitForSelector(".board-node iframe", { timeout });
	await page.waitForFunction(
		() => {
			const frames = [...document.querySelectorAll(".board-node iframe")];
			return frames.length > 0 && frames.every((frame) => frame.contentWindow?.__boardReady === true);
		},
		null,
		{ timeout },
	);
}

/**
 * Wait for the canvas to be empty.
 *
 * The counterpart of `ready`, and needed as often: an agent holding nothing puts nothing in
 * play, so a check that has just created one is waiting for boards to *go* rather than to
 * arrive. Asserting on an empty canvas without waiting is how you assert on the moment
 * before it emptied.
 */
export async function emptyCanvas(page, { timeout = 15000 } = {}) {
	await page.waitForFunction(() => document.querySelectorAll(".board-node").length === 0, null, { timeout });
}

/** Wait for one board to finish mounting, by deck-relative path. */
export async function boardReady(page, path, { timeout = 30000 } = {}) {
	await page.waitForSelector(`.board-node[data-path="${path}"] iframe`, { timeout });
	await page.waitForFunction(
		(wanted) => {
			const frame = document.querySelector(`.board-node[data-path="${wanted}"] iframe`);
			return frame?.contentWindow?.__boardReady === true;
		},
		path,
		{ timeout },
	);
}

/**
 * Wait for the file on disk to change, instead of sleeping and hoping.
 *
 * A write travels board → server → watcher → client, so "did the edit land" is a
 * condition with no fixed duration.
 */
export async function changed(file, was, { timeout = 15000 } = {}) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const now = read(file);
		if (now !== was) return now;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`${file} did not change within ${timeout}ms`);
}

/** Wait for the focused agent to go idle — i.e. the turn finished. */
export async function idle(page, { timeout = 600000 } = {}) {
	await page.waitForFunction(() => document.querySelector(".composer .send")?.dataset.busy === "false", null, {
		timeout,
	});
}

/** Send one prompt and wait out the turn. Never swallow the timeout: a prompt typed into
 *  a still-running turn truncates it, and the truncated reply then looks like a bug. */
export async function ask(page, text, { timeout = 600000 } = {}) {
	await page.locator(".composer textarea").fill(text);
	await page.locator(".composer textarea").press("Enter");
	await page.waitForFunction(() => document.querySelector(".composer .send")?.dataset.busy === "true", null, {
		timeout: 15000,
	});
	await idle(page, { timeout });
}

/** Talk to the server the way the client does. */
export async function socket() {
	const ws = new WebSocket(`${API.replace("http", "ws")}/ws`);
	const received = [];
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	ws.onmessage = (event) => received.push(JSON.parse(String(event.data)));
	return {
		received,
		send: (message) => ws.send(JSON.stringify(message)),
		last: (type) => received.filter((m) => m.type === type).at(-1),
		close: () => ws.close(),
	};
}

/**
 * Put the whole deck on the canvas.
 *
 * Most of these checks predate the context/in-play tiers and expect to see every board.
 * Without this they inherit whatever the previous check narrowed the canvas to, and fail
 * for reasons that have nothing to do with what they test.
 */
export async function resetStage() {
	const deck = await deckState();
	const link = await socket();
	for (const board of deck.boards) link.send({ type: "board.play", path: board.path });
	await new Promise((resolve) => setTimeout(resolve, 400));
	link.close();
	return deck.boards.map((board) => board.path);
}

/**
 * Bring out one of the two left panels.
 *
 * They are toggled from the title bar rather than reached for with the cursor (DESIGN §7),
 * and they share a corner — opening either closes the other — so every check that wants one
 * asks the same way. It lived in seven files as `mouse.move(6, 480)` plus a wait, which is
 * seven places to change when the way in changes, and it just did.
 */
export async function openPanel(page, name) {
	const title = name === "context" ? "Boards this agent is holding" : "The agents";
	const selector = name === "context" ? ".side.context" : ".side:not(.context)";
	if (await page.evaluate((s) => document.querySelector(s)?.dataset.open === "true", selector)) return;
	await page.locator(`.titlebar button[title="${title}"]`).click();
	await page.waitForFunction((s) => document.querySelector(s)?.dataset.open === "true", selector, { timeout: 6000 });
	// The panel slides; 190ms is the transition and a click landing mid-slide misses.
	await page.waitForTimeout(260);
}

/** Every board in the deck, in the modal that lists them — the way to find one now. */
export async function openAllBoards(page) {
	await page.locator('.titlebar button[title="Every board in the deck"]').click();
	await page.waitForSelector(".all-boards", { timeout: 6000 });
	await page.waitForTimeout(300);
}

/** A short settle for things with no observable signal — a CSS transition, mostly. */
export function settle(page, ms = 350) {
	return page.waitForTimeout(ms);
}
