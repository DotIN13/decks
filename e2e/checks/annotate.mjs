/**
 * Commenting and drawing on a board while browsing.
 *
 * Two tools a reader has without entering edit mode. Selecting words offers a comment on
 * them, which either becomes a pill in the input bar, to go with the next message, or
 * is sent at once; and
 * the brush draws on the stage, into its `.pen` file as one pen `path` per stroke with the
 * points it was drawn from in `metadata` (`canvas/pen/ink.ts`). The board's own file is untouched.
 *
 * No agent is prompted: `agent.prompt` frames are caught on their way into the socket and
 * read here, because what matters is the message the agent would have been given.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { boardPath, deckState, open, read, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

await page.evaluate(() => {
	window.__prompts = [];
	const real = WebSocket.prototype.send;
	WebSocket.prototype.send = function (data) {
		try {
			const message = JSON.parse(data);
			if (message.type === "agent.prompt") {
				window.__prompts.push(message.text);
				return;
			}
		} catch {
			/* not JSON: not ours */
		}
		return real.call(this, data);
	};
});
const prompts = () => page.evaluate(() => window.__prompts);

await page.locator(`.bar-layer .chrome[data-path="${await page.evaluate(() => document.querySelector(".board-node").dataset.path)}"]`).click();
await page.keyboard.press("1");
await settle(page, 900);

