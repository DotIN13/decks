/**
 * Old pages kept at the deck's root, as the person's deck places ten: the fixture's canvas old-root places
 * an app through boards/apps/notes.html and a document through boards/old-root-notes.html. Each shows in
 * the frame on its pass, and the pass reaches it; each is selected. Run: node tools/checks/run.mjs old-root-board.
 */
import { API, asPerson, canvasFrame, focusCanvas, open, say, settle } from "../harness.mjs";

const CANVAS = "old-root";
const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
/** Every answer to the frame's pass route for a page at the deck's root, by status. */
const rootAnswers = [];
page.on("response", (response) => {
	if (/\/api\/t\/[^/]+\/card\/boards\//.test(response.url())) rootAnswers.push(response.status());
});
await settle(page, 1200);
const went = await call("view.goto", [CANVAS]);
say("the canvas with old root pages opens", went.ok !== false, JSON.stringify(went).slice(0, 160));
await settle(page, 2500);
const cv = () => canvasFrame(page);
const drawn = () => cv().then((c) => c.evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).map((n) => ({ id: n.id, kind: n.metadata?.type ?? n.type }))));
const count = async (kind) => (await drawn()).filter((n) => n.kind === kind).length;
say("both old root pages are drawn", !!(await until(async () => (await count("decks.app")) === 1 && (await count("decks.document")) === 1)), JSON.stringify(await drawn()));

const appFrame = () => page.frames().find((one) => !one.isDetached() && one.url().includes("/app/t/") && one.url().includes("/notes/"));
await call("view.focus", ["root-app", { canvas: CANVAS }]);
await settle(page, 1500);
say("the app placed through boards/apps/ runs in the frame, on its pass", !!(await until(async () => appFrame(), 10_000)), page.frames().map((one) => one.url().slice(0, 70)).join(" | "));
say("the frame's pass reaches every root page it asks for", rootAnswers.every((status) => status !== 404), `answers: ${JSON.stringify(rootAnswers)}`);

/** Select an item with a marquee from bare canvas around it: an awake page's middle is its own. */
async function select(id, centre) {
	// The page in the middle at 50%, with bare canvas round it for the marquee to start on, clear of the tool rail.
	await call("view.move", [{ ...centre, zoom: 0.5 }]);
	await settle(page, 1200);
	const box = await until(() => cv().then((c) => c.evaluate((id) => globalThis.__decksProbes?.penBox?.(id)?.toJSON(), id)), 4000);
	if (!box) return false;
	await page.mouse.move(box.x - 40, box.y - 40);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
	await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40, { steps: 6 });
	await page.mouse.up();
	await settle(page, 400);
	return (await cv().then((c) => c.evaluate(() => document.querySelectorAll(".pen-handle").length))) > 0;
}

// Each is selected on its own; today's Decks duplicates neither page item (⌘D), so nor is that asked here.
for (const [id, label, centre] of [["root-doc", "the document", { x: 1450, y: 300 }], ["root-app", "the app page", { x: 450, y: 300 }]]) {
	await focusCanvas(page);
	await page.keyboard.press("Escape");
	say(`${label} is selected`, await select(id, centre));
}
say("no errors on the page", errors.filter((e) => !/favicon/.test(e)).length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
