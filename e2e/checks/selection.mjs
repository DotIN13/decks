/**
 * Which board is selected — by every way in, and above all by pressing the board itself.
 *
 * The blue outline is `[data-selected="true"]` on the board's node, and *a lot* asks which board
 * that is: the inspector, the arrow keys on a deck, the double-click that opens a flow document's
 * source, `f` for the focus view, `⌫` to take a board off the canvas, the title bar's own menu.
 *
 * There are three ways to select one — the title bar, the rail, and the board itself — and the
 * third did not work. A press inside a board lands in the frame, which is a document of its own
 * and sends nothing up to the canvas, so the surface's own handler never sees it; and the listener
 * `BoardFrame` attached *inside* the frame was gated on the board having no components:
 *
 *     if (props.board.format !== "component") { … }
 *
 * which left a placed board with no way to be selected by pressing it at all. Browse is where
 * every session starts and where `Editor.ts` returns on its first line (`enabled()` is edit mode
 * **and** zoomed past the interaction threshold), so what a person actually did was click a board,
 * see nothing happen, and click its title bar instead — the same gesture meaning two things.
 *
 * What this check asserts, then, is the rule that replaced it: **a press inside a board selects
 * that board, whatever its format, in either mode** — and it does so without reloading the frame,
 * because a selection that redrew the page under the pointer would be worse than no selection.
 */
import { boardPath, editMode, open, resetStage, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1440, height: 1000 });
await resetStage(page);
await settle(page, 800);

/** Every board, where it is on screen, and whether its frame takes the pointer. */
const boards = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".board-node")].map((node) => {
			const r = node.getBoundingClientRect();
			return { path: node.dataset.path, x: r.x, y: r.y, w: r.width, h: r.height, inert: node.dataset.inert };
		}),
	);

const selected = () => page.evaluate(() => [...document.querySelectorAll('.board-node[data-selected="true"]')].map((n) => n.dataset.path));

/** The centre of what is left of a board once the app's own chrome is off, or nothing. */
const inside = (board) => {
	const x0 = Math.max(board.x, 250);
	const x1 = Math.min(board.x + board.w, 1400);
	const y0 = Math.max(board.y, 115);
	const y1 = Math.min(board.y + board.h, 940);
	return x1 - x0 < 24 || y1 - y0 < 24 ? undefined : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
};

/*
 * Fly to a board, so the deck is at a zoom where the frames take the pointer.
 *
 * Not the bar's centre: the acts at the right-hand end hold the buttons, and a double-click that
 * lands on one of them presses it.
 */
const first = (await boardPath("plan.html")) && "boards/plan.html";
await page.locator(`.bar-layer .chrome[data-path="${first}"]`).dblclick({ position: { x: 24, y: 12 } });
await settle(page, 900);
say("flying to a board selects it from its title bar", (await selected()).includes(first), (await selected()).join(", ") || "nothing selected");

/*
 * And back out, until two boards share the viewport.
 *
 * Under the interaction threshold the frame stops taking the pointer — the app puts
 * `data-inert="true"` on the node and a press lands on the surface, which selected the board all
 * along. The case that did nothing is above that threshold, so the check has to be above it too.
 */
for (let i = 0; i < 6; i++) {
	const level = Number(((await page.locator('.pill [aria-label^="Zoom"]').textContent()) ?? "0").replace(/[^0-9.]/g, ""));
	if (level <= 62) break;
	await page.keyboard.press("Control+Minus");
	await settle(page, 300);
}

const live = (await boards()).filter((board) => board.inert === "false" && inside(board));
say("two boards are on screen with their frames taking the pointer", live.length >= 2, live.map((b) => b.path).join(", "));

/*
 * The gesture, on a board that is **not** the selected one — which is the only version of it that
 * says anything: a press on the board you already selected cannot tell a handler from silence.
 */
const other = live.find((board) => board.path !== first);
const at = other && inside(other);
await page.evaluate((path) => {
	const frame = document.querySelector(`.board-node[data-path="${path}"] iframe`);
	if (frame) frame.contentWindow.__stillHere = 7;
}, other?.path);

if (at && other) {
	await page.mouse.click(at.x, at.y);
	await settle(page, 350);
	const now = await selected();
	say("a press inside a board's own body selects it", now.includes(other.path), `pressed ${other.path}, selected ${now.join(", ") || "nothing"}`);
	say("…and it is the only one selected", now.length === 1, `${now.length} selected`);
	const here = await page.evaluate(
		(path) => document.querySelector(`.board-node[data-path="${path}"] iframe`)?.contentWindow?.__stillHere ?? null,
		other.path,
	);
	say("…without reloading the board under the pointer", here === 7, "a reload would have taken the marker with it");

	/* And back, the same way — so the rule is a rule and not one lucky target. */
	const back = inside(live.find((board) => board.path === first));
	if (back) {
		await page.mouse.click(back.x, back.y);
		await settle(page, 350);
		say("…and pressing the first board moves the selection back", (await selected()).includes(first), (await selected()).join(", ") || "nothing");
	}
} else {
	say("two boards to press", false, "the fixture gave this check only one board on screen");
}

/*
 * In edit mode a press on a component still picks the component up — and with it the board it is
 * on, which is the other half of the same rule. The editor's own handler runs on the bubble phase
 * and the frame's on capture, so the order is: the board is selected, then the editor says what was
 * under the pointer.
 */
await editMode(page);
const onScreen = (await boards()).find((board) => board.inert === "false" && inside(board));
const component = onScreen
	? await page
			.frameLocator(`.board-node[data-path="${onScreen.path}"] iframe`)
			.locator("[data-id]")
			.first()
			.boundingBox()
			.catch(() => null)
	: null;
if (onScreen && component && component.x > 250 && component.y > 115) {
	await page.mouse.click(component.x + component.width / 2, component.y + component.height / 2);
	await settle(page, 400);
	say(
		"in edit mode, picking a component up selects the board it is on",
		(await selected()).includes(onScreen.path),
		(await selected()).join(", ") || "nothing selected",
	);
} else {
	say("a component on screen to press", false, `nothing clickable in ${onScreen?.path ?? "any board"}`);
}

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
