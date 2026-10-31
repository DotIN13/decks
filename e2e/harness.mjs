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
 * still too short on a loaded machine, so it was simultaneously slow and flaky. The stage says
 * when it has drawn and when its camera rests, which are the things to wait on.
 *
 * **The canvas is in a frame.** The app draws the canvas in a sandboxed iframe of its own
 * (`iframe.canvas-frame`, origin "null"), with its tools, zoom bar, pen bar and comment popover
 * beside it in there; the page keeps the side panel, the top bars, the composer and the
 * conversation. So what a check reads of the canvas it reads in that frame: `canvasFrame(page)`
 * finds it (it is made again when the conversation moves to another canvas, so ask again after a
 * switch), and `open` hands back the one it opened on as `canvas`. The frame fills the window, so
 * a point in it is the same point on the page, and `page.mouse` presses it; keys reach the canvas
 * only while the focus is in the frame (`focusCanvas`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, devices, webkit } from "playwright";
import { applyEdits } from "../packages/pen/src/diff.ts";

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
const MODEL = process.env.DECKS_E2E_MODEL ?? "";

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

/**
 * A person token for the checks' own calls, as a Decks tab gets one: the harness writes it into its
 * page loaded as a tab of its own (`server/src/auth/issue.ts`). Every request to the harness carries a
 * token, from this machine too. Made once per harness address.
 */
const tokens = new Map();
export function personToken(api) {
	api = typeof api === "string" ? api : API;
	if (!tokens.has(api)) {
		tokens.set(
			api,
			import("node:http").then(
				({ get }) =>
					new Promise((resolve, reject) => {
						get(`${api}/`, { headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" } }, (response) => {
							let html = "";
							response.setEncoding("utf8");
							response.on("data", (chunk) => (html += chunk));
							response.on("end", () => {
								const token = /<meta name="decks-session" content="([^"]+)">/.exec(html)?.[1];
								if (token) resolve(token);
								else reject(new Error(`${api}/ gave no person token: is it a Decks harness with a built web app?`));
							});
						}).on("error", reject);
					}),
			),
		);
	}
	return tokens.get(api);
}

/** Drop the token kept for `api`: the runner starts a new server, with a new token, on the same address for each check. */
export function forgetPersonToken(api) {
	tokens.delete(typeof api === "string" ? api : API);
}

/** The headers that make a check's request the person's. */
export async function asPerson(api) {
	return { authorization: `Bearer ${await personToken(api)}` };
}

/**
 * The fixture's canvas (`e2e/fixture/decks/canvases/auth-refresh/`): five cards (plan, risks, sources,
 * notes and how-deep-is-the-deep-sea), which `resetStage` puts the focused agent on.
 */
export const CANVAS = "auth-refresh";

/** A fixture card's deck path, by its name: `card("plan")` is `canvases/auth-refresh/cards/plan/index.html`. */
export const card = (name) => `canvases/${CANVAS}/cards/${name}/index.html`;

/**
 * The fixture's one leftover board: a friend's shared canvas (`shared/canvases/ada/old-notes/`, view
 * only), whose board is drawn as a picture and never runs. For the checks of an old board's drawing.
 */
export const SHARED_CANVAS = "shared/ada/old-notes";
export const SHARED_BOARD = "shared/canvases/ada/old-notes/boards/notes.html";

/** What a check calls a card or a board by: a card's folder (`plan` for `…/cards/plan/index.html`), else its file's name. */
export const nameOf = (path) => /\/cards\/([^/]+)\/index\.html$/.exec(path.split("?")[0])?.[1] ?? path.split("?")[0].split("/").pop();

/** Where the fixture puts each of its cards, from its canvas file: what `resetStage` moves them back to. */
const FIXTURE_PLACES = (() => {
	const doc = JSON.parse(readFileSync(new URL(`./fixture/decks/canvases/${CANVAS}/canvas.pen`, import.meta.url), "utf8"));
	return (doc.children ?? []).filter((node) => node.metadata?.type === "decks.card").map((node) => ({ path: `canvases/${CANVAS}/${node.metadata.path}`, x: node.x, y: node.y }));
})();

/**
 * The deck the server actually has open, straight from the API. `boards` is every card, board,
 * document and app on the deck's own canvases, which a check counting what is on screen counts;
 * a friend's shared canvas is left out of it. `library` is everything the deck lists.
 *
 * Each one's place and size are its item's in its canvas's file, read from disk: the deck's own
 * `x`/`y` are only the seed a new stage would lay it out from, not where the canvas has it.
 */
