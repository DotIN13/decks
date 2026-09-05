/**
 * A background agent must not move your camera.
 *
 * The canvas is per conversation — it draws the focused agent's in-play set and nothing else
 * — and the camera was the one part of the view an agent you were not watching could still
 * reach into. A `stage.call` carried no agent id, so the browser could not tell whose `show`
 * it was carrying out, and it fits from the whole deck rather than from what is on screen:
 * an agent working in another corner flew your camera to a board that was not drawn on your
 * canvas at all. That is an empty view arriving while you sit still.
 *
 * What should happen instead is not "ignore it". The fit is remembered against that agent and
 * arrives, framed as it asked, the moment you open that chat — which is the last assertion
 * here, and it is checked by comparing against the same `show` issued while it *is* focused.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
try {
	await page.addInitScript(() => {
		if (window.top !== window.self) return;
		const Real = window.WebSocket;
		window.WebSocket = class extends Real {
			constructor(...args) {
				super(...args);
				window.__ws = this;
				// What the browser answers a stage call with, so an assertion can read it.
				window.__sent = [];
				const send = this.send.bind(this);
				this.send = (data) => {
					try {
						window.__sent.push(JSON.parse(data));
					} catch {
						/* not JSON, not ours */
					}
					return send(data);
				};
			}
		};
	});
	await page.reload({ waitUntil: "load" });
	await settle(page, 2500);

	const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
	const boards = await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path));
	say("the fixture has two boards to be far apart", boards.length >= 2, JSON.stringify(boards));

	const chat = (id, name) => ({
		id,
		name,
		kind: "claude",
		state: "idle",
		lastAt: Date.now(),
		unread: 0,
		contextCount: 1,
		capabilities: { modes: [] },
		commands: [],
	});
	await feed({ type: "agents", defaultKind: "pi", focused: "A", chats: [chat("A", "Ada"), chat("B", "Bo")] });
	await feed({ type: "context.changed", agentId: "A", boards: [boards[0]], inPlay: [boards[0]] });
	await feed({ type: "context.changed", agentId: "B", boards: [boards.at(-1)], inPlay: [boards.at(-1)] });
	await settle(page, 900);

	/** The camera, read off the world's own transform — exact, unlike a rendered frame. */
	const world = () => page.evaluate(() => (document.querySelector(".world")?.getAttribute("style") ?? "?").replace(/\s+/g, " "));
	const answers = () => page.evaluate(() => window.__sent.filter((frame) => frame?.type === "stage.result").map((frame) => frame.result));
	const call = (agentId, op, args) => feed({ type: "stage.call", call: { id: `${agentId}-${op}-${Date.now()}`, agentId, op, args } });

	const goTo = async (name) => {
		await page.evaluate(() => {
			const trigger = [...document.querySelectorAll(".float.pill button")].find((button) => /^Agents/.test(button.getAttribute("aria-label") ?? ""));
			trigger?.click();
		});
		await page.waitForSelector(".popover", { timeout: 4000 });
		await page.locator('.popover [data-agent="true"]').filter({ hasText: name }).first().click();
		await settle(page, 900);
	};

	await page.keyboard.press("0");
	await settle(page, 700);
	const ada = await world();

	// --- Bo, who is not on screen, asks for a view --------------------------------------

	await call("B", "show", { paths: [boards.at(-1)] });
	await settle(page, 700);
	const afterBackground = await world();
	const said = await answers();

	say("a background agent's show leaves your camera exactly where it was", afterBackground === ada, `${ada} → ${afterBackground}`);
	say("…and the boards on screen are still yours", (await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path))).includes(boards[0]));
	/*
	 * Told rather than lied to. An agent that asked for a view and got silence would have no
	 * way to know its board is not the one being looked at.
	 */
	say("…and it is told its view is waiting", said.some((result) => typeof result?.value?.deferred === "string"), JSON.stringify(said.at(-1)));

	// --- the one you are reading still moves the canvas ----------------------------------

	await call("A", "show", { paths: [boards[0]] });
	await settle(page, 700);
	const afterFocused = await world();
	say("the conversation you are reading still moves it", afterFocused !== afterBackground, `${afterBackground} → ${afterFocused}`);

	// --- and Bo's view is there when you open Bo -----------------------------------------

	await goTo("Bo");
	const opened = await world();
	const boBoard = await page.evaluate((path) => {
		const node = document.querySelector(`.board-node[data-path="${CSS.escape(path)}"]`);
		if (!node) return null;
		const rect = node.getBoundingClientRect();
		return { onScreen: rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight };
	}, boards.at(-1));
	say("opening Bo lands on Bo's board", boBoard?.onScreen === true, JSON.stringify(boBoard));

	/*
	 * And framed as it asked, not merely somewhere near. The same call, issued now that Bo is
	 * the conversation on screen, has to produce the identical transform — which is what
	 * "remembered rather than applied" means and what a fresh fit on switch would not give.
	 */
	await call("B", "show", { paths: [boards.at(-1)] });
	await settle(page, 700);
	const direct = await world();
	say("…framed exactly as it asked, not refitted on arrival", opened === direct, `${opened} vs ${direct}`);

	// --- going back is going back --------------------------------------------------------

	await goTo("Ada");
	const back = await world();
	say("and Ada's own view comes back untouched", back === afterFocused, `${afterFocused} → ${back}`);

	// --- and every reading says how much room the canvas has ------------------------------

	/*
	 * The number `stage.viewport()` answers with, and the one `newBoard` reports. It rides on
	 * the camera because they change together — and it is the *canvas*, not the window: a
	 * boards panel standing beside the canvas is not room a board can be read in.
	 */
	const readings = await page.evaluate(() => window.__sent.filter((frame) => frame?.type === "camera.set").map((frame) => frame.camera));
	const sized = readings.filter((camera) => camera.width > 0 && camera.height > 0);
	say("every camera reading carries the canvas size", sized.length === readings.length && readings.length > 0, `${sized.length}/${readings.length}`);

	const room = await page.evaluate(() => {
		const panel = document.querySelector('[data-inset="left"]');
		const top = document.querySelector('[data-inset="top"]');
		return {
			window: window.innerWidth,
			left: panel ? Math.round(panel.getBoundingClientRect().right) : 0,
			top: top ? Math.round(top.getBoundingClientRect().bottom) : 0,
		};
	});
	const last = sized.at(-1);
	say(
		"…and it is the canvas, not the window — the panel beside it is subtracted",
		room.left > 0 ? last.width === room.window - room.left : last.width === room.window,
		`${last?.width}px of canvas, ${room.window}px of window, ${room.left}px of panel`,
	);
	say("…and the height loses the chrome above it", last.height > 0 && last.height <= 1000 - room.top, `${last?.height}px, top inset ${room.top}px`);

	// One reading arrives without anybody panning: a session where the user only ever typed
	// used to report nothing at all, and an agent had no number to size a board against.
	say("a reading arrives without anybody touching the canvas", readings.length >= 1, `${readings.length} readings`);

	say("no console errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
