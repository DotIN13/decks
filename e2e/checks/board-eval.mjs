/**
 * A board's own code, run by pressing something on it.
 *
 * The board carries a script typed `text/decks-eval`, which a browser reads as text and never
 * runs, and a component naming it with `data-eval`. Pressing that component sends the *name*
 * of the block up to the app, the app stamps the board path from the frame, and the server
 * reads the code out of the board's own file, asks once whether this board is trusted, and
 * runs it with the stage API. This check is the whole path in a real browser:
 *
 * - the click reaches the app from a board's frame (not from the board's own script);
 * - the run is refused until the question is answered, and the question names the board;
 * - once allowed, the code runs, and a `stage` verb it calls lands on the canvas — which is
 *   the part that proves the stage object was real and not a stub: `cursor` is a canvas op
 *   keyed by the conversation on screen, and its label is the board's own identity — so a
 *   cursor under the board's name is the camera answering a board.
 *
 * The harness answers the question for us: it clicks a dialog button labelled exactly
 * `Allow`, which is why the first option has no description — a description would be inside
 * the button and the label would stop being the whole of its text.
 */
import { boardPath, open, resetStage, say, settle, socket, write } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);

const FIXTURE = "eval-fixture.html";
const PATH = `boards/${FIXTURE}`;
const LINK = await socket();

const BOARD = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Eval fixture</title>
		<meta name="board" content='{"w":640,"h":320,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<section class="card" data-id="go" data-eval="pick" data-value="round-20" style="left: 40px; top: 40px; width: 560px">
			<h3>Promote round 20</h3>
			<p>Pressing this runs the code the file carries.</p>
		</section>
		<script type="text/decks-eval" data-for="pick">
			await stage.cursor(event.board, { x: 40, y: 40 });
			return { id: event.id, value: event.value };
		</script>
		<script src="../lib/board.js"></script>
	</body>
</html>
`;

write(await boardPath(FIXTURE), BOARD);
// The watcher has to notice the file before it can be played.
await settle(page, 1200);
await resetStage(page);

const marks = () => page.evaluate(() => [...document.querySelectorAll(".agent-cursor .label")].map((el) => el.textContent ?? ""));
const dialogText = () => page.evaluate(() => document.querySelector(".dialog-card")?.textContent ?? "");

/**
 * One board, alone, in front of the camera and zoomed in far enough to click in it.
 *
 * The same necessity `board-links.mjs` documents: below half zoom a board takes no pointer
 * events at all, so a click "inside" one lands on the canvas underneath.
 */
const focus = async (path) => {
	for (const other of await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path))) {
		if (other !== path) LINK.send({ type: "board.hide", path: other });
	}
	await settle(page, 500);
	await page.evaluate((wanted) => {
		const name = wanted.replace("boards/", "");
		[...document.querySelectorAll(".board-row")].find((row) => row.textContent?.includes(name))?.click();
	}, path);
	await settle(page, 900);
	for (let i = 0; i < 10; i++) {
		const level = await page.evaluate(() =>
			Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
		);
		if (level >= 60) break;
		await page.keyboard.press("=");
		await settle(page, 120);
	}
};

await focus(PATH);

const card = page.frameLocator(`.board-node[data-path="${PATH}"] iframe`).locator('[data-id="go"]');
await card.click();

/*
 * The question, before anything runs. Asserted rather than assumed: this is the only place in
 * the app where a *click* is not the permission, and a check that skipped it would pass on a
 * build where the gate had been dropped.
 */
let asked = "";
for (let i = 0; i < 20 && (await marks()).length === 0; i++) {
	const text = await dialogText();
	if (text) asked = text;
	await settle(page, 200);
}
if (!asked.includes(PATH)) throw new Error(`the board was never asked about: the dialog said "${asked}"`);
if (!asked.includes("pick")) throw new Error(`the question did not name the component: "${asked}"`);

/*
 * Answer it here rather than relying on the harness's own `Allow` loop: this check is about
 * the trust question, and the answer with something to prove is the remembering one. A
 * failure to find it is ignored, because the harness may have got there first.
 */
const always = page.locator(".dialog-card button", { hasText: "Always allow this board" });
if ((await always.count()) > 0) await always.first().click({ timeout: 2000 }).catch(() => {});

// The cursor is the proof the code then ran: a canvas verb, keyed by the conversation on
// screen, labelled with the board's own identity.
let drawn = [];
for (let i = 0; i < 25 && drawn.length === 0; i++) {
	await settle(page, 200);
	drawn = await marks();
}
const ran = drawn.some((label) => label.includes("eval-fixture"));
if (!ran) {
	const said = await page.evaluate(() =>
		document.body.innerText
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => /eval-fixture|not allowed|failed/.test(line))
			.slice(0, 6),
	);
	console.error(`the board's code did not run. cursors: ${JSON.stringify(drawn)}; page lines: ${JSON.stringify(said)}`);
	process.exit(1);
}
say("the code runs once the question is answered, and its stage verb lands on the canvas", ran, `cursors ${JSON.stringify(drawn)}`);

LINK.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