export async function deckState(api) {
	api = typeof api === "string" ? api : API;
	const response = await fetch(`${api}/api/deck`, { headers: await asPerson(api) });
	if (!response.ok) throw new Error(`GET /api/deck -> ${response.status}`);
	const deck = (await response.json()).deck;
	const drawings = new Map();
	const placed = (board) => {
		const canvas = /^canvases\/([^/]+)\//.exec(board.path)?.[1];
		if (!canvas) return board;
		if (!drawings.has(canvas)) {
			try {
				drawings.set(canvas, JSON.parse(readFileSync(`${deck.path}/canvases/${canvas}/canvas.pen`, "utf8")).children ?? []);
			} catch {
				drawings.set(canvas, []);
			}
		}
		const inFolder = board.path.slice(`canvases/${canvas}/`.length);
		const node = drawings.get(canvas).find((one) => one.metadata?.path === inFolder);
		return node && Number.isFinite(node.x) ? { ...board, x: node.x, y: node.y, w: node.width ?? board.w, h: node.height ?? board.h } : board;
	};
	return { ...deck, library: deck.boards, boards: deck.boards.filter((board) => !board.path.startsWith("shared/")).map(placed) };
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

/** A fixture card's file inside the deck under test, by its name (`cardFile("plan")`). */
export async function cardFile(name) {
	const deck = await deckState();
	return `${deck.path}/${card(name)}`;
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
 * (gen 7)"): a viewport alone still has a mouse, and a mouse hides exactly the bugs a
 * touchscreen has. A device context brings `hasTouch`, the pixel ratio and the user agent
 * with it, and the returned `context` is what a check attaches a CDP session to in order to
 * dispatch real touches. `mobile.mjs` was why this exists and has been cut; `context.mjs` is
 * the one caller left, and it only wants the narrow viewport — nothing dispatches a touch
 * any more.
 */
export async function open({ width = 1500, height = 950, scheme = "dark", cards = true, device, edit = false, dpr, engine = "chromium", init, panelTab = "canvas" } = {}) {
	// WebGPU, which the stage's engine draws with: headless Chromium has it only when asked.
	const gpu = ["--enable-unsafe-webgpu", ...(process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-unsafe-swiftshader"])];
	/*
	 * `engine: "webkit"` is Safari's engine, for what only a phone's browser does (no WebGPU, WebGL 2
	 * in a worker): `backends.mjs`. It takes none of Chromium's flags.
	 */
	const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ /* DECKS_E2E_HEADED=1: a real window, composited to the screen as a person's is */ headless: process.env.DECKS_E2E_HEADED !== "1", args: [...gpu, ...(process.env.DECKS_E2E_CHROME_ARGS ? process.env.DECKS_E2E_CHROME_ARGS.split(" ") : [])] });
	const descriptor = device ? devices[device] : undefined;
	if (device && !descriptor) throw new Error(`playwright has no device called "${device}"`);
	// `dpr` is a retina screen without a phone attached to it: a canvas renderer can be right
	// on this machine's 1× screen and wrong on a laptop's 2× one, and that is not a difference
	// a viewport size can stand in for. `renderers.mjs` was its only caller and has been cut,
	// so nothing passes `dpr` today — the option is kept for the next check that needs it.
	const context = descriptor
		? await browser.newContext({ ...descriptor })
		: await browser.newContext({ viewport: { width, height }, ...(dpr ? { deviceScaleFactor: dpr } : {}) });
	const page = await context.newPage();
	/* `init` runs in the page before the app does, in every frame: to take an API away, say (`backends.mjs`). */
	if (init) await page.addInitScript(init);
	const errors = [];
	page.on("pageerror", (error) => {
		// The init script touches localStorage before the app has a chance to; that throw
		// is the harness's own noise, not the app's.
		if (!/localStorage/.test(error.message)) errors.push(error.message);
	});
	/*
	 * Top frame only, and that guard is load-bearing: an init script runs in *every* frame, the
	 * canvas frame among them, and clearing storage there again would wipe what the page had kept.
	 */
	await page.addInitScript(([wanted, tab]) => {
		if (window.top !== window.self) return;
		try {
			localStorage.clear();
			localStorage.setItem("decks.scheme", wanted);
			// The side panel opens on the tab it was left on; the checks start on Canvas, which lists the boards (`panelTab`).
			if (tab) localStorage.setItem("decks.panelTab", tab);
		} catch {
			/* private mode, or a page that has no storage access yet */
		}
	}, [scheme, panelTab]);
	/*
	 * The plain web root. There is one screen in the app — the focused agent's stage — and the
	 * server remembers which agent each browser is on, so there is no address to name a place
	 * with. A new browser starts on the conversation last opened anywhere, which is the one
	 * `resetStage` has just played the fixture's boards onto.
	 */
	await page.goto(`${WEB}/`, { waitUntil: "load" });
	/*
	 * Answer permission questions, because a check cannot.
	 *
	 * A Claude agent's runtime asks before a command it judges risky, and an unanswered
	 * question stops the turn — so a suite with nobody watching would hang rather than
	 * fail. The fixture is a throwaway copy of `e2e/fixture/`, so allowing is safe here in a
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

	if (cards) {
		await liveZoom(page);
		await ready(page);
	}
	// The canvas frame, once it has drawn: a check that opened without boards may still be waiting for it.
	const canvas = await canvasFrame(page).catch(() => undefined);
	/*
	 * Editing is off by default in the app now, so a check about editing has to ask for it.
	 *
	 * The canvas opens in **browse** mode — text selects, a game plays, nothing drags — and
	 * `edit: true` presses the pencil. Every check that drags a component, opens the
	 * inspector or retypes a run of words needs it; the ones about the camera, the panel and
	 * the chrome do not, and are better off in the default state a person actually lands in.
	 */
	if (edit) await editMode(page);
	return { browser, page, canvas, context, errors, asked, stopAnswering: () => clearInterval(watch) };
}

/**
 * The canvas frame (`iframe.canvas-frame`), once its stage is there: where the canvas, its tools, its
 * zoom bar and its popovers are. Made again when the conversation moves to another canvas, so a
 * check asks for it again after a switch rather than keeping the one it had.
 */
export async function canvasFrame(page, { timeout = 30000 } = {}) {
	const deadline = Date.now() + timeout;
	for (;;) {
		const frame = page.frames().find((one) => !one.isDetached() && one.url().includes("canvas-frame.html"));
		if (frame && (await frame.evaluate(() => !!document.querySelector(".stage")).catch(() => false))) return frame;
		if (Date.now() > deadline) throw new Error("the canvas frame never showed its stage");
		await page.waitForTimeout(100);
	}
}

/** Put the focus in the canvas frame, on its stage, so a key pressed next is the canvas's. */
export async function focusCanvas(page) {
	const canvas = await canvasFrame(page);
	await canvas.evaluate(() => {
		if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
		document.querySelector(".stage")?.focus({ preventScroll: true });
	});
	return canvas;
}

/**
 * Whether a point on the page reaches the canvas: what is there on the page is the canvas frame,
 * not the side panel, a top bar or the composer drawn over it.
 */
export function onCanvasAt(page, x, y) {
	return page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.matches("iframe.canvas-frame") === true, [x, y]);
}

/**
 * Of the places offered (each `{ points: [[x, y], …] }`, and anything else), the first whose every
 * point reaches the canvas rather than the page's chrome over it: what a scan in the frame, which
 * cannot see the page's side panel, bars or composer, found, checked against the page.
 */
export async function firstOnCanvas(page, places) {
	const index = await page.evaluate((all) => all.findIndex((points) => points.every(([x, y]) => document.elementFromPoint(x, y)?.matches("iframe.canvas-frame") === true)), places.map((place) => place.points));
	return index < 0 ? undefined : places[index];
}

/** What a check that edits the drawing used to ask for, kept for those checks: browse, with the pen put away. */
export async function editMode(page, on = true) {
	/*
	 * There is no edit mode any more: browse (the cursor) moves and retypes what is drawn. So either
	 * way this puts the canvas in browse with the pen put away, which is what editing a drawing needs.
	 */
	void on;
	const canvas = await canvasFrame(page);
	/* Select stands alone and is browsing: pressing it puts the pen and the hand down and turns highlights off. */
	const browse = canvas.locator('.v3-tool[data-tool="select"]:visible').first();
	if ((await browse.count()) && ((await browse.getAttribute("aria-pressed")) !== "true" || (await canvas.evaluate(() => document.querySelector(".stage")?.dataset.mode)) !== "browse")) await browse.click();
	await canvas.waitForFunction(() => (document.querySelector(".stage")?.dataset.mode ?? "browse") === "browse", null, { timeout: 4000 });
	await page.waitForTimeout(120);
}

/**
 * The canvas in v3's edit mode: outlines under the pointer, Alt for distances (the tool column's
 * highlighting select, key E). `editMode` puts it back in browse.
 */
export async function highlightMode(page) {
	const canvas = await canvasFrame(page);
	if ((await canvas.evaluate(() => document.querySelector(".stage")?.dataset.mode)) === "edit") return;
	await focusCanvas(page);
	await page.keyboard.press("e");
	await canvas.waitForFunction(() => document.querySelector(".stage")?.dataset.mode === "edit", null, { timeout: 4000 });
	await page.waitForTimeout(120);
}

/**
 * Zoom in about the middle until the stage is live (`data-live`), if it is not.
 *
 * Items take the pointer only at the device's live zoom (`INTERACT_ZOOM`, 20% on a desktop), and a
 * fixture fitted into a laptop window opens just under it. Every check that reaches into an item
 * needs it live, so this is where they get it; a check about the fitted camera itself reads it
 * before calling anything that zooms.
 */
export async function liveZoom(page, { tries = 12 } = {}) {
	const canvas = await canvasFrame(page);
	// Below the live zoom a board has no node, only its picture (`Stage.tsx`): the stage lists them.
	const boards = () => canvas.evaluate(() => window.__decksCards?.().length ?? document.querySelectorAll(".card-node").length);
	await canvas.waitForFunction(() => (window.__decksCards?.().length ?? 0) > 0, null, { timeout: 30000 }).catch(() => {});
	for (let i = 0; i < tries; i++) {
		// Up to the old pause, but no longer than it takes the camera to rest live: most opens are live at once.
		await canvas
			.waitForFunction(() => {
				const stage = document.querySelector(".stage")?.dataset;
				return stage?.live === "true" && stage.gliding !== "true" && stage.moving !== "true";
			}, null, { timeout: i === 0 ? 400 : 350, polling: 50 })
			.catch(() => {});
		if (await canvas.evaluate(() => document.querySelector(".stage")?.dataset.live === "true")) return true;
		if ((await boards()) === 0) return false;
		await canvas.evaluate(() => {
			const stage = document.querySelector(".stage");
			const rect = stage.getBoundingClientRect();
			/*
			 * Toward the biggest board on screen, not the stage's centre: where the stage fills the
			 * screen (a phone) the centre can fall between boards, and zooming in there leaves every
			 * board off screen.
			 */
			const seen = (r) => Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left)) * Math.max(0, Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top));
			const rects = (window.__decksCards?.() ?? []).map((one) => one.rect);
			const cx = rect.left + rect.width / 2;
			const cy = rect.top + rect.height / 2;
			// The centre when it is on a board already, so a desktop lands where it always has.
			const centred = rects.some((r) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
			const best = centred ? undefined : rects.filter((r) => seen(r) > 0).sort((a, b) => seen(b) - seen(a))[0];
			// The middle of the part of it that is on screen.
			const x = best ? (Math.max(best.left, rect.left) + Math.min(best.right, rect.right)) / 2 : cx;
			const y = best ? (Math.max(best.top, rect.top) + Math.min(best.bottom, rect.bottom)) / 2 : cy;
			stage.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
		});
	}
	return false;
}

