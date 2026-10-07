/**
 * A card is typed into as it reads, and written back as the markdown it was (`pen/CardEditor.tsx`).
 *
 * The card's markdown is Obsidian's, with coloured words and an agent's CriticMarkup suggestions on
 * top (`pen/card-syntax.ts`). The editor keeps every block it was not asked to change exactly as it
 * was read — a table, a hidden comment and a code block go through an edit elsewhere untouched — and
 * it answers the four things a person does in one: accept a suggestion, colour a word from the style
 * bar, drag a whole-line piece between lines and an in-line one into a sentence.
 *
 * Needs no model: the card goes in over the wire, and the rest is presses.
 */
import { editMode, open, resetStage, say, settle, socket, deckState } from "../harness.mjs";
import { readFileSync, readdirSync } from "node:fs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const SOURCE = [
	"# Kyoto, three days",
	"",
	"Arrive **Thursday night**. Budget is ==🟡¥90,000== for two, [not flexible]{.red}.",
	"",
	"- Book the `ryokan` near Gion",
	"- Ask [[Mei Tanaka]] about {~~Arashiyama~>Ohara~~}{>>quieter in November<<}",
	"- [ ] Buy JR passes",
	"",
	"> [!tip] Go early",
	"> The gates are empty before 7.",
	"",
	"| day | plan |",
	"|:--|--:|",
	"| Fri | Fushimi |",
	"",
	"![[itinerary.pdf]]",
	"",
	"%% a hidden note %%",
	"",
	"```js",
	"const x = 1;",
	"```",
].join("\n");

const deck = await deckState();
const onDisk = () => {
	for (const stage of readdirSync(`${deck.path}/stages`)) {
		try {
			const doc = JSON.parse(readFileSync(`${deck.path}/stages/${stage}/stage.pen`, "utf8"));
			const card = (doc.children ?? []).find((n) => n.id === "card-editor");
			if (card) return card.content;
		} catch {
			/* a stage being written */
		}
	}
};

await resetStage();
const { browser, page, errors } = await open({ width: 1300, height: 900, boards: false });
await settle(page, 1200);
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
await editMode(page, true);
// Near life size, so the card is big enough to press into; the zoom keys step by a fifth.
const matrix = () => page.evaluate(() => {
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	return { a: m.a, e: m.e, f: m.f };
});
for (let i = 0; i < 30; i++) {
	const { a } = await matrix();
	if (a > 0.85 && a < 1.2) break;
	await page.keyboard.press(a <= 0.85 ? "=" : "-");
	await settle(page, 120);
}
// Off to the side of the boards, where the card has the canvas to itself.
const clear = () => page.evaluate(() => {
	const stage = document.querySelector(".stage");
	for (let y = 90; y <= 640; y += 50) for (let x = 420; x <= 820; x += 50) if (document.elementFromPoint(x, y) !== stage) return false;
	return true;
});
for (let i = 0; i < 12 && !(await clear()); i++) {
	await page.mouse.move(700, 400);
	await page.mouse.wheel(1500, 0);
	await settle(page, 200);
}
say("the canvas has a clear place for the card", await clear());
// The camera may still be coasting from the last wheel; read it once it is still.
let m = await matrix();
for (let i = 0; i < 20; i++) {
	await settle(page, 250);
	const now = await matrix();
	if (now.e === m.e && now.f === m.f && now.a === m.a) break;
	m = now;
}
const world = { x1: Math.round((420 - m.e) / m.a), y1: Math.round((90 - m.f) / m.a) };
// A card left by a run that stopped half way would keep the id, and the insert would be refused.
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "card-editor" }] });
await settle(page, 400);
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id: "card-editor", content: SOURCE, metadata: { type: "decks.markdown" }, width: 360 }, box: world }] });
// Drawn once its fonts have arrived, which is when it is as tall as its markdown.
const box = await until(async () => {
	const now = await page.evaluate(() => globalThis.__decksPenBox?.("card-editor"));
	return now && now.height > 300 ? now : undefined;
}, 12000);
say("a card in Obsidian's markdown is drawn", !!box && box.height > 300, JSON.stringify(box && { h: Math.round(box.height) }));

