/**
 * Typing into a document on the canvas reaches its file: a sentence, Enter, a word made bold, undo
 * and redo, and plain text pasted, each read back from the file on disk.
 *
 * The document is the fixture's markdown, docs/notes.md, placed as a document item and opened by a
 * press. A Google Doc round needs a Docs API, which a fixture without the network cannot hold.
 */
import { readFileSync } from "node:fs";
import { API, asPerson, CANVAS, canvasFrame, deckState, open, resetStage, rest, say, selectCard, settle } from "../harness.mjs";

const FILE = "docs/notes.md";
await resetStage();
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
}

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
setTimeout(() => process.exit(0), 500).unref();