/**
 * Wait until the canvas has drawn: the stage's sheet shown, or the Rust engine's first frame; then,
 * for a moment, for the items awake near the window (cards, documents, apps) to show their surfaces
 * (`item-slot.tsx`, `data-inert` until then). A board is only ever its picture.
 */
export async function ready(page, { timeout = 30000 } = {}) {
	const canvas = await canvasFrame(page, { timeout });
	await canvas.waitForFunction(
		() => document.querySelector(".stage-sheet")?.hidden === false || (globalThis.__decksSheet?.shown ?? 0) > 0,
		null,
		{ timeout, polling: 100 },
	);
	await canvas.waitForFunction(() => [...document.querySelectorAll(".card-node")].every((node) => node.dataset.inert !== "true"), null, { timeout: 5000, polling: 100 }).catch(() => {});
}

/**
 * Wait for the camera to stop moving.
 *
 * A press at a coordinate is only about the thing under it. A camera that *arrives* rather than
 * jumping adds a way to be wrong about that: measure a box while the view is still gliding and the
 * press lands wherever the box has got to by then. `data-gliding` is the stage's own answer.
 */
export async function still(page, { timeout = 5000 } = {}) {
	const canvas = await canvasFrame(page);
	await canvas.waitForFunction(() => document.querySelector(".stage")?.dataset.gliding !== "true", null, { timeout });
}

