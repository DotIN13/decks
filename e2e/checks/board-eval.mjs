/**
 * A board's own code, run by pressing something on it.
 *
 * The board carries a script typed `text/decks-eval`, which a browser reads as text and never
 * runs on its own, and a component naming it with `data-eval`. Pressing that component runs the
 * block in the board's own page with the SDK as `stage` (`board-host/lib/board.js`); each verb it
 * calls goes to `/api/v1` as this board, and the server asks once whether this board may use the
 * stage at all. This check is the whole path in a real browser:
 *
 * - the code runs in the board's page, and its first verb waits for the question;
 * - the verb is refused until the question is answered, and the question names the board;
 * - once allowed, the code runs, and a `stage` verb it calls lands on the canvas — which is
 *   the part that proves the stage object was real and not a stub: the code adds a note to the
 *   canvas on screen, and the note is read back from the server.
 *
 * The harness answers the question for us: it clicks a dialog button labelled exactly
 * `Allow`, which is why the first option has no description — a description would be inside
 * the button and the label would stop being the whole of its text.
 */
import { API, asPerson, boardPath, open, rest, resetStage, say, settle, socket, write } from "../harness.mjs";

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
			<button type="button" data-eval="pick" data-value="round-21">Promote round 21</button>
		</section>
		<script type="text/decks-eval" data-for="pick">
			await stage.canvas.insert({ type: "note", content: "ran " + event.value }, { at: { x1: -4000, y1: -4000 } });
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

/** What the board's code left on the canvas: a note per press it ran (stage cursors are gone, so a note is the proof). */
const marks = async () => {
	const read = await fetch(`${API}/api/v1/canvas.read`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args: [] }) }).then((r) => r.json());
	return (read.value?.items ?? []).filter((item) => item.type === "note" && /^ran /.test(String(item.content ?? ""))).map((item) => String(item.content));
};
const dialogText = () => page.evaluate(() => document.querySelector(".dialog-card")?.textContent ?? "");

/**
 * One board, alone, in front of the camera and zoomed in far enough to click in it.
 *
 * The same necessity `board-links.mjs` documents: below half zoom a board takes no pointer
 * events at all, so a click "inside" one lands on the canvas underneath.
 */
/** Where the board sits on the canvas once played: its copy's path. */
let placed = PATH;
const focus = async (path) => {
	for (const other of await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path))) {
		if (other !== path) LINK.send({ type: "board.hide", path: other });
	}
	await settle(page, 500);
	// Played over the socket, as `chrome.mjs` does: placing it copies it into the canvas's folder,
	// so the node is found by its file name, wherever the copy went.
	LINK.send({ type: "board.play", path });
	await page.waitForFunction((name) => [...document.querySelectorAll(".board-node")].some((node) => node.dataset.path?.endsWith(`/${name}`)), path.replace("boards/", ""), { timeout: 10000 });
	placed = await page.evaluate((name) => [...document.querySelectorAll(".board-node")].find((node) => node.dataset.path?.endsWith(`/${name}`))?.dataset.path, path.replace("boards/", ""));
	// The camera to it through the API, not by selecting it: a selecting click lands inside the board,
	// on the very button this check is about, and would ask the question before anything else does.
	// It waits while the canvas is in use (`camera/touched.ts`, five seconds untouched), so it is asked again until it moves.
	for (let i = 0; i < 10; i++) {
		const focused = await fetch(`${API}/api/v1/view.focus`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args: [placed] }) }).then((r) => r.json());
		if (!focused.value?.deferred) break;
		await settle(page, 1000);
	}
	await rest(page).catch(() => {});
	await settle(page, 900);
	for (let i = 0; i < 10; i++) {
		const level = await page.evaluate(() =>
			Number((document.querySelector('.v3-zoom-value')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
		);
		if (level >= 60) break;
		await page.keyboard.press("=");
		await settle(page, 120);
	}
};

await focus(PATH);

/*
 * Fitting the board presses its controls to measure each view. A button that carries code is not
 * one of them: pressing it ran the code as the board, and the person was asked to allow a board
 * nobody had touched, every time an agent fitted one.
 */
const fitted = await fetch(`${API}/api/v1/canvas.fit`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args: [PATH] }) }).then((r) => r.json());
let askedByFit = "";
for (let i = 0; i < 10; i++) {
	askedByFit ||= await dialogText();
	await settle(page, 200);
}
say("fitting a board with a code button asks nothing and runs nothing", fitted.ok === true && !askedByFit && (await marks()).length === 0, JSON.stringify({ fit: fitted.ok ? fitted.value?.h : fitted.error, asked: askedByFit, marks: await marks() }));

const card = page.frameLocator(`.board-node[data-path="${placed}"] iframe`).locator('[data-id="go"] h3');
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
if (!asked.includes(FIXTURE)) throw new Error(`the board was never asked about: the dialog said "${asked}"`);

/*
 * Answer it here rather than relying on the harness's own `Allow` loop: this check is about
 * the trust question, and the answer with something to prove is the remembering one. A
 * failure to find it is ignored, because the harness may have got there first.
 */
const always = page.locator(".dialog-card button", { hasText: "Always allow this board" });
if ((await always.count()) > 0) await always.first().click({ timeout: 2000 }).catch(() => {});

// The note is the proof the code then ran: a canvas verb, on the canvas on screen.
let drawn = [];
for (let i = 0; i < 25 && drawn.length === 0; i++) {
	await settle(page, 200);
	drawn = await marks();
}
const ran = drawn.some((label) => label === "ran round-20");
if (!ran) {
	const said = await page.evaluate(() =>
		document.body.innerText
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => /eval-fixture|not allowed|failed/.test(line))
			.slice(0, 6),
	);
	console.error(`the board's code did not run. notes: ${JSON.stringify(drawn)}; page lines: ${JSON.stringify(said)}`);
	process.exit(1);
}
say("the code runs once the question is answered, and its stage verb lands on the canvas", ran, `notes ${JSON.stringify(drawn)}`);

LINK.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
