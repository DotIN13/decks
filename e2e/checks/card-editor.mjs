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
			// A note card from before is saved as a card frame, its blocks one item each.
			if (card) return card.type === "frame" ? (card.children ?? []).map((n) => (n.metadata?.type === "decks.file" ? `![[${n.metadata.path}]]` : n.content)).join("\n\n") : card.content;
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
const frame = (() => {
	for (const stage of readdirSync(`${deck.path}/stages`)) {
		try {
			const card = (JSON.parse(readFileSync(`${deck.path}/stages/${stage}/stage.pen`, "utf8")).children ?? []).find((n) => n.id === "card-editor");
			if (card) return card;
		} catch {
			/* being written */
		}
	}
})();
say("…and the note card from before is now a card frame, one markdown item per block", frame?.type === "frame" && frame?.metadata?.type === "decks.card" && frame.children?.length === 8, JSON.stringify(frame?.children?.map((n) => n.type)));

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
// It goes while the camera moves, and comes back over the words once the camera rests, as the board pill does.
await page.mouse.move(1100, 700);
await page.mouse.wheel(0, 60);
await page.waitForTimeout(30);
const gone = await page.evaluate(() => document.querySelector(".pce-bar").hasAttribute("data-hidden"));
const back = await until(() => page.evaluate(() => {
	const tools = document.querySelector(".pce-bar:not([data-hidden]) .pce-tools")?.getBoundingClientRect();
	const words = getSelection().rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect() : undefined;
	if (!tools || !words) return undefined;
	// Just over the words, or just under them where the app's bars leave no room above.
	const near = (tools.bottom <= words.top + 1 && words.top - tools.bottom < 40) || (tools.top >= words.bottom - 1 && tools.top - words.bottom < 40);
	return tools && words && near ? true : undefined;
}), 3000);
// The camera back where the rest of this check expects the card.
await page.mouse.wheel(0, -60);
await settle(page, 500);
say("…which goes while the camera moves and comes back just over the words when it rests", gone && !!back, JSON.stringify({ gone, back }));
// Colours are in the bar's colour menu.
await page.click('.pce-bar [data-menu="fg"]');
await page.click('.pce-bar .pce-menu[data-open] [data-fg="blue"]');

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

// A table is typed into cell by cell and a callout's title in place; the save touches only those two items.
const cardNode = () => {
	for (const stage of readdirSync(`${deck.path}/stages`)) {
		try {
			const card = (JSON.parse(readFileSync(`${deck.path}/stages/${stage}/stage.pen`, "utf8")).children ?? []).find((n) => n.id === "card-editor");
			if (card) return card;
		} catch {
			/* being written */
		}
	}
};
const idsBefore = (cardNode()?.children ?? []).map((n) => n.id);
await settle(page, 400);
await openCard();
await settle(page, 300);
await page.evaluate(() => {
	const cell = [...document.querySelectorAll(".pce-table td")].find((td) => td.textContent.trim() === "Fushimi");
	const range = document.createRange();
	range.selectNodeContents(cell);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
});
await page.keyboard.type("Arashiyama");
await page.keyboard.press("Enter");
await page.keyboard.press("Shift+Tab");
await page.keyboard.type("Sat");
await page.keyboard.press("Tab");
await page.keyboard.type("Kyoto");
await page.evaluate(() => {
	const title = document.querySelector(".pce-chead");
	const range = document.createRange();
	range.selectNodeContents(title);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
});
await page.keyboard.type("Leave early");
await page.keyboard.press("Enter");
await page.keyboard.press("Control+Enter");
const blocks = () => (cardNode()?.children ?? []).map((n) => n.content);
const typed = await until(() => blocks().includes("| day | plan |\n| :-- | --: |\n| Fri | Arashiyama |\n| Sat | Kyoto |") && blocks().includes("> [!tip] Leave early\n> The gates are empty before 7."));
say("a table is typed into cell by cell, Enter adding a row, and a callout's title in place", !!typed, JSON.stringify(blocks().filter((b) => /^\||^>/.test(b ?? ""))));
const idsAfter = (cardNode()?.children ?? []).map((n) => n.id);
say("…and the save is edits to those two items: every block keeps its id", JSON.stringify(idsAfter) === JSON.stringify(idsBefore), JSON.stringify({ idsBefore, idsAfter }));