/**
 * Wait for the camera to come to rest after something that *may* move it — a Fit, a `1`, a click
 * on a stage card — instead of a fixed pause long enough for the longest glide.
 *
 * Two steps, because the move may not have begun when this is called: up to `start` ms for it to
 * begin (and if it never does, nothing moved), then for it to end; then one frame for whatever
 * reads layout.
 */
export async function rest(page, { start = 300, timeout = 6000 } = {}) {
	const canvas = await canvasFrame(page);
	const moving = (want) => {
		const stage = document.querySelector(".stage")?.dataset;
		return (stage?.gliding === "true" || stage?.moving === "true") === want;
	};
	// (Playwright reads a timeout of 0 as "forever", so `start: 0` skips the first step instead.)
	if (start > 0) await canvas.waitForFunction(moving, true, { timeout: start, polling: "raf" }).catch(() => {});
	await canvas.waitForFunction(moving, false, { timeout, polling: "raf" });
	await canvas.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
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
	// A conversation with no canvas yet has no frame at all, which is as empty as a canvas gets.
	const canvas = await canvasFrame(page, { timeout: Math.min(timeout, 5000) }).catch(() => undefined);
	if (!canvas) return;
	await canvas.waitForFunction(() => document.querySelectorAll(".card-node").length === 0 && (window.__decksCards?.().length ?? 0) === 0, null, { timeout });
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
	await page.waitForFunction(() => document.querySelector('.send-button[data-stop="true"]') === null, null, {
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
	const chip = page.locator('.chip-button[data-picker="model"]');
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
			return (document.querySelector('.chip-button[data-picker="model"]')?.textContent ?? "") !== was;
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
	await page.waitForFunction(() => document.querySelector('.send-button[data-stop="true"]') !== null, null, {
		timeout: 20000,
	});
	await idle(page, { timeout });
}

/** Talk to the server the way the client does. */
export async function socket(api) {
	api = typeof api === "string" ? api : API;
	const ws = new WebSocket(`${api.replace("http", "ws")}/ws?decks_token=${encodeURIComponent(await personToken(api))}`);
	const received = [];
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	/*
	 * A stage drawing comes whole once and then as edits (`stage.pen.delta`). Each delta is also
	 * recorded as the whole `stage.pen` frame it makes, so a check reads every revision the same way.
	 */
	const pens = new Map();
	ws.onmessage = (event) => {
		const message = JSON.parse(String(event.data));
		received.push(message);
		const key = `${message.agentId}|${message.stage}`;
		if (message.type === "stage.pen") pens.set(key, message);
		else if (message.type === "stage.pen.delta") {
			const held = pens.get(key);
			if (held?.rev !== message.from) return ws.send(JSON.stringify({ type: "stage.pen.get", agentId: message.agentId }));
			const whole = { type: "stage.pen", agentId: message.agentId, stage: message.stage, rev: message.rev, doc: applyEdits(held.doc, message.edits), base: message.base };
			pens.set(key, whole);
			received.push(whole);
		}
	};
	const link = {
		received,
		send: (message) => ws.send(JSON.stringify(message)),
		last: (type) => received.filter((m) => m.type === type).at(-1),
		close: () => ws.close(),
	};
	/*
	 * What a board frame acts on is **the stage of the agent this socket is on**. A new socket
	 * starts on the conversation last opened anywhere, which is the page's own when a check has
	 * just opened one; a check that drives boards over the wire for a particular agent sends
	 * `agent.focus` first, which moves this socket alone.
	 */
	return link;
}

/*
 * What the server last said an agent has on its stage: its `context.changed`, or its row in the
 * `agents` roster, whichever came later. The roster is the only word when nothing changed: a fresh
 * server's first agent may already be on the fixture's canvas, and opening it again changes nothing.
 */
const holding = (link, agent) => {
	let inPlay = [];
	for (const m of link.received) {
		if (m.type === "context.changed" && m.agentId === agent) inPlay = m.inPlay ?? [];
		else if (m.type === "agents") inPlay = m.chats?.find((chat) => chat.id === agent)?.inPlay ?? inPlay;
	}
	return inPlay;
};

/**
 * Put the fixture's canvas on the focused agent's stage, with each of its cards where the fixture has it.
 *
 * Most of these checks expect to see every card.
 * Without this they inherit whatever the previous check narrowed the stage to, and fail
 * for reasons that have nothing to do with what they test.
 *
 * A URL is for the runner, which has one server per worker and so no single `API` to read;
 * checks call it with their page, or nothing, and get this process's `API`.
 */
export async function resetStage(at) {
	const api = typeof at === "string" ? at : API;
	const wanted = FIXTURE_PLACES.map((one) => one.path);
	/*
	 * And where the fixture puts them, not wherever the last check left them.
	 *
	 * A card's place belongs to the canvas, so it survives from one call to the next within a check: a
	 * drag is still in force when the check flies to the plan and expects its neighbours. So each card is
	 * put back where the fixture's canvas file has it, one `card.move` per card, the same message a drag sends.
	 */
	const link = await socket(api);
	/*
	 * Confirmed, for the *focused* agent, and retried until it is.
	 *
	 * A fresh server is still starting its first agent when the first check begins, and that agent opens
	 * on a canvas of its own (a new agent joins the latest canvas of its workspace's agents, and it has
	 * none), so it is sent to the fixture's canvas (`agent.stage`) and this waits until the server says
	 * that agent holds every card. The greeting says who is focused; any other agent's `context.changed`
	 * describes a stage the browser is not looking at.
	 */
	const deadline = Date.now() + 25000;
	let landed = [];
	let agent;
	while (Date.now() < deadline) {
		agent = link.last("agents")?.focused ?? agent;
		if (agent) {
			link.send({ type: "agent.stage", id: agent, stage: CANVAS });
			for (const one of FIXTURE_PLACES) link.send({ type: "card.move", stage: CANVAS, path: one.path, x: one.x, y: one.y });
		}
		// Watched rather than slept on: the answer is usually back in a few milliseconds, and is resent after 1.5s.
		const resend = Date.now() + (agent ? 1500 : 100);
		while (Date.now() < resend) {
			await new Promise((resolve) => setTimeout(resolve, 25));
			landed = holding(link, agent);
			if (agent && wanted.every((path) => landed.includes(path))) break;
		}
		if (agent && wanted.every((path) => landed.includes(path))) break;
	}
	link.close();
	if (!agent) throw new Error("resetStage: the server never said which agent is focused");
	if (!wanted.every((path) => landed.includes(path))) {
		throw new Error(`resetStage: ${wanted.filter((path) => landed.includes(path)).length} of ${wanted.length} cards reached ${agent}'s stage: wanted ${wanted.join(", ")}; on it ${landed.join(", ")}`);
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
		await page.locator('button[aria-label="Show the side panel"]').first().click();
		await page.waitForFunction(() => document.querySelector(".panel-shell")?.dataset.open === "true", null, { timeout: 6000 });
		// It slides; a click landing mid-slide misses the row it was aimed at.
		await page.waitForTimeout(220);
	}
}

/**
 * Open the agent selector: the composer's recipient chip.
 *
 * The pill has no agent segment any more, so the one list you switch agents with hangs off the
 * chip that says who the line is going to — picking a row there focuses that agent, the same
 * as pressing its row in the panel. A popover rather than a panel, so what a check waits for
 * is the menu rather than a `data-open` on a surface that no longer exists.
 */
export async function openAgents(page) {
	if (await page.locator(".popover").count()) return;
	await page.locator(".dock-to-chip").first().click();
	await page.waitForSelector(".popover", { timeout: 6000 });
}

/**
 * How close the camera is, as a number.
 *
 * The zoom used to be a `.level` span in a bar in the bottom-right corner; it is a menu
 * chip in the top-right cluster now. Eleven checks read it, which is eleven reasons for
 * this to be a function rather than a selector copied eleven times.
 */
export async function zoom(page) {
	const text = await (await canvasFrame(page)).locator(".v3-zoom-value").first().textContent();
	return Number((text ?? "0%").replace(/[^\d.]/g, ""));
}

/** The same reading, from inside the canvas frame, for its `waitForFunction`. */
export const ZOOM_IN_PAGE = `Number((document.querySelector('.v3-zoom-value')?.textContent ?? "0%").replace(/[^0-9.]/g, ""))`;

/**
 * Summon the conversation, and wait until it is actually up.
 *
 * `data-shown` rather than a class, because the column is mounted whether or not it has the
 * right edge — `state/edge.ts` decides who does, and "mounted" and "shown" are different
 * questions now that the inspector can borrow the edge from it.
 *
 * `time-machine` and `chrome` call this now. They used to click a block on the *spine* to
 * open the history at a turn, and the spine went with the title bar — so they were clicking
 * nothing and timing out before their first assertion.
 */
export async function openHistory(page) {
	if ((await page.locator("[data-shown='true']").count()) > 0) return;
	/* v3: the conversation is the `.v3-chat` section, folded or not; its title unfolds it. */
	if ((await page.locator(".v3-chat").count()) > 0) {
		if ((await page.locator(".v3-chat[data-folded='true']").count()) === 0) return;
		await page.locator(".v3-chat .v3-chat-title").first().click();
		await page.waitForSelector(".v3-chat:not([data-folded='true'])", { timeout: 6000 });
		return;
	}
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
	 * From the panel's `+` ("New agent"), which opens the runtimes — the same `+` and list the
	 * composer carries. The runtime cannot change afterwards, so picking one is
	 * what makes the agent. The count is of the agent list's rows, which only lists agents now.
	 */
	await openAgents(page);
	const agentsBefore = await page.evaluate(
		() => document.querySelectorAll('.popover [data-row][data-flat="true"]').length,
	);
	await page.keyboard.press("Escape");
	/*
	 * v3 has no top-left pill: the `+` is the "New agent" button at the foot of the side panel's
	 * Agents tab (`.v3-new-agent`). The panel is opened and put on that tab first.
	 */
	await openPanel(page);
	const agentsTab = page.locator('.v3-nav [role="tab"]').filter({ hasText: /^\s*Agents\s*$/i }).first();
	if ((await agentsTab.count()) > 0 && (await agentsTab.getAttribute("aria-selected")) !== "true") {
		await agentsTab.click();
		await page.waitForTimeout(250);
	}
	await page.locator(".v3-new-agent, .pill .new-agent").first().click();
	// The runtimes' rows say each runtime's name (`AgentChoices`): "Pi", "Claude Code", …
	await page.locator(".popover [data-row]").filter({ has: page.locator(".row-label", { hasText: new RegExp(`^\\s*${kind}`, "i") }) }).first().click();
	/*
	 * Counted with the menu re-opened, because picking closes it — and counted as agent
	 * *rows* rather than every `[data-row]`.
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
export async function openAllCards(page) {
	// The side panel's Canvas tab lists what is on the canvas, boards among it (`.v3-item`).
	await openPanel(page);
	const tab = page.locator('.v3-nav [role="tab"]').filter({ hasText: /^\s*Canvas\s*$/i }).first();
	if ((await tab.count()) > 0 && (await tab.getAttribute("aria-selected")) !== "true") await tab.click();
	await page.waitForSelector('.v3-item[data-kind="board"]', { timeout: 6000 });
	await page.waitForTimeout(300);
}

/** A short settle for things with no observable signal — a CSS transition, mostly. */
export function settle(page, ms = 350) {
	return page.waitForTimeout(ms);
}

/**
 * Where two versions of a file differ, as a **byte range** rather than a line count.
 *
 * This replaces two assertions that counted lines:
 *
 *     after.split("\n").filter((line, index) => line !== before[index])
 *
 * and called the result "moves one line of the file". It does not measure that, and the reason is
 * worth writing down because the shape of the mistake is easy to repeat. Measured on `boards/notes.html`,
 * one retyped paragraph reported **24** — and 24 is `42 - 18`: the file had 44 lines before and 42 after,
 * so from the deletion at line 18 **every line after it differs at its own index**. The count is the
 * *position* of an edit in the file, not its size, and it moves when the file's length moves.
 *
 * That made a real fix look like a failure. The editor collapses a run's wrapping when it opens it, so
 * that the words being typed are the words in the file rather than the file's indentation — which turns a
 * five-line paragraph into one line, deliberately. A line count can only report that as "the rest of the
 * file changed".
 *
 * What is worth asserting is a region: which bytes differ, and whether they lie inside the node the editor
 * says it is editing. This finds that region the only way it can be found without a diff library — the
 * longest common prefix and the longest common suffix — and returns offsets into the *old* file, which is
 * the version the node's byte range comes from.
 */
export function differ(before, after) {
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) start++;
	let tail = 0;
	while (
		tail < before.length - start &&
		tail < after.length - start &&
		before[before.length - 1 - tail] === after[after.length - 1 - tail]
	)
		tail++;
	return {
		start,
		/** One past the last changed byte, in the old file and in the new one. */
		endBefore: before.length - tail,
		endAfter: after.length - tail,
		/** The changed text on each side, so a detail line can show it. */
		before: before.slice(start, before.length - tail),
		after: after.slice(start, after.length - tail),
		lines: { before: before.split("\n").length, after: after.split("\n").length },
		/** Open tags on each side: a bound on markup the edit added or removed. */
		tags: { before: (before.match(/<[a-zA-Z]/g) ?? []).length, after: (after.match(/<[a-zA-Z]/g) ?? []).length },
	};
}

/**
 * The byte range of the `nth` `<tag>…</tag>` in a file, so a check can say what an edit is *inside of*.
 *
 * The open tag is matched by name and closed at its `>`, because a tag with attributes is the common case
 * (`<p class="lead">`) and `indexOf("<p>")` would miss it.
 */
export function rangeOf(html, tag, nth = 1) {
	let at = -1;
	for (let i = 0; i < nth; i++) at = html.indexOf("<" + tag, at + 1);
	if (at === -1) return undefined;
	const open = html.indexOf(">", at);
	const close = open === -1 ? -1 : html.indexOf("</" + tag + ">", open);
	return open === -1 || close === -1 ? undefined : { start: at, end: close + tag.length + 3, open: open + 1, close };
}

/**
 * The byte range of the element carrying an attribute, found by its value.
 *
 * For the case where the thing named is not a tag but a component: the file addresses a card by
 * `data-id`, and what an edit to that card may touch is the card's own bytes. Nesting of the same tag is
 * not handled, and does not need to be — the elements this is pointed at hold no element of their own kind.
 */
export function rangeOfAttr(html, attr, value) {
	const needle = attr + '="' + value + '"';
	const at = html.indexOf(needle);
	if (at === -1) return undefined;
	const start = html.lastIndexOf("<", at);
	const name = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start, at));
	if (start === -1 || !name) return undefined;
	const open = html.indexOf(">", at);
	const close = open === -1 ? -1 : html.indexOf("</" + name[1] + ">", open);
	return open === -1 || close === -1 ? undefined : { start, end: close + name[1].length + 3, open: open + 1, close };
}