const path = await page.evaluate(() => document.querySelector(".board-node[data-selected='true']")?.dataset.path ?? document.querySelector(".board-node")?.dataset.path);
const file = await boardPath(path.replace(/^boards\//, ""));
const before = read(file);
const node = `.board-node[data-path="${path}"]`;

// --- a comment ---------------------------------------------------------------------------

/** Drag across the first line of a paragraph: a real selection, made the way a reader makes one. */
const selectWords = async (from, to) => {
	const at = await page.evaluate((selector) => {
		const frame = document.querySelector(`${selector} iframe`);
		const element = frame?.contentDocument?.querySelector("[data-id] p, [data-id] li, p");
		if (!frame || !element) return null;
		const outer = frame.getBoundingClientRect();
		const inner = element.getBoundingClientRect();
		const k = outer.width / frame.clientWidth;
		return { x: outer.x + inner.x * k, y: outer.y + (inner.y + 9) * k, k };
	}, node);
	await page.mouse.move(at.x + from * at.k, at.y);
	await page.mouse.down();
	await page.mouse.move(at.x + to * at.k, at.y, { steps: 8 });
	await page.mouse.up();
	await settle(page, 500);
};

await selectWords(4, 170);
say("selecting words while browsing offers a comment", (await page.locator(".comment-start").count()) === 1);
say("…as one small button, not a box that opens on every selection", (await page.locator(".comment-field").count()) === 0);

await page.click(".comment-start");
await page.waitForSelector(".comment-field");
const quoted = (await page.locator(".comment-quote").innerText()).trim();
say("the box quotes what was selected", quoted.length > 8, JSON.stringify(quoted));
await page.fill(".comment-field", "Is this still right?");
await page.keyboard.press("Enter");
await settle(page, 400);
const pills = () => page.locator('.dockfield [data-component="mention-pill"]');
say("Enter keeps it for the next message: a pill inside the input bar's text, an icon and the words", (await pills().count()) === 1 && /^“/.test((await pills().first().innerText()).trim()) && (await pills().first().locator("svg").count()) === 1, await page.locator(".dockfield").innerText());
say("…whose hover says the words and the comment", ((await pills().first().getAttribute("title")) ?? "").endsWith("Is this still right?"));
say("…and the caret is in the bar, after it", await page.evaluate(() => document.activeElement?.classList.contains("dockfield") ?? false));
say("…and nothing has been sent", (await prompts()).length === 0);
say("…and the popup is gone", (await page.locator(".comment-popup").count()) === 0);
const marked = await page.evaluate((selector) => document.querySelector(`${selector} iframe`).contentWindow.CSS.highlights?.has("decks-comment") ?? null, node);
say("…and its words are marked on the board, without touching the document", marked === true && read(file) === before, String(marked));

await selectWords(190, 330);
await page.click(".comment-start");
await page.fill(".comment-field", "Shorter.");
await page.keyboard.press("Control+Enter");
await settle(page, 400);
const first = await prompts();
say("⌘Enter sends a comment at once, as a message of its own", first.length === 1 && /^A comment on a board\./.test(first[0]) && first[0].endsWith("Shorter."), JSON.stringify(first));
say("…naming the board and quoting the words", first[0]?.includes(path) && /\n {3}> \S/.test(first[0]), JSON.stringify(first[0]));
say("…and the kept comment is still in the bar", (await pills().count()) === 1);

/* Not a real reload: the harness clears localStorage on every load, by design. What a reload
   reads is this key, and reading it back is `comments.test.ts`. */
const stored = await page.evaluate(() => localStorage.getItem("decks.comments") ?? "");
say("a kept comment is stored, so a reload does not lose it", stored.includes("Is this still right?"), stored.slice(0, 80));
await page.evaluate(() => (window.__prompts = []));
await page.locator(".dockfield").click();
await page.keyboard.press("End");
await page.keyboard.type("Then fit the board.");
await page.keyboard.press("Enter");
await settle(page, 400);
const withMessage = (await prompts())[0] ?? "";
say("the next message carries it in front", withMessage.includes("Is this still right?") && /^A comment on a board\./.test(withMessage), JSON.stringify(withMessage));
say("…and where the pill sat in the sentence it reads as [comment 1]", withMessage.endsWith("[comment 1] Then fit the board."), JSON.stringify(withMessage.slice(-60)));
say("…and the bar is empty again, with nothing stored", (await pills().count()) === 0 && (await page.evaluate(() => localStorage.getItem("decks.comments"))) === null);

/* A pill is one object: one Backspace takes it, and its comment with it. */
await selectWords(4, 120);
await page.click(".comment-start");
await page.fill(".comment-field", "Never mind.");
await page.keyboard.press("Enter");
await settle(page, 400);
await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace");
await settle(page, 300);
const dropped = await page.evaluate((selector) => ({
	stored: localStorage.getItem("decks.comments"),
	marked: document.querySelector(`${selector} iframe`).contentWindow.CSS.highlights?.has("decks-comment") ?? false,
}), node);
say("Backspace deletes a pill whole, and the comment and its mark go with it", (await pills().count()) === 0 && dropped.stored === null && dropped.marked === false, JSON.stringify(dropped));

// --- drawing, on the stage ------------------------------------------------------------------

const deck = await deckState();
/** The stage file the drawing lands in: the one most recently written. */
const stageFile = () => {
	const dir = join(deck.path, "stages");
	if (!existsSync(dir)) return undefined;
	return readdirSync(dir)
		.map((name) => join(dir, name, "stage.pen"))
		.filter((f) => existsSync(f))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
};
const stage = () => {
	const f = stageFile();
	return f ? JSON.parse(read(f)) : { children: [] };
};
const inks = () => stage().children.filter((n) => n.type === "path" && n.metadata?.type === "decks.ink");
const startInks = inks().length;
const drawn = () => inks().length - startInks;

await page.locator(`.bar-layer .chrome[data-path="${path}"]`).click();
await page.keyboard.press("1");
await settle(page, 900);
await page.click('[aria-label="Draw on the stage"]');
await page.waitForSelector(".ink-bar");
say("the brush brings the drawing tools", (await page.locator(".ink-bar .icon-button").count()) >= 8);

const sheet = await page.locator(`${node}`).boundingBox();
const x0 = sheet.x + sheet.width * 0.35;
const y0 = sheet.y + sheet.height * 0.3;

/*
 * The stroke must not blink when the pen lifts: it stays on the glass until the stage has drawn
 * it. Every frame from the lift on, either the glass still holds it or the stage's own list of
 * strokes has it — never neither.
 */
await page.evaluate(() => {
	window.__lift = [];
	const strokesOnGlass = () => [...document.querySelectorAll(".stage-ink g > path:not(.ink-loop)")].filter((p) => p.getAttribute("d")).length;
	window.__watchLift = () => {
		const start = performance.now();
		const tick = () => {
			window.__lift.push(strokesOnGlass());
			if (performance.now() - start < 1200) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	};
});
await page.mouse.move(x0, y0);
await page.mouse.down();
for (let i = 1; i <= 16; i++) await page.mouse.move(x0 + i * 7, y0 + Math.sin(i / 2.5) * 24);
await page.evaluate(() => window.__watchLift());
await page.mouse.up();
await settle(page, 900);
const lift = await page.evaluate(() => window.__lift);
// The glass goes from holding the stroke to empty exactly once, and by then the stage has it.
const handedOver = lift.findIndex((n) => n === 0);
say("lifting the pen does not blink: the glass holds the stroke until the stage has drawn it", lift[0] === 1 && handedOver > 0 && lift.slice(handedOver).every((n) => n === 0) && inks().length - startInks === 1, lift.join(""));
const firstInk = inks().at(-1);
say("a stroke over a board goes on the stage, as a pen path with its points", drawn() === 1 && typeof firstInk?.geometry === "string" && Array.isArray(firstInk?.metadata?.points), JSON.stringify(firstInk)?.slice(0, 200));
say("…in the ink colour, which follows light and dark", firstInk?.stroke === "$decks-ink" && Array.isArray(stage().variables?.["decks-ink"]?.value), JSON.stringify(stage().variables));
say("…and the board's own file is untouched", read(file) === before);

await page.click('.ink-bar [aria-label^="Marker"]');
await page.click('.ink-bar [aria-label="Yellow"]');
await page.mouse.move(x0, y0 + 70);
await page.mouse.down();
await page.mouse.move(x0 + 130, y0 + 72, { steps: 6 });
await page.mouse.up();
await settle(page, 900);
const marker = inks().at(-1);
say("a marker stroke is wide, yellow and see-through", marker?.metadata?.tool === "marker" && marker?.metadata?.color === "yellow" && marker?.opacity === 0.4, JSON.stringify(marker?.metadata && { ...marker.metadata, points: undefined }));

await page.keyboard.press("Control+z");
await settle(page, 900);
say("⌘Z takes the last stroke back", drawn() === 1, String(drawn()));
await page.keyboard.press("Control+Shift+z");
await settle(page, 900);
say("⇧⌘Z puts it back", drawn() === 2, String(drawn()));

await page.click('.ink-bar [aria-label^="Lasso"]');
await page.mouse.move(x0 - 20, y0 - 45);
await page.mouse.down();
for (const [dx, dy] of [[150, -45], [150, 45], [-20, 45], [-20, -45]]) await page.mouse.move(x0 + dx, y0 + dy, { steps: 5 });
await page.mouse.up();
await settle(page, 300);
say("a lasso round a stroke selects it", (await page.locator(".ink-selection").count()) === 1);
const wasY = inks().find((n) => n.id === firstInk.id)?.y;
await page.mouse.move(x0 + 40, y0);
await page.mouse.down();
await page.mouse.move(x0 + 40, y0 + 120, { steps: 5 });
await page.mouse.up();
await settle(page, 900);
const nowY = inks().find((n) => n.id === firstInk.id)?.y;
say("…and dragging the selection moves it, in the file too", typeof nowY === "number" && nowY > wasY && drawn() === 2, `${wasY} -> ${nowY}`);
await page.keyboard.press("Delete");
await settle(page, 900);
say("…and Delete removes it", drawn() === 1 && !inks().some((n) => n.id === firstInk.id));

await page.click('.ink-bar [aria-label^="Eraser"]');
await page.mouse.move(x0 + 50, y0 + 50);
await page.mouse.down();
await page.mouse.move(x0 + 50, y0 + 95, { steps: 6 });
await page.mouse.up();
await settle(page, 900);
say("the eraser removes the stroke it touches", drawn() === 0, String(drawn()));

// --- a pencil -----------------------------------------------------------------------------

/* Playwright has no stylus, so the events are made by hand: what matters is what the sheet does with them. */
const pointer = (type, kind, id, x, y, pressure) =>
	page.evaluate(
		([type, kind, id, x, y, pressure]) => {
			const target = document.querySelector(".stage-ink");
			target.dispatchEvent(new PointerEvent(type, { pointerType: kind, pointerId: id, clientX: x, clientY: y, pressure, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true }));
		},
		[type, kind, id, x, y, pressure],
	);
await page.click('.ink-bar [aria-label^="Pen"]');
await pointer("pointerdown", "pen", 41, x0, y0, 0.15);
for (let i = 1; i <= 10; i++) await pointer("pointermove", "pen", 41, x0 + i * 8, y0 + i * 2, 0.15 + i * 0.08);
await pointer("pointerup", "pen", 41, x0 + 80, y0 + 20, 0);
await settle(page, 900);
const pen = inks().at(-1);
const pressures = (pen?.metadata?.points ?? []).filter((_, i) => i % 3 === 2);
say("a pencil's pressure is kept, point by point", pressures[0] === 0.15 && Math.max(...pressures) >= 0.85, pressures.join(" "));
say("…and drawn as a filled outline, thin where it was light", !!pen?.fill && pen?.strokeWidth === undefined, JSON.stringify(pen && { fill: pen.fill, strokeWidth: pen.strokeWidth }));

await pointer("pointerdown", "touch", 42, x0, y0 + 60, 0.5);
await pointer("pointermove", "touch", 42, x0 + 60, y0 + 60, 0.5);
await pointer("pointerup", "touch", 42, x0 + 60, y0 + 60, 0);
await settle(page, 600);
say("once a pencil has drawn, a finger moves the canvas and draws nothing", drawn() === 1, String(drawn()));

await page.keyboard.press("Control+z");
await settle(page, 900);
say("the stage ends with the ink it began with", drawn() === 0 && read(file) === before, String(drawn()));
await page.keyboard.press("Escape");
await settle(page, 300);
say("Escape puts the pen down", (await page.locator(".ink-bar").count()) === 0 && (await page.locator(".stage-ink").count()) === 0);

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