// The card goes to Obsidian as a .md file, without its colours and with the suggestion's original words.
await page.keyboard.press("Escape");
await settle(page, 300);
const cardBox = await page.evaluate(() => globalThis.__decksPenBox?.("card-editor"));
await page.mouse.click(cardBox.x + cardBox.width / 2, cardBox.y + 6);
const exportButton = page.locator('[title="Export to Obsidian (.md)"]');
await exportButton.waitFor({ timeout: 3000 }).catch(() => {});
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }).catch(() => undefined), exportButton.click().catch(() => {})]);
const note = download ? readFileSync(await download.path(), "utf8") : "";
say("a card's panel exports it as an Obsidian note: no coloured spans, no suggestion marks", !!note && note.startsWith("# Kyoto, three days") && !/\]\{\.(red|blue)\}|\{~~|\{>>/.test(note) && note.includes("| Sat | Kyoto |"), JSON.stringify({ file: download?.suggestedFilename(), start: note.slice(0, 80) }));

// A highlight and bold over a heading and the paragraph under it: one run in each block, the heading still bold.
await page.keyboard.press("Escape");
await settle(page, 300);
await openCard();
await settle(page, 300);
const across = (button) =>
	page.evaluate(() => {
		const ed = document.querySelector(".pce-body");
		const at = (el, off) => {
			const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			for (let n = walk.nextNode(); n; n = walk.nextNode()) {
				const len = n.textContent.replace(/\u200b/g, "").length;
				if (off <= len) return [n, off];
				off -= len;
			}
		};
		const range = document.createRange();
		range.setStart(...at(ed.querySelector("h1"), 7));
		range.setEnd(...at(ed.querySelector(":scope > p"), 3));
		getSelection().removeAllRanges();
		getSelection().addRange(range);
	}).then(async () => {
		if (button.startsWith("[data-hl")) await page.click('.pce-bar [data-menu="hl"]');
		await page.click(`.pce-bar ${button.startsWith("[data-hl") ? ".pce-menu[data-open] " : ""}${button}`);
	});
await across('[data-hl="green"]');
await across('[data-cmd="bold"]');
await page.keyboard.press("Control+Enter");
const styled = await until(() => {
	const kids = (cardNode()?.children ?? []).map((n) => n.content ?? "");
	const head = kids.find((k) => k.startsWith("# "));
	const para = kids.find((k) => /Thursday night/.test(k));
	return head === "# Kyoto, ==🟢**three days**==" && /^\[==🟢\*\*Arr\*\*==ive\]\{\.blue\}/.test(para ?? "") ? { head, para } : undefined;
});
say("a highlight and bold over a heading and the paragraph under it become one run in each block", !!styled, JSON.stringify((cardNode()?.children ?? []).slice(0, 3).map((n) => n.content)));

// The bar's menus: a block made a heading, words set in serif and underlined.
await page.keyboard.press("Escape");
await settle(page, 400);
await openCard();
await settle(page, 300);
const choose = async (menu, option) => {
	await page.click(`.pce-bar [data-menu="${menu}"]`);
	await page.click(`.pce-bar .pce-menu[data-open] ${option}`);
};
await page.evaluate(() => {
	const words = document.querySelector(".pce-body h1");
	const range = document.createRange();
	range.selectNodeContents(words);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
});
await choose("block", '[data-block="h2"]');
await page.evaluate(() => {
	const cell = [...document.querySelectorAll(".pce-body > p")].find((p) => p.textContent.includes("Thursday"));
	const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
	const text = [...(function* () { for (let n = walk.nextNode(); n; n = walk.nextNode()) yield n; })()].find((n) => n.textContent.includes("Budget"));
	const at = text.textContent.indexOf("Budget");
	const range = document.createRange();
	range.setStart(text, at);
	range.setEnd(text, at + 6);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
});
await choose("font", '[data-font="Source Serif 4"]');
await page.click('.pce-bar [data-cmd="underline"]');
await page.keyboard.press("Control+Enter");
const menus = await until(() => {
	const kids = (cardNode()?.children ?? []).map((n) => n.content ?? "");
	return kids.some((k) => k.startsWith("## Kyoto")) && kids.some((k) => k.includes("<u>[Budget]{.serif}</u>") || k.includes("[<u>Budget</u>]{.serif}")) ? kids : undefined;
});
say("the bar's menus make a block a heading, and set words in serif and underlined", !!menus, JSON.stringify((cardNode()?.children ?? []).map((n) => n.content).filter((k) => /Kyoto|Budget/.test(k ?? ""))));

// A double-click in a gap of the card makes a new line there; on its words, the caret lands where it was.
await page.keyboard.press("Escape");
await settle(page, 400);
const blockIds = (cardNode()?.children ?? []).map((n) => n.id);
const firstBox = await page.evaluate((id) => globalThis.__decksPenBox?.(id), blockIds[0]);
const secondBox = await page.evaluate((id) => globalThis.__decksPenBox?.(id), blockIds[1]);
await page.mouse.dblclick(firstBox.x + 40, (firstBox.y + firstBox.height + secondBox.y) / 2);
const lineOpen = await until(() => page.evaluate(() => !!document.activeElement?.closest(".pen-card-editor") && !document.querySelector(".canvas-menu")), 3000);
await page.keyboard.type("A new line in the gap");
await page.keyboard.press("Control+Enter");
const lined = await until(() => ((cardNode()?.children ?? [])[1]?.content === "A new line in the gap" ? true : undefined));
say("a double-click in a gap of the card opens it with a new line there, and no canvas menu", !!lineOpen && !!lined, JSON.stringify((cardNode()?.children ?? []).slice(0, 3).map((n) => n.content ?? n.type)));
await page.keyboard.press("Escape");
await settle(page, 400);
const wordsId = (cardNode()?.children ?? []).find((n) => (n.content ?? "").startsWith("A new line"))?.id;
const wordsBox = await page.evaluate((id) => globalThis.__decksPenBox?.(id), wordsId);
await page.mouse.dblclick(wordsBox.x + 2, wordsBox.y + wordsBox.height / 2);
await until(() => page.evaluate(() => !!document.activeElement?.closest(".pen-card-editor")), 3000);
await page.keyboard.press("Home");
await page.keyboard.type("Look: ");
await page.keyboard.press("Control+Enter");
const caretAt = await until(() => ((cardNode()?.children ?? []).some((n) => n.content === "Look: A new line in the gap") ? true : undefined));
say("…and on its words the caret lands on that line", !!caretAt, JSON.stringify((cardNode()?.children ?? []).slice(0, 3).map((n) => n.content ?? n.type)));
await page.keyboard.press("Escape");
await settle(page, 400);


// A picture beside the card goes into it with the frame's own drop, between two blocks, and out again.
const where = (id) => {
	for (const stage of readdirSync(`${deck.path}/stages`)) {
		try {
			const doc = JSON.parse(readFileSync(`${deck.path}/stages/${stage}/stage.pen`, "utf8"));
			const card = (doc.children ?? []).find((n) => n.id === "card-editor");
			if (card) return { inCard: (card.children ?? []).map((n) => n.id).indexOf(id), top: doc.children.some((n) => n.id === id), kids: (card.children ?? []).map((n) => n.id) };
		} catch {
			/* being written */
		}
	}
};
await page.keyboard.press("Escape");
await settle(page, 300);
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "card-picture" }] });
await settle(page, 300);
const beside = { x1: Math.round((880 - m.e) / m.a), y1: Math.round((150 - m.f) / m.a) };
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "card-picture", name: "Gate", cornerRadius: 8, fill: "#9ec5f0" }, box: { ...beside, x2: beside.x1 + 160, y2: beside.y1 + 90 } }] });
const picture = await until(() => page.evaluate(() => globalThis.__decksPenBox?.("card-picture")));
const kids = where("card-picture")?.kids ?? [];
const second = await page.evaluate((id) => globalThis.__decksPenBox?.(id), kids[1]);
await page.mouse.click(picture.x + 30, picture.y + 30);
await settle(page, 200);
await page.mouse.move(picture.x + 30, picture.y + 30);
await page.mouse.down();
await page.mouse.move(picture.x + 10, picture.y + 30, { steps: 4 });
const aim = { x: second.x + 60, y: second.y + second.height + 6 };
await page.mouse.move(aim.x, aim.y, { steps: 14 });
await settle(page, 200);
// The selection's outline is drawn where the carried item is drawn.
const carried = await page.evaluate(() => document.querySelector(".pen-selection")?.getBoundingClientRect().toJSON());
const looks = await page.evaluate(() => {
	const ghost = document.querySelector(".pen-drag-ghost:not([hidden])");
	const style = ghost && getComputedStyle(ghost);
	return { ghost: !!ghost, tilted: style?.rotate === "2deg", shadow: !!style?.filter.includes("drop-shadow"), handles: [...document.querySelectorAll(".pen-handle, .pen-anchor")].filter((h) => getComputedStyle(h).visibility !== "hidden").length };
});
await page.mouse.up();
const dropped = await until(() => (where("card-picture")?.inCard === 2 ? where("card-picture") : undefined));
say("a picture dragged onto a card drops between two of its blocks, as the frame's own drop", !!dropped, JSON.stringify(where("card-picture")));
say("…as a ghost of itself, tilted and lifted on a shadow, with no handles round it", looks.ghost && looks.tilted && looks.shadow && looks.handles === 0, JSON.stringify(looks));
say("…and while it is carried over the card it rides below and right of the pointer", !!carried && carried.x > aim.x && carried.y > aim.y, JSON.stringify({ aim, at: carried && { x: Math.round(carried.x), y: Math.round(carried.y) } }));
// Once the card has laid it out among its blocks.
const inside = await until(async () => {
	const now = await page.evaluate(() => globalThis.__decksPenBox?.("card-picture"));
	return now && Math.abs(now.x - picture.x) > 40 ? now : undefined;
});
await page.mouse.click(inside.x + 20, inside.y + 20);
await settle(page, 200);
await page.mouse.move(inside.x + 20, inside.y + 20);
await page.mouse.down();
await page.mouse.move(inside.x + 40, inside.y + 20, { steps: 4 });
await page.mouse.move(inside.x + 480, inside.y + 60, { steps: 14 });
await page.mouse.up();
const out = await until(() => (where("card-picture")?.top ? where("card-picture") : undefined));
say("…and dragged off the card it leaves it", !!out && out.inCard === -1, JSON.stringify(where("card-picture")));