/**
 * Select a board the way a person does now that boards have no title bars: click it. The point is
 * one that is really on the board — not under the sidebar, a toolbar, the composer or the pill — and
 * then the board's pill (`canvas/BoardCallout.tsx`) is waited for.
 */
const innerWidthOf = (page) => page.viewportSize()?.width ?? 1440;

export async function selectCard(page, path, { timeout = 4000 } = {}) {
	const canvas = await canvasFrame(page);
	// A board is its picture on the stage's sheet; a card, a document or an app awake has a node. The stage says where each is.
	const candidates = () => canvas.evaluate((wanted) => {
		const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
		const r = node?.getBoundingClientRect() ?? window.__decksCards?.().find((one) => one.path === wanted)?.rect;
		if (!r) return [];
		const stage = document.querySelector(".stage");
		const out = [];
		for (const fy of [0.08, 0.2, 0.35, 0.5, 0.65, 0.8]) {
			for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
				const x = r.x + r.width * fx;
				const y = r.y + r.height * fy;
				if (x < 1 || y < 1 || x > innerWidth - 2 || y > innerHeight - 2) continue;
				const hit = document.elementFromPoint(x, y);
				if (node ? hit && hit.closest(".card-node") === node && !hit.closest("a, button, input, textarea, select") : (hit === stage || stage?.contains(hit)) && window.__decksPictureAt?.(x, y) === wanted) out.push({ x, y });
			}
		}
		return out;
	}, path);
	// And not under the page's own chrome: the side panel, a top bar, the composer.
	const spot = async () => {
		for (const at of await candidates()) if (await onCanvasAt(page, at.x, at.y)) return at;
		return null;
	};
	let at = await spot();
	// Off screen, or under the chrome: fit the canvas, as a person looking for it would.
	if (!at) {
		const fitButton = canvas.locator('button[aria-label="Fit everything on the canvas"]').first();
		if (await fitButton.isVisible().catch(() => false)) {
			await fitButton.click();
			await rest(page);
			at = await spot();
		}
	}
	// Still under the composer or a panel: pan it to the middle of the window.
	if (!at) {
		const off = await canvas.evaluate((wanted) => {
			const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
			const r = node?.getBoundingClientRect() ?? window.__decksCards?.().find((one) => one.path === wanted)?.rect;
			if (!r) return null;
			return { dx: r.x + r.width / 2 - innerWidth / 2, dy: r.y + r.height / 2 - innerHeight / 2 };
		}, path);
		if (off) {
			await page.mouse.move(innerWidthOf(page) / 2, 200);
			await page.mouse.wheel(off.dx, off.dy);
			await page.waitForTimeout(500);
			at = await spot();
		}
	}
	if (!at) {
		const why = await canvas.evaluate((wanted) => {
			const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
			const r = node?.getBoundingClientRect() ?? window.__decksCards?.().find((one) => one.path === wanted)?.rect;
			if (!r) return "not on the canvas";
			const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
			return `at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}, its middle under ${hit?.tagName.toLowerCase()}.${String(hit?.className ?? "").split(" ")[0]}`;
		}, path);
		throw new Error(`no uncovered point on ${path} to click: ${why}`);
	}
	await page.mouse.click(at.x, at.y);
	// The selected item's pill (`canvas/BoardCallout.tsx`).
	await canvas.waitForSelector(".card-callout:not([data-hidden])", { timeout });
	await page.waitForTimeout(150);
}

