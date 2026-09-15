/**
 * The differential: our render against the browser's own parse of the same bytes.
 *
 * This is the check the whole design is answerable to, and it is written over the *whole deck*: for
 * every board the running server knows about, the dev page renders it and reports the shape of what
 * it rendered beside the shape of `DOMParser`'s parse of the same source. The browser is the oracle —
 * we are not authoring a second answer to what HTML means, we are checking ours against the only one
 * that counts.
 *
 * **Before the scripts run**, and that matters: after `board.js` has drawn a panel, the DOM is
 * *allowed* to differ — a drawn panel is not the file. The comparison is taken on the render, which
 * is where the handles live and where the paths get their meaning.
 *
 * Point it at the fixture deck (default) and it is four boards and a few seconds. Point it at the
 * real deck and it is 538 boards and about a minute:
 *
 *     DECKS_DATA_DIR=/home/decks/data DECKS_PORT=4346 DECKS_WEB_PORT=4347 npm run dev
 *     DECKS_E2E_WEB=http://127.0.0.1:4347 DECKS_E2E_API=http://127.0.0.1:4346 \
 *       node e2e/run.mjs render-fidelity.mjs
 */
import { readdirSync } from "node:fs";
import { chromium } from "playwright";
import { API, WEB, say } from "../harness.mjs";

/*
 * Which boards to check.
 *
 * By default the deck the running server knows about — which is the boards *in play*, the ones a
 * person is looking at. With `DECKS_FIDELITY_DIR` set, every `.html` file in that directory, which is
 * how the whole deck is checked at once: 553 boards of evidence rather than the handful on a canvas.
 */
const frameMode = process.env.DECKS_FIDELITY_SHAPES !== "1";
const boards = process.env.DECKS_FIDELITY_DIR
	? readdirSync(process.env.DECKS_FIDELITY_DIR)
			.filter((name) => name.endsWith(".html"))
			.map((name) => `boards/${name}`)
	: ((await (await fetch(`${API}/api/deck`)).json()).deck?.boards ?? []).map((board) => board.path ?? board);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

let matched = 0;
const mismatched = [];
/** Boards where a node did not find its element in the frame — the handles' own failure. */
const short = [];
for (const path of boards) {
	await page.goto(`${WEB}/editor.html?${frameMode ? "" : "frame=0&"}board=${encodeURIComponent(path)}`, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(() => window.__editorDev?.loaded === true, null, { timeout: 20000 }).catch(() => undefined);
	const report = await page.evaluate(() => window.__editorDev);
	if (!report?.loaded) {
		mismatched.push({ path, diff: "the page never reported a render" });
		continue;
	}
	if (report.equal) matched++;
	else mismatched.push({ path, diff: report.diff });
	if (report.handles && report.handles.landed !== report.handles.nodes) {
		short.push({ path, said: `${report.handles.landed}/${report.handles.nodes}` });
	}
}

say(
	"every board renders to the shape of the browser's own parse of it",
	mismatched.length === 0,
	`${matched}/${boards.length} boards matched${mismatched.length > 0 ? `; first: ${mismatched[0].path}\n${mismatched[0].diff}` : ""}`,
);
say(
	"every node found its element in the frame, so every press has an answer",
	short.length === 0,
	short.length === 0
		? `${matched} boards, handles complete`
		: `${short.length} board(s) short; first: ${short[0].path} ${short[0].said}`,
);
say("no page errors while rendering", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
