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

/**
 * The model the checks that spend tokens should spend them on, from `DECKS_E2E_MODEL`.
 *
 * A search string rather than a `provider/id`, because that is what the picker takes and
 * because an id is the one part of a model nobody can remember — `muse contributor` finds
 * `opencode-go / Muse Spark 1.2 Contributor` whatever its slug turns out to be. Unset, every
 * turn runs on whatever the runtime's default is, which is what happened before this existed
 * and is fine for a one-off.
 *
 * It matters because these five files are the only ones that cost anything: a deck signed
 * into a proxy with a free tier and a metered one should be able to say which of them the
 * suite is allowed to burn.
 */
export const MODEL = process.env.DECKS_E2E_MODEL ?? "";

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
	/*
	 * Top frame only, and that guard is load-bearing.
	 *
	 * An init script runs in *every* frame, and a board is served from `/api/board/...`
	 * into a same-origin iframe — so this cleared `localStorage` again every time a
	 * thumbnail mounted, wiping whatever the app had persisted since the page loaded. The
	 * symptom was a panel that forgot its tab and its fold partway through a check, which
	 * reads as a bug in the panel.
	 */
	await page.addInitScript((wanted) => {
		if (window.top !== window.self) return;
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

/**
 * Wait for the focused agent to go idle — i.e. the turn finished.
 *
 * Asked of the **stop button**, which is the app's own answer: the composer draws one
 * control with two meanings, and `data-stop` is on it exactly while `chat.state !== "idle"`
 * — the same condition the server calls `running`. So this waits on the thing the user
 * waits on rather than on a class of its own.
 *
 * It used to read `.composer .send`'s `data-busy`. Neither the class nor the attribute has
 * existed since the rewrite, so it resolved `undefined === "false"` → false and every
 * agent-driven check hung until its timeout. That is the whole reason these five files had
 * never run: not the model, the selector.
 */
export async function idle(page, { timeout = 600000 } = {}) {
	await page.waitForFunction(() => document.querySelector('.sendbtn[data-stop="true"]') === null, null, {
		timeout,
	});
}

/**
 * Put the focused agent on `DECKS_E2E_MODEL`, through the picker, the way a person would.
 *
 * Called by `ask`, so every turn in the suite is on the model the run was told to spend —
 * including the turns of agents a check creates itself, which is the case an env var alone
 * cannot cover: a new agent takes the runtime's default, not the last thing you picked.
 *
 * It is a no-op when the chip already says the right thing, so a check that asks three times
 * pays for one switch. The switch is recorded in the conversation (that is the point of
 * recording it), so it lands *before* the first user message rather than in the middle of a
 * transcript a check is counting.
 */
export async function useModel(page, wanted = MODEL) {
	if (!wanted) return undefined;
	const chip = page.locator(".dockrow .chipbtn").last();
	await chip.waitFor({ state: "visible", timeout: 20000 });
	const before = (await chip.innerText()).trim();
	/*
	 * Compared on letters and digits alone, because the two strings are not the same kind of
	 * name: `wanted` is matched against the model's **id** by the picker's own search
	 * (`opencode-go/muse-spark-1.2-contributor`), and the chip shows its **label**
	 * (`Muse Spark 1.2 Contributor`). Left as a regex over the raw text, `muse-spark` never
	 * matches `Muse Spark` and the switch happens again before every single turn.
	 */
	const bare = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (bare(before).includes(bare(wanted))) return before;

	await chip.click();
	await page.waitForSelector(".popover input", { timeout: 8000 });
	await page.locator(".popover input").fill(wanted);
	const row = page.locator(".popover [data-row]").first();
	await row.waitFor({ state: "visible", timeout: 8000 });
	const label = (await row.innerText()).trim();
	await row.click();
	// The chip is the app's own answer about which model is in force, so wait for it rather
	// than for a timer: `agent.setModel` is a round trip and the picker closes optimistically.
	await page.waitForFunction(
		(was) => {
			const chips = document.querySelectorAll(".dockrow .chipbtn");
			return (chips[chips.length - 1]?.textContent ?? "") !== was;
		},
		before,
		{ timeout: 20000 },
	);
	return label;
}

/** Send one prompt and wait out the turn. Never swallow the timeout: a prompt typed into
 *  a still-running turn truncates it, and the truncated reply then looks like a bug. */
export async function ask(page, text, { timeout = 600000 } = {}) {
	await useModel(page);
	await page.locator(".dockfield").fill(text);
	await page.locator(".dockfield").press("Enter");
	// The turn has to be seen *starting*, or a prompt that never left the box reads as a
	// turn that answered instantly and every assertion after it is about the turn before.
	await page.waitForFunction(() => document.querySelector('.sendbtn[data-stop="true"]') !== null, null, {
		timeout: 20000,
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
	const wanted = deck.boards.map((board) => board.path);
	const link = await socket();
	/*
	 * Confirmed, for the *focused* agent, and retried until it is.
	 *
	 * This used to send the plays and wait 400ms. Long enough once the server has settled
	 * and not for the first check of a run: `board.play` is attributed to the focused agent,
	 * and a fresh server is still starting one — so the plays landed on nobody, the canvas
	 * stayed empty, and the check failed thirty seconds later waiting for a board that was
	 * never coming. Always the first two checks, which is what a race at startup looks like
	 * and what it gets blamed on last.
	 *
	 * Waiting for any `context.changed` was not enough either. A restored session and a new
	 * agent both send one, so the last message could describe an agent the browser is not
	 * looking at — the plays were real and on the wrong canvas. So the agent is named: the
	 * greeting says who is focused, and this waits for that one's in-play set.
	 */
	const deadline = Date.now() + 25000;
	let landed = [];
	let agent;
	while (Date.now() < deadline) {
		agent = link.last("agents")?.focused ?? agent;
		if (agent) for (const path of wanted) link.send({ type: "board.play", path });
		await new Promise((resolve) => setTimeout(resolve, 400));
		landed = link.received.filter((m) => m.type === "context.changed" && m.agentId === agent).at(-1)?.inPlay ?? [];
		if (agent && wanted.every((path) => landed.includes(path))) break;
	}
	link.close();
	if (!agent) throw new Error("resetStage: the server never said which agent is focused");
	if (!wanted.every((path) => landed.includes(path))) {
		throw new Error(`resetStage: ${landed.length} of ${wanted.length} boards reached ${agent}'s canvas`);
	}
	return wanted;
}

/**
 * Bring out the boards panel.
 *
 * There is one panel now where there were two, and one *list* in it where there were two
 * tabs: on the canvas, held, and the rest of the deck, in one scroller. So `"context"` and
 * `"deck"` are the same thing and both are accepted and ignored — the callers that pass them
 * are asking for the panel, which is what they get. `"agents"` is the selector in the pill
 * and still goes to `openAgents`.
 *
 * Written here rather than in each check for the reason it always was: it lived in seven
 * files as `mouse.move(6, 480)` plus a wait, which is seven places to change when the way in
 * changes — and it has now changed three times.
 */
export async function openPanel(page, tab = "context") {
	if (tab === "agents") return openAgents(page);
	/*
	 * By `data-open`, which is the panel's own answer to the question.
	 *
	 * This has moved twice, and both moves were the panel changing what "open" *is*. It
	 * started as `data-inset="left"` — wrong, because below 1100px the panel is a sheet and
	 * deliberately declares no inset, so this timed out on every phone. Then it was the
	 * element's presence — wrong too, once the panel stayed mounted in order to animate out.
	 *
	 * `data-open` is the attribute the component sets for exactly this, and it is true in
	 * both arrangements. The lesson worth keeping: a test should ask a surface what state it
	 * is in, not infer it from a side effect of that state.
	 */
	const open = () => page.evaluate(() => document.querySelector(".panel-shell")?.dataset.open === "true");
	if (!(await open())) {
		/*
		 * Matched on the end of the label, because the whole of it says what pressing the
		 * button *does* — "Show the boards panel" or "Hide the boards panel" — which is right
		 * for a screen reader and means an exact match would only ever find one of the two
		 * states. An earlier version asked for `aria-label="Boards"`, matched nothing, and
		 * fell through to a tool button, which failed with a story about a sticky note.
		 */
		await page.locator('.pill button[aria-label$="the boards panel"]').first().click();
		await page.waitForFunction(() => document.querySelector(".panel-shell")?.dataset.open === "true", null, { timeout: 6000 });
		// It slides; a click landing mid-slide misses the row it was aimed at.
		await page.waitForTimeout(220);
	}
}

/**
 * Open the agent selector: the chevron beside the active agent's name.
 *
 * A popover rather than a panel, so what a check waits for is the menu rather than a
 * `data-open` on a surface that no longer exists.
 */
export async function openAgents(page) {
	if (await page.locator(".popover").count()) return;
	await page.locator('.pill button[aria-label^="Switch agent"], .pill button[aria-haspopup="menu"]').first().click();
	await page.waitForSelector(".popover", { timeout: 6000 });
}

/**
 * Open the corner's overflow and click a row.
 *
 * The cheat sheet, the settings and the theme were three buttons in the title bar; they are
 * three menu rows now, at every width. A check that wants one asks for it by its words
 * rather than by its position, because the order is a design decision that may move and the
 * words are the thing a person reads.
 */
export async function openOverflow(page, label) {
	await page.locator('.pill button[aria-label="More"]').click();
	await page.waitForSelector(".popover", { timeout: 4000 });
	await page.locator(".popover [data-row]").filter({ hasText: label }).first().click();
}

/** Whether the overflow offers a row, without picking it. */
export async function hasOverflowRow(page, label) {
	await page.locator('.pill button[aria-label="More"]').click();
	await page.waitForSelector(".popover", { timeout: 4000 });
	const found = (await page.locator(".popover [data-row]").filter({ hasText: label }).count()) > 0;
	await page.keyboard.press("Escape");
	await page.waitForTimeout(120);
	return found;
}

/**
 * How close the camera is, as a number.
 *
 * The zoom used to be a `.level` span in a bar in the bottom-right corner; it is a menu
 * chip in the top-right cluster now. Eleven checks read it, which is eleven reasons for
 * this to be a function rather than a selector copied eleven times.
 */
export async function zoom(page) {
	const text = await page.locator('.pill [aria-label^="Zoom"]').first().textContent();
	return Number((text ?? "0%").replace(/[^\d.]/g, ""));
}

/** The same reading, from inside the page, for a `waitForFunction`. */
export const ZOOM_IN_PAGE = `Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, ""))`;

/** Arm one of the five tools. Titles are the palette's own, wherever the palette lives. */
export async function pickTool(page, title) {
	await page.locator(`.palette button[title*="${title}"]`).first().click();
}

/**
 * Summon the conversation, and wait until it is actually up.
 *
 * `data-shown` rather than a class, because the column is mounted whether or not it has the
 * right edge — `lib/edge.ts` decides who does, and "mounted" and "shown" are different
 * questions now that the inspector can borrow the edge from it.
 *
 * `time-machine` and `chrome` call this now. They used to click a block on the *spine* to
 * open the history at a turn, and the spine went with the title bar — so they were clicking
 * nothing and timing out before their first assertion.
 */
export async function openHistory(page) {
	if ((await page.locator("[data-shown='true']").count()) > 0) return;
	await page.locator('.pill button[title^="Conversation"]').first().click();
	await page.waitForSelector("[data-shown='true']", { timeout: 6000 });
}

/**
 * Start another agent from the panel's `+`.
 *
 * The `+` opens a menu of the two runtimes rather than making one on the default — new agent
 * and which runtime are the same question, since a live session cannot swap the process
 * behind it. Seven checks pressed the `+` and expected a row; they get a menu, so the two
 * steps live here rather than in seven places.
 *
 * Returns once the row exists, because every caller's next line assumes it does.
 */
export async function newAgent(page, kind = "pi") {
	/*
	 * From the selector under the agent's own name, which is where the list went.
	 *
	 * It used to be a `+` in the header of the agents *panel*, and the panel is gone: a list
	 * you switch with is a selector, so it hangs off the thing it selects.
	 *
	 * The `New agent` row is two controls. The label starts one on the default runtime; the
	 * chevron beside it opens `New claude agent` / `New pi agent`, because the runtime cannot
	 * change afterwards and that is the only moment it can be chosen. So this always goes
	 * through the chevron and names the runtime — asking for the default by clicking the
	 * label would make the check's `kind` argument a lie whenever the default changed.
	 */
	await openAgents(page);
	const rows = () => page.locator(".popover [data-row]");
	const agentsBefore = await page.evaluate(
		() => document.querySelectorAll('.popover [data-row][data-flat="true"]').length,
	);
	await rows().last().click();
	await page.locator(".popover [data-row]").filter({ hasText: new RegExp(`^New ${kind} agent`, "i") }).first().click();
	/*
	 * Counted with the menu re-opened, because picking closes it — and counted as agent
	 * *rows* rather than every `[data-row]`, since the `New agent` pair are rows too.
	 */
	await page.waitForTimeout(500);
	await openAgents(page);
	await page.waitForFunction(
		(was) => document.querySelectorAll('.popover [data-row][data-flat="true"]').length > was,
		agentsBefore,
		{ timeout: 15000 },
	);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);
}

/**
 * Every board in the deck — which is the panel's list, all of it.
 *
 * There is no browser to open and no tab to switch to: the deck is the third section of the
 * one list, under whatever the focused agent is holding. Kept as a name because the checks
 * that call it are asking a question — "is every board reachable from here" — that is still
 * worth asking under that name.
 */
export async function openAllBoards(page) {
	await openPanel(page);
	await page.waitForSelector(".board-row, .rail-item", { timeout: 6000 });
	await page.waitForTimeout(300);
}

/** A short settle for things with no observable signal — a CSS transition, mostly. */
export function settle(page, ms = 350) {
	return page.waitForTimeout(ms);
}