/** Select a board and fly the camera to it with the pill's Fit — what a double-click on its bar used to do. */
export async function flyToCard(page, path) {
	await selectCard(page, path);
	await pressCardAction(page, "Fit");
	await rest(page);
}

/**
 * One of the selected item's actions on its pill, by its word: Fit, Focus, New tab, Hide. `label` may
 * be a list, of which the first the pill offers is pressed; false when it offers none.
 */
export async function pressCardAction(page, label) {
	const labels = [label].flat();
	const canvas = await canvasFrame(page);
	/*
	 * The pill sits only over the item's top edge or under its bottom one and stays there, so with an
	 * item filling the screen it is off it, or under the composer: `1` frames the selected item, which
	 * is what Fit does, and brings the pill into the open for anything else.
	 */
	const pillAt = () =>
		canvas.evaluate(() => {
			const pill = document.querySelector(".stage-fixed > .card-callout");
			if (!pill || pill.hasAttribute("data-hidden")) return null;
			const r = pill.getBoundingClientRect();
			const x = r.x + r.width / 2;
			const y = r.y + r.height / 2;
			if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
			const hit = document.elementFromPoint(x, y);
			return hit && pill.contains(hit) ? { x, y } : null;
		});
	// The pill hides while the camera moves and comes back a moment after it rests.
	const shownPill = () => canvas.waitForFunction(() => { const pill = document.querySelector(".stage-fixed > .card-callout"); return !!pill && !pill.hasAttribute("data-hidden"); }, null, { timeout: 3000 }).catch(() => {});
	const at = await pillAt();
	if (!at || !(await onCanvasAt(page, at.x, at.y))) {
		await focusCanvas(page);
		await page.keyboard.press("1");
		if (labels.includes("Fit")) return true;
		await rest(page);
		await shownPill();
	}
	const pill = canvas.locator(`.card-callout :is(${labels.map((one) => `[role=menuitem][aria-label="${one}"]`).join(", ")})`).first();
	if ((await pill.count()) === 0) return false;
	// The button itself under the page's chrome (the side panel, say) though the pill's middle is not: framed once more, then pressed where it is.
	const button = await pill.boundingBox();
	if (button && !(await onCanvasAt(page, button.x + button.width / 2, button.y + button.height / 2))) {
		await focusCanvas(page);
		await page.keyboard.press("1");
		await rest(page);
		await shownPill();
	}
	const box = await pill.boundingBox();
	if (box && (await onCanvasAt(page, box.x + box.width / 2, box.y + box.height / 2))) return page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).then(() => true);
	return pill.click().then(() => true);
}