// A file dropped from the desktop onto the card goes into it as a file's chip, which is ![[path]] in its markdown.
const before = (cardNode()?.children ?? []).length;
const onCard = await page.evaluate(() => globalThis.__decksPenBox?.("card-editor"));
await page.evaluate(({ x, y }) => {
	const data = new DataTransfer();
	data.items.add(new File(["%PDF-1.4 plan"], "itinerary-2.pdf", { type: "application/pdf" }));
	const target = document.elementFromPoint(x, y) ?? document.body;
	for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data }));
}, { x: onCard.x + onCard.width / 2, y: onCard.y + 40 });
const filed = await until(() => (cardNode()?.children ?? []).find((n) => n.metadata?.type === "decks.file" && /itinerary-2\.pdf$/.test(n.metadata.path)), 12000);
say("a file dropped on a card goes into it as a file's chip", !!filed && (cardNode()?.children ?? []).length === before + 1, JSON.stringify(filed && { name: filed.name, path: filed.metadata.path, kids: filed.children?.map((c) => c.type) }));
// What the page asks to open, rather than a real tab: a headless browser need not show one.
await page.evaluate(() => {
	globalThis.__opened = [];
	window.open = (url) => (globalThis.__opened.push(String(url)), null);
});
const chip = await until(() => page.evaluate((id) => globalThis.__decksPenBox?.(id), filed?.id));
if (chip) await page.mouse.dblclick(chip.x + chip.width / 2, chip.y + chip.height / 2);
const opened = await until(() => page.evaluate(() => globalThis.__opened?.[0]), 3000);
say("…and a double-click on the chip opens the file", /itinerary-2\.pdf$/.test(opened ?? ""), opened);

