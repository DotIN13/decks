/**
 * A document whole, in a tab of its own: the document kind of the one frame (`@decks/frame`,
 * `@decks/canvas` `frame/document/`, `apps/web/src/tabs/kinds/document.tsx`).
 *
 * The pill's New tab on a document opens it as a tab of this window, where it opened the file in the
 * browser's. The document runs in a sandboxed frame, as the canvas does, with its editor on a line of
 * its own, opened with a pass for that document alone: its words show, what is typed there is saved to
 * its file, it goes on when the document is taken off its canvas, and the canvas is as it was left
 * when the tab is closed.
 */
import { CANVAS, API, asPerson, canvasFrame, deckState, focusCanvas, open, pressCardAction, resetStage, rest, say, selectCard, settle } from "../harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Long waits: a document's frame starts a page, a line and an editor, and other checks run beside this one.
const until = async (test, ms = 20000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const deck = (await deckState())?.path;
const file = `canvases/${CANVAS}/files/tab-notes.md`;
mkdirSync(join(deck, `canvases/${CANVAS}/files`), { recursive: true });
writeFileSync(join(deck, file), "# Notes for the tab\n\nThe first line of the notes.\n");
const made = await call("canvas.insert", [{ type: "document", id: "tab-doc", path: file, width: 520, height: 360 }, { at: { x1: 200, y1: 1400 } }]);
say("a document on the canvas", made.ok === true, JSON.stringify(made).slice(0, 200));

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const canvas = await canvasFrame(page);
await until(() => canvas.evaluate(() => !!globalThis.__decksProbes?.rust?.placed?.has("tab-doc")).catch(() => false));

// --- the pill's New tab opens the document as a tab of this window ------------------------------------------
await focusCanvas(page);
await selectCard(page, "item:tab-doc");
await pressCardAction(page, "Fit");
await rest(page);
const pagesBefore = page.context().pages().length;
await pressCardAction(page, "New tab");
const chip = page.locator('.tab-chip[data-kind="document"]');
say("New tab on the document's pill opens it as a tab of this window, in front", (await until(() => chip.count())) === 1 && (await chip.getAttribute("data-front")) === "true" && (await chip.innerText()).includes("tab-notes.md"), await chip.innerText().catch(() => ""));
say("…and not the browser's tab", page.context().pages().length === pagesBefore);
const frameEl = page.locator('.surface[data-surface="document"] iframe.document-frame');
say("the document is in a frame of its own, sandboxed as the canvas's is", (await until(() => frameEl.count())) === 1 && !(await frameEl.getAttribute("sandbox")).includes("allow-same-origin") && (await frameEl.getAttribute("sandbox")) === (await page.locator("iframe.canvas-frame").getAttribute("sandbox")));
say("the canvas is out of sight, and its tools with it", !(await page.locator('.surface[data-surface="canvas"]').isVisible()) && (await page.locator(".pen-tools").count()) === 0);
// The document's frame is another frame of the canvas-frame page: found by what it shows.
const inDoc = async (run, arg) => {
	for (const one of page.frames()) {
		if (one === page.mainFrame()) continue;
		const found = await one.evaluate(() => !!document.querySelector(".document-tab")).catch(() => false);
		if (found) return one.evaluate(run, arg);
	}
	return undefined;
};
const words = await until(async () => ((await inDoc(() => document.querySelector(".document-tab .document-surface")?.innerText ?? ""))?.includes("The first line of the notes") ? true : undefined));
say("its words show there", !!words, (await inDoc(() => document.querySelector(".document-tab .document-surface")?.innerText ?? ""))?.slice(0, 120));
const box = await frameEl.boundingBox();
const view = page.viewportSize();
say("it fills the canvas's column, beside the side panel", !!box && box.x > 100 && box.width > 600 && box.y + box.height <= view.height + 1, JSON.stringify(box));

// --- what is typed there is saved to its file --------------------------------------------------------------
const at = await inDoc(() => {
	const text = [...document.querySelectorAll('.document-tab [contenteditable]')].find((one) => one.textContent.includes("The first line of the notes"));
	const r = text?.getBoundingClientRect();
	return r ? { x: r.right - 4, y: r.y + r.height / 2, w: r.width } : undefined;
});
if (at && box) {
	await page.mouse.click(box.x + at.x, box.y + at.y);
	await page.keyboard.press("End");
	await page.keyboard.type(" Typed in the tab.");
}
const saved = await until(() => (readFileSync(join(deck, file), "utf8").includes("Typed in the tab.") ? true : undefined), 10000);
say("words typed in the tab are saved to the document's file", !!saved, readFileSync(join(deck, file), "utf8").slice(0, 160));

// --- it is on a pass of its own: taken off the canvas, the tab goes on -------------------------------------
const off = await call("canvas.delete", ["tab-doc"]);
await settle(page, 400);
if (at && box) {
	await page.mouse.click(box.x + at.x, box.y + at.y);
	await page.keyboard.press("End");
	await page.keyboard.type(" And off the canvas.");
}
say("taken off its canvas, the document in the tab is still typed into and saved", off.ok === true && !!(await until(() => (readFileSync(join(deck, file), "utf8").includes("And off the canvas.") ? true : undefined), 10000)), readFileSync(join(deck, file), "utf8").slice(0, 200));

// --- behind another tab and back, closed --------------------------------------------------------------------
await page.locator('.v3-topbar .tab-chip[data-camera="true"] .tab-chip-name').click();
say("the home chip brings the canvas forward, the document's tab still in the row", (await until(async () => ((await page.locator('.surface[data-surface="canvas"]').isVisible()) && (await chip.getAttribute("data-front")) !== "true" ? true : undefined))) === true);
await settle(page, 300);
await chip.click();
say("brought forward again, it shows what was typed", !!(await until(async () => ((await inDoc(() => document.querySelector(".document-tab .document-surface")?.innerText ?? ""))?.includes("Typed in the tab.") ? true : undefined))));
await chip.locator(".tab-chip-close").click();
say("the ✕ closes it, and the canvas is back with its tools", (await until(async () => ((await page.locator('.tab-chip[data-kind="document"]').count()) === 0 && (await page.locator('.surface[data-surface="canvas"]').isVisible()) && (await page.locator(".pen-tools").count()) === 1 ? true : undefined))) === true);
say("…the same canvas frame, not one made anew", (await canvas.evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).length)) > 0);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