/**
 * A point on the band along an awake item's edge, which moves it (`item-slot.tsx`): on the screen
 * and uncovered, or null. The band shows on the item under the pointer or the selected one.
 */
export async function cardEdge(page, path) {
	const canvas = await canvasFrame(page);
	// The bands are drawn on the item under the pointer (or the selected one), so point at it first.
	const box = await canvas.locator(`.card-node[data-path="${path}"]`).boundingBox().catch(() => null);
	if (box) {
		const x = Math.min(Math.max(box.x + box.width / 2, 2), page.viewportSize().width - 2);
		const y = Math.min(Math.max(box.y + Math.min(box.height / 2, 40), 2), page.viewportSize().height - 2);
		await page.mouse.move(x, y);
		await canvas.waitForFunction((wanted) => [...document.querySelectorAll(".card-edge")].some((band) => band.closest(".card-node")?.dataset.path === wanted), path, { timeout: 2000 }).catch(() => {});
	}
	const points = await canvas.evaluate((wanted) => {
		const out = [];
		for (const band of document.querySelectorAll(".card-edge")) {
			if (band.closest(".card-node")?.dataset.path !== wanted) continue;
			const r = band.getBoundingClientRect();
			const along = band.dataset.side === "n" || band.dataset.side === "s";
			for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
				// The outer part of the band: clear of the item's own edge.
				const x = along ? r.x + r.width * f : band.dataset.side === "w" ? r.x + 3 : r.right - 3;
				const y = along ? (band.dataset.side === "n" ? r.y + 3 : r.bottom - 3) : r.y + r.height * f;
				if (x < 1 || y < 1 || x > innerWidth - 2 || y > innerHeight - 2) continue;
				if (document.elementFromPoint(x, y) === band) out.push({ x, y, side: band.dataset.side });
			}
		}
		return out;
	}, path);
	for (const at of points) if (await onCanvasAt(page, at.x, at.y)) return at;
	return null;
}

