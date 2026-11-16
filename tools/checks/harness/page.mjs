// The page and its canvas frame, as a check drives them: opened, focused and zoomed, and the
// conversation and the panel beside it (a turn asked and waited for, the agent list, a new agent).
import { chromium, devices, webkit } from "playwright";
import { WEB, card, socket } from "./programs.mjs";
import { canvasFrame, ready, rest } from "./waits.mjs";

// The page and its canvas frame: opened, focused, zoomed, fitted.

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
 * dispatch real touches. The phone check it was made for has been cut; `context.mjs` is
 * the one caller left, and it only wants the narrow viewport — nothing dispatches a touch
 * any more.
 */
export async function open({ width = 1500, height = 950, scheme = "dark", cards = true, device, edit = false, dpr, engine = "chromium", init, before, panelTab = "canvas" } = {}) {
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
	// a viewport size can stand in for. The renderer check, its only caller, has been cut,
	// so nothing passes `dpr` today — the option is kept for the next check that needs it.
	const context = descriptor
		? await browser.newContext({ ...descriptor })
		: await browser.newContext({ viewport: { width, height }, ...(dpr ? { deviceScaleFactor: dpr } : {}) });
	const page = await context.newPage();
	/* `init` runs in the page before the app does, in every frame: to take an API away, say (`backends.mjs`). */
	if (init) await page.addInitScript(init);
	/* `before` runs here, with the page made and nothing loaded: to route the frame's line, say (`lagCanvasLine`). */
	if (before) await before(page);
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
	// Below the live zoom a board has no node, only its picture (`CanvasView.tsx`): the stage lists them.
	const boards = () => canvas.evaluate(() => window.__decksProbes?.cards?.().length ?? document.querySelectorAll(".card-node").length);
	await canvas.waitForFunction(() => (window.__decksProbes?.cards?.().length ?? 0) > 0, null, { timeout: 30000 }).catch(() => {});
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
			const rects = (window.__decksProbes?.cards?.() ?? []).map((one) => one.rect);
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

/** Fit everything on the canvas, as the zoom bar's button in the frame does, and wait for the camera to rest. */
export async function fitCanvas(page) {
	const canvas = await canvasFrame(page);
	await canvas.locator("[aria-label='Fit everything on the canvas']").first().click();
	await rest(page);
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
	await canvas.waitForFunction(() => document.querySelectorAll(".card-node").length === 0 && (window.__decksProbes?.cards?.().length ?? 0) === 0, null, { timeout });
}

// The conversation and the panel: a turn asked and waited for, the agent list, a new agent.

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