const openCard = async () => {
	await page.mouse.dblclick(box.x + 40, box.y + 30);
	return until(() => page.evaluate(() => !!document.activeElement?.closest(".pen-card-editor")), 3000);
};
say("a double-click opens it as it reads", await openCard());
const shown = await page.evaluate(() => ({
	blocks: [...document.querySelector(".pce-body").children].map((c) => c.tagName.toLowerCase()),
	suggestion: !!document.querySelector(".pce-sug del") && !!document.querySelector(".pce-sug ins"),
	highlight: document.querySelector(".pce-body mark")?.dataset.c,
	colour: document.querySelector(".pce-body [data-fg]")?.dataset.fg,
	callout: document.querySelector(".pce-body blockquote[data-callout]")?.dataset.callout,
}));
say("…headings, lists, a callout, a suggestion, a coloured highlight and coloured words", shown.suggestion && shown.highlight === "yellow" && shown.colour === "red" && shown.callout === "tip", JSON.stringify(shown));

await page.click(".pce-sug [data-accept]");
await page.keyboard.press("Control+Enter");
const accepted = await until(() => onDisk() === SOURCE.replace("{~~Arashiyama~>Ohara~~}{>>quieter in November<<}", "Ohara"));
say("accepting a suggestion changes those words and leaves every other byte as it was", !!accepted, JSON.stringify(onDisk()?.split("\n").slice(4, 7)));

await settle(page, 400);
await openCard();
await settle(page, 300);
await page.evaluate(() => {
	const text = document.querySelector(".pce-body > p").firstChild;
	const range = document.createRange();
	range.setStart(text, 0);
	range.setEnd(text, 6);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
});
const bar = await until(() => page.evaluate(() => getComputedStyle(document.querySelector(".pce-bar")).display !== "none"), 2000);
say("a selection gets the style bar", !!bar);
await page.click('.pce-bar [data-fg="blue"]');

const drag = async (from, to) => {
	const f = await page.locator(from).first().boundingBox();
	await page.mouse.move(f.x + 12, f.y + 8);
	await page.mouse.down();
	await page.mouse.move(f.x + 24, f.y + 4, { steps: 3 });
	await page.mouse.move(to.x, to.y, { steps: 10 });
	const seen = await page.evaluate(() => {
		const ghost = document.querySelector(".pce-ghost")?.getBoundingClientRect();
		return { ghost: ghost && { x: ghost.x, y: ghost.y }, line: getComputedStyle(document.querySelector(".pce-line")).display, caret: getComputedStyle(document.querySelector(".pce-caret")).display };
	});
	await page.mouse.up();
	return seen;
};
const heading = await page.locator(".pce-body h1").boundingBox();
const at = { x: heading.x + 100, y: heading.y + heading.height + 4 };
const file = await drag('.pce-piece[data-kind="file"]', at);
say("a file drags between lines: its ghost below and right of the pointer, and a line where it lands", file.line === "block" && file.ghost && file.ghost.x > at.x && file.ghost.y > at.y, JSON.stringify(file));
const paragraph = await page.locator(".pce-body > p").first().boundingBox();
const wiki = await drag('.pce-piece[data-kind="wiki"]', { x: paragraph.x + 160, y: paragraph.y + 10 });
say("a [[link]] drags into a sentence, with a caret where it lands", wiki.caret === "block", JSON.stringify(wiki));
await page.keyboard.press("Control+Enter");
const saved = await until(() => {
	const now = onDisk() ?? "";
	return now.split("\n")[2] === "![[itinerary.pdf]]" && /^\[Arrive\]\{\.blue\} .*\[\[Mei Tanaka\]\]/.test(now.split("\n")[4] ?? "") && now.includes("- Ask about Ohara") && now.endsWith("| Fri | Fushimi |\n\n%% a hidden note %%\n\n```js\nconst x = 1;\n```") ? now : undefined;
});
say("…and the file says so, with the untouched table, hidden note and code as they were", !!saved, JSON.stringify(onDisk()));

link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "card-editor" }] });
await settle(page, 300);
say("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await editMode(page, false);
link.close();
await browser.close();