/**
 * An agent of its own on an empty canvas: made over a socket in a workspace nothing else uses, so
 * it gets a fresh canvas rather than joining its workspace's latest one, and then picked from the
 * composer's agent list, which goes to its stage. Returns the chat, `{ id, name }`; a check that
 * makes one removes it at the end (`agent.remove`) so the checks after it see the deck they expect.
 */
export async function freshAgent(page, workspace) {
	const link = await socket();
	await page.waitForTimeout(300);
	const known = new Set((link.last("agents")?.chats ?? []).map((chat) => chat.id));
	link.send({ type: "agent.create", workspace });
	let made;
	for (let i = 0; i < 60 && !made; i += 1) {
		made = (link.last("agents")?.chats ?? []).find((chat) => !known.has(chat.id));
		if (!made) await page.waitForTimeout(150);
	}
	link.close();
	if (!made) throw new Error(`no agent was made in ${workspace}`);
	await openAgents(page);
	await page.locator('.popover [data-agent="true"]').filter({ hasText: made.name }).first().click();
	await page.waitForTimeout(800);
	return made;
}

/**
 * The canvas frame's line to the harness held back, as a far network holds it: the answer to each edit
 * the frame sends (`canvas.batch`) and every change on the stream it follows the drawing on
 * (`/api/v1/events`), each `ms` late and in order. The page's own socket is the check's to route.
 *
 * Call it before the page loads (it installs a script in every frame, and the frame made after it
 * is what it reaches), then `set(ms)` around what is measured; `queued()` is what is still held back.
 */
export async function lagCanvasLine(page) {
	const state = { ms: 0, queued: 0 };
	await page.addInitScript(() => {
		if (!location.pathname.endsWith("canvas-frame.html")) return;
		const real = globalThis.fetch.bind(globalThis);
		globalThis.__decksLag = { ms: 0, queued: 0 };
		globalThis.fetch = async (input, init) => {
			const response = await real(input, init);
			const url = typeof input === "string" ? input : (input?.url ?? String(input));
			if (!/\/v1\/events\b/.test(url) || !response.body) return response;
			const reader = response.body.getReader();
			const lag = globalThis.__decksLag;
			let last = 0;
			const body = new ReadableStream({
				start(controller) {
					void (async () => {
						for (;;) {
							const { done, value } = await reader.read();
							const at = Math.max(Date.now() + lag.ms, last);
							last = at;
							lag.queued++;
							setTimeout(() => {
								lag.queued--;
								try {
									if (done) controller.close();
									else controller.enqueue(value);
								} catch {
									/* the frame stopped reading */
								}
							}, at - Date.now());
							if (done) return;
						}
					})().catch((error) => controller.error(error));
				},
				cancel: (reason) => reader.cancel(reason),
			});
			return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
		};
	});
	await page.route(/\/api\/v1\/canvas\.batch/, async (route) => {
		const ms = state.ms;
		state.queued++;
		try {
			const response = await route.fetch();
			if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
			await route.fulfill({ response });
		} catch {
			await route.abort().catch(() => {});
		} finally {
			state.queued--;
		}
	});
	const inFrame = async (run, arg) => {
		const frame = page.frames().find((one) => !one.isDetached() && one.url().includes("canvas-frame.html"));
		return frame ? frame.evaluate(run, arg).catch(() => undefined) : undefined;
	};
	return {
		async set(ms) {
			state.ms = ms;
			await inFrame((ms) => globalThis.__decksLag && (globalThis.__decksLag.ms = ms), ms);
		},
		async queued() {
			return state.queued + ((await inFrame(() => globalThis.__decksLag?.queued ?? 0)) ?? 0);
		},
	};
}

/** Fit everything on the canvas, as the zoom bar's button in the frame does, and wait for the camera to rest. */
export async function fitCanvas(page) {
	const canvas = await canvasFrame(page);
	await canvas.locator("[aria-label='Fit everything on the canvas']").first().click();
	await rest(page);
}
