// What a card's page reads like (rules 5 and 6): measured in the page by
// READ and PRESS, then said as one note by noteOf.

export type Reading = { h: number; words: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number };
export type Views = { controls: number; opening: number; views: { label: string; h: number; overflowX: number }[] };

const WORDS = `const words = (text) => {
	const cjk = /[\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af]/g;
	return (text.replace(cjk, " ").match(/[\\p{L}\\p{N}][^\\s]*/gu)?.length ?? 0) + Math.round((text.match(cjk)?.length ?? 0) / 1.6);
};`;

/** Runs in the page: the content's height at the page's width, and how it reads. */
export const READ = `(() => {
	${WORDS}
	const body = document.body, root = document.getElementById("decks-card") || body, doc = document.documentElement;
	body.style.height = "auto"; body.style.minHeight = "0";
	if (root !== body) { root.style.height = "auto"; root.style.minHeight = "0"; }
	doc.style.height = "auto";
	if (getComputedStyle(body).display === "block") body.style.display = "flow-root";
	const below = parseFloat(getComputedStyle(body).marginBottom) || 0;
	const h = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().bottom + scrollY + below));
	const out = { h, words: words(root.innerText || "") };
	const spill = doc.scrollWidth - doc.clientWidth;
	if (spill > 2) out.overflowX = spill;
	let cut = 0;
	for (const el of root.querySelectorAll("*")) {
		if (el.scrollHeight - el.clientHeight <= 4 || !(el.innerText || "").trim() || el.clientHeight <= 0) continue;
		if (getComputedStyle(el).overflowY !== "visible") cut++;
	}
	if (cut) out.cut = cut;
	const boxes = [...root.querySelectorAll("svg text")].filter((t) => (t.textContent || "").trim()).map((t) => t.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0).slice(0, 200);
	let overlaps = 0;
	for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
		const across = Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left);
		const down = Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top);
		if (across > 3 && down > 3) overlaps++;
	}
	if (overlaps) out.overlaps = overlaps;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const el = node.parentElement;
		if (!node.nodeValue || !/\\S{2,}/.test(node.nodeValue) || !el || el.closest("script, style")) continue;
		const r = el.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) continue;
		const size = parseFloat(getComputedStyle(el).fontSize);
		if (Number.isFinite(size) && (out.minFont === undefined || size < out.minFont)) out.minFont = Math.round(size * 10) / 10;
	}
	return out;
})()`;

/** Runs in the page: each visible control pressed in turn, the views that grow too tall or wide. */
export const PRESS = `(async () => {
	const controls = [...document.querySelectorAll("button, summary, [role=tab], [data-tab], select")].filter((el) => el.getBoundingClientRect().width > 0);
	const bottom = () => { let b = 0; for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.width && r.height) b = Math.max(b, r.bottom + scrollY); } return Math.round(b); };
	const opening = bottom();
	const limit = opening + 2;
	const views = [];
	for (const el of controls.slice(0, 12)) {
		try { el.click(); } catch {}
		await new Promise((r) => setTimeout(r, 80));
		const h = bottom(), overflowX = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
		if (h > limit || overflowX > 2) views.push({ label: (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40), h, overflowX });
	}
	return { controls: controls.length, opening, views };
})()`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What was over a limit, as sentences; empty when the card is one screen. */
export function overLimits(reading: Reading, width: number, views: Views | undefined, errors: string[]): string[] {
	const screen = Math.round(width * 0.72);
	const over: string[] = [];
	if (reading.h > screen) over.push(`it is ${reading.h} px tall, more than one screen (about ${screen} px at this width)`);
	if (reading.words > 170) over.push(`it has ${reading.words} words, where about 120 is what gets read`);
	if (reading.minFont !== undefined && reading.minFont < 14) over.push(`its smallest text is ${reading.minFont}px, and under 14px is not readable once the card is fitted to a window`);
	if (reading.overflowX) over.push(`it is ${reading.overflowX} px wider than the card, so its right edge is cut off`);
	if (reading.cut) over.push(`${plural(reading.cut, "box", "boxes")} cut off their own content, and a card cannot scroll`);
	if (reading.overlaps) over.push(`${plural(reading.overlaps, "pair")} of labels in a drawing overlap`);
	for (const view of views?.views ?? []) {
		const wide = view.overflowX ? ` and ${view.overflowX} px too wide` : "";
		over.push(`after pressing "${view.label}" it is ${view.h} px tall${wide}, where it opens at ${views!.opening} px, so that view has its last lines cut`);
	}
	for (const error of errors.slice(0, 3)) over.push(`a script on it throws: ${error}`);
	return over;
}

/** The note card.fit adds: the advice when something is over, else "One screen". */
export function noteOf(reading: Reading, width: number, views: Views | undefined, errors: string[]): string {
	const over = overLimits(reading, width, views, errors);
	if (over.length) return `To fix: ${over.join("; ")}. Cut it, enlarge the type, or move the second idea to its own card.`;
	const type = reading.minFont === undefined ? "" : `, smallest text ${reading.minFont}px`;
	const pressed = views ? `, ${plural(views.controls, "control")} pressed and every view fits` : "";
	return `One screen: ${reading.h} px tall, ${reading.words} words${type}${pressed}. Nothing to fix.`;
}
