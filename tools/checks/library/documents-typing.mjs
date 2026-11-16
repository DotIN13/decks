/**
 * Typing into a document on the canvas reaches its file: a sentence, Enter, bold, undo, redo and a
 * paste, each read back from disk. The document is the fixture's docs/notes.md as a document item;
 * a Google Doc round needs a Docs API, which a fixture without the network cannot hold.
 */
import { readFileSync } from "node:fs";
import { API, asPerson, CANVAS, canvasFrame, deckState, open, rest, say, selectCard, settle } from "../harness.mjs";

const FILE = "docs/notes.md";
const deck = await deckState();
const onDisk = () => readFileSync(`${deck.path}/${FILE}`, "utf8");
const original = onDisk();
const person = await asPerson();
const call = async (name, args) => (await fetch(`${API}/api/v1/${name}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify(args) })).json();
/** The file once it passes test, or its last words after ms. */
const fileWhen = async (test, ms = 8000) => {
	const end = Date.now() + ms;
	for (;;) {
		const text = onDisk();
		if (test(text) || Date.now() > end) return text;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

const { browser, page, errors } = await open({ width: 1400, height: 900 });
const frame = await canvasFrame(page);
await rest(page);
const placed = await call("item.insert", { item: { type: "document", id: "typing-doc", path: FILE }, canvas: CANVAS, at: { x: -1800, y: 0 } });
say("the fixture's markdown is placed as a document", placed.ok === true, JSON.stringify(placed).slice(0, 200));
const path = "item:typing-doc";
await settle(page, 800);
await selectCard(page, path);
const editor = await frame.waitForFunction((wanted) => {
	const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
	const lv = node?.querySelector(".lv");
	return lv && lv.textContent && lv.textContent.length > 20 ? true : false;
}, path, { timeout: 15000 }).then(() => true, () => false);
say("the document opens as a page with its words", editor);

/**
 * Press a button in a document's page by its own click(), as a press on it would: the canvas puts
 * its card edge and side panel over parts of a card, which a pointer click would land on instead.
 */
const press = (card, selector, text = "", last = false) =>
	frame.evaluate(({ card, selector, text, last }) => {
		const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === card);
		const all = [...(node?.querySelectorAll(selector) ?? [])].filter((one) => one.textContent.includes(text));
		const one = last ? all.at(-1) : all[0];
		one?.click();
		return !!one;
	}, { card, selector, text, last });

/** Put the caret at the end of the document's text, inside the editor. */
async function caretAtEnd() {
	await frame.evaluate((wanted) => {
		const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
		const lv = node?.querySelector(".lv");
		lv?.focus();
		const walker = document.createTreeWalker(lv, NodeFilter.SHOW_TEXT);
		let last = null;
		for (let t = walker.nextNode(); t; t = walker.nextNode()) if (t.data.trim()) last = t;
		if (!last) return;
		const range = document.createRange();
		range.setStart(last, last.data.length);
		range.collapse(true);
		const sel = getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
	}, path);
	await settle(page, 200);
}

if (editor) {
	await caretAtEnd();
	const sentence = " Typed in the browser.";
	await page.keyboard.type(sentence, { delay: 15 });
	const typed = await fileWhen((text) => text.includes(sentence));
	say("a typed sentence reaches the file", typed.includes(sentence), JSON.stringify(typed.slice(-80)));

	await page.keyboard.press("Enter");
	await page.keyboard.type("A second line here", { delay: 15 });
	const line = await fileWhen((text) => /Typed in the browser\.\n+A second line here/.test(text));
	say("Enter starts a new line in the file", /Typed in the browser\.\n+A second line here/.test(line), JSON.stringify(line.slice(-80)));

	for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
	await page.keyboard.press("ControlOrMeta+b");
	const bold = await fileWhen((text) => text.includes("A second line **here**"));
	say("a selected word made bold is bold in the file", bold.includes("A second line **here**"), JSON.stringify(bold.slice(-80)));

	await page.keyboard.press("ControlOrMeta+z");
	const undone = await fileWhen((text) => text.includes("A second line here") && !text.includes("**here**"));
	say("undo takes the bold back in the file", undone.includes("A second line here") && !undone.includes("**here**"), JSON.stringify(undone.slice(-80)));

	await page.keyboard.press("ControlOrMeta+Shift+z");
	const redone = await fileWhen((text) => text.includes("A second line **here**"));
	say("redo puts it back", redone.includes("A second line **here**"), JSON.stringify(redone.slice(-80)));

	await caretAtEnd();
	const pasted = " And pasted words.";
	await frame.evaluate(({ wanted, words }) => {
		const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
		const data = new DataTransfer();
		data.setData("text/plain", words);
		node?.querySelector(".lv")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
	}, { wanted: path, words: pasted });
	const after = await fileWhen((text) => text.includes(pasted));
	say("plain text pasted reaches the file", after.includes(pasted), JSON.stringify(after.slice(-80)));
	say("…and the rest of the file is as it was", after.startsWith(original.slice(0, 200)), JSON.stringify(after.slice(0, 60)));

	// The page's own toolbar: a word selected and Bold pressed.
	const inPage = (selector) => frame.locator(`.card-node[data-path="${path}"] ${selector}`).first();
	await caretAtEnd();
	await page.keyboard.press("ArrowLeft");
	for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
	await press(path, '.dp-tools button[title^="Bold"]');
	const toolbar = await fileWhen((text) => text.includes("pasted **words**."));
	say("the toolbar's Bold makes the selected word bold in the file", toolbar.includes("pasted **words**."), JSON.stringify(toolbar.slice(-40)));

	// Review: another writer's edit is shown as a change, and the Changes panel rejects it.
	const now = onDisk();
	await call("file.write", { path: FILE, text: now.replace("# Session notes", "# Session notes, reviewed") });
	const shown = await inPage(".dp-changes").waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
	say("another writer's edit shows as a change to review", shown);
	if (shown) {
		await press(path, ".dp-changes");
		await inPage(".dp-change").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
		await press(path, '.dp-panel button[title="Take every edit back"]');
	}
	const rejected = await fileWhen((text) => text.includes("# Session notes\n") && !text.includes("reviewed"));
	say("…and rejecting it takes it back in the file", rejected.includes("# Session notes\n") && !rejected.includes("reviewed"), JSON.stringify(rejected.slice(0, 40)));

	// Versions: History lists them, the oldest opens, and Restore puts it back.
	await press(path, ".dp-bar button", "History");
	const rows = await frame.locator(`.card-node[data-path="${path}"] .dp-panel .dp-time`).count().then(async (n) => n || (await settle(page, 1500), frame.locator(`.card-node[data-path="${path}"] .dp-panel .dp-time`).count()));
	say("History lists the document's versions", rows >= 2, `${rows} versions`);
	if (rows >= 2) {
		await press(path, ".dp-panel .dp-time", "", true);
		await inPage(".dp-banner button:has-text('Restore')").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
		await press(path, ".dp-banner button", "Restore");
	}
	const restored = await fileWhen((text) => text === original, 10000);
	say("restoring the oldest version puts the file back as it was", restored === original, JSON.stringify(restored.slice(-60)));
}

// The PDF pane, on a LaTeX document: its button shows, and the pane opens on it.
const TEX = "docs/typing.tex";
await call("file.write", { path: TEX, text: "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n" });
await call("item.insert", { item: { type: "document", id: "typing-tex", path: TEX }, canvas: CANVAS, at: { x: -3000, y: 0 } });
await settle(page, 800);
await selectCard(page, "item:typing-tex");
const texPage = (selector) => frame.locator(`.card-node[data-path="item:typing-tex"] ${selector}`).first();
const pdfButton = await texPage(".dp-bar button:has-text('PDF')").waitFor({ state: "visible", timeout: 10000 }).then(() => true, () => false);
say("a LaTeX document has a PDF button", pdfButton);
if (pdfButton) {
	await press("item:typing-tex", ".dp-bar button", "PDF");
	const pane = await texPage(".dp-pdf").waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
	const state = await texPage(".dp-pdfstate").textContent().catch(() => "");
	say("…and pressing it opens the PDF pane, typesetting", pane && state !== "Not typeset yet", JSON.stringify(state));
}

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
setTimeout(() => process.exit(0), 500).unref();