// A block's grip, in the card's margin, drags the block out of the card, and a drag puts it back.
await page.keyboard.press("Escape");
await settle(page, 400);
const blockId = (cardNode()?.children ?? []).find((n) => n.type === "text" && (n.content ?? "").startsWith("Look:"))?.id;
const blockBox = await page.evaluate((id) => globalThis.__decksPenBox?.(id), blockId);
await page.mouse.move(blockBox.x + 40, blockBox.y + 6);
const grip = await until(() => page.evaluate(() => document.querySelector(".pen-grip")?.getBoundingClientRect().toJSON()), 2000);
say("hovering a card's block shows its grip in the card's margin", !!grip && grip.right <= blockBox.x + 2 && Math.abs(grip.top - blockBox.y) < 12, JSON.stringify({ grip: grip && Math.round(grip.x), block: Math.round(blockBox.x) }));
if (grip) {
	await page.mouse.move(grip.x + 6, grip.y + 8);
	await page.mouse.down();
	await page.mouse.move(grip.x + 30, grip.y + 30, { steps: 4 });
	await page.mouse.move(grip.x + 520, grip.y + 60, { steps: 14 });
	await page.mouse.up();
}
const outside = await until(() => {
	for (const stage of readdirSync(`${deck.path}/stages`)) {
		try {
			const top = (JSON.parse(readFileSync(`${deck.path}/stages/${stage}/stage.pen`, "utf8")).children ?? []).find((n) => n.id === blockId);
			if (top) return top;
		} catch {
			/* being written */
		}
	}
});
say("…and dragging the grip takes the block out of the card, keeping its width", !!outside && typeof outside.width === "number" && !(cardNode()?.children ?? []).some((n) => n.id === blockId), JSON.stringify(outside && { width: outside.width }));
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: blockId }] });
await settle(page, 300);

// The text tool makes markdown words, typed into with the card's toolbar.
// Off to clear canvas first, as at the start: by now the boards fill the screen round the card.
for (let i = 0; i < 12 && !(await clear()); i++) {
	await page.mouse.move(700, 400);
	await page.mouse.wheel(1500, 0);
	await settle(page, 300);
}
await settle(page, 800);
const freeAt = (await clear()) ? { x: 520, y: 200 } : undefined;
if (freeAt) {
	await page.mouse.click(freeAt.x, freeAt.y);
	await page.keyboard.press("t");
	await page.mouse.click(freeAt.x, freeAt.y);
	await until(() => page.evaluate(() => !!document.activeElement?.closest(".pen-card-editor")), 3000);
	await page.keyboard.type("A **bold** idea");
	await page.keyboard.press("Control+Enter");
}
const words = await until(() => {
	for (const stage of readdirSync(`${deck.path}/stages`)) {
		try {
			const made = (JSON.parse(readFileSync(`${deck.path}/stages/${stage}/stage.pen`, "utf8")).children ?? []).find((n) => n.type === "text" && n.content === "A **bold** idea");
			if (made) return made;
		} catch {
			/* being written */
		}
	}
});
say("the text tool makes markdown words, typed into with the card's editor", !!words && words.metadata?.type === "decks.markdown", JSON.stringify({ freeAt, made: words && { type: words.metadata?.type, width: words.width } }));
if (words) link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: words.id }] });

link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "card-editor" }] });
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "card-picture" }] });
await settle(page, 300);
say("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await editMode(page, false);
link.close();
await browser.close();
