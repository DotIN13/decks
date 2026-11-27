import type { Splice } from "../index.ts";
import type { PageContext } from "./context.ts";
import { segments, spliceBetween } from "./marks.ts";
import { el } from "./ui.ts";

/**
 * Source: the file's text as it is, for anything the page does not draw, typed into as plain text;
 * and switching between it and the page.
 */

type Caret = { start: number; end: number };

export function mountSource(ctx: PageContext): () => void {
	const { sync, live, reading, gview } = ctx;
	const { sourceButton, text, tools } = ctx.dom;
	let composing = false;

	function setMode(next: PageContext["mode"]): void {
		ctx.hooks.closeVersion();
		ctx.mode = next;
		sourceButton.setAttribute("aria-pressed", String(ctx.mode === "source"));
		text.hidden = ctx.mode !== "source";
		const word = ctx.isWord();
		const google = ctx.isGoogle();
		live.root.hidden = ctx.mode !== "page" || word || google;
		reading.root.hidden = ctx.mode !== "page" || !word;
		gview.root.hidden = ctx.mode !== "page" || !google;
		tools.hidden = ctx.mode !== "page" || word || sync.readOnly || !sync.ready;
		if (ctx.mode === "source") draw(false);
		else if (word) reading.render();
		else if (google) gview.render();
		else live.render();
	}

	function draw(keepCaret = true): void {
		const where = keepCaret ? caret(text) : undefined;
		const frag = document.createDocumentFragment();
		for (const segment of segments(sync.text, ctx.marks.filter((m) => m.kind === "ins"))) {
			if (!("mark" in segment)) frag.append(document.createTextNode(segment.text));
			else frag.append(el("span", { class: "dp-ins" }, segment.text));
		}
		frag.append(el("br"));
		text.replaceChildren(frag);
		if (where) place(text, where);
	}

	function typed(): void {
		const now = text.textContent ?? "";
		const at = caret(text);
		const splice = spliceBetween(sync.text, now, at?.end ?? now.length);
		if (splice) sync.edit(splice);
	}

	text.addEventListener("compositionstart", () => (composing = true));
	text.addEventListener("compositionend", () => {
		composing = false;
		typed();
	});
	text.addEventListener("input", () => {
		if (!composing) typed();
	});
	sourceButton.onclick = () => setMode(ctx.mode === "source" ? "page" : "source");

	ctx.hooks.setMode = setMode;
	ctx.hooks.draw = draw;
	ctx.hooks.drawShifted = (applied) => {
		const where = caret(text);
		draw(false);
		if (where) place(text, shiftCaret(where, applied));
	};
	return () => {};
}

// --- the caret, as offsets into the file's text ---------------------------------------------------

function texts(text: HTMLElement): Text[] {
	const out: Text[] = [];
	const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
	return out;
}

function offsetOf(text: HTMLElement, node: Node, offset: number): number {
	let total = 0;
	if (node.nodeType !== Node.TEXT_NODE) {
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(node, offset);
		return range.toString().length;
	}
	for (const t of texts(text)) {
		if (t === node) return total + offset;
		total += t.data.length;
	}
	return total;
}

function caret(text: HTMLElement): Caret | undefined {
	const selection = getSelection();
	if (!selection || selection.rangeCount === 0 || !text.contains(selection.anchorNode)) return undefined;
	return { start: offsetOf(text, selection.anchorNode!, selection.anchorOffset), end: offsetOf(text, selection.focusNode!, selection.focusOffset) };
}

function place(text: HTMLElement, at: Caret): void {
	const find = (offset: number): [Node, number] => {
		let total = 0;
		const all = texts(text);
		for (const t of all) {
			if (offset <= total + t.data.length) return [t, offset - total];
			total += t.data.length;
		}
		const last = all.at(-1);
		return last ? [last, last.data.length] : [text, 0];
	};
	const [an, ao] = find(at.start);
	const [fn, fo] = find(at.end);
	getSelection()?.setBaseAndExtent(an, ao, fn, fo);
}

/** Where the caret goes when others' splices land: past what was put in before it, inside nothing that went. */
function shiftCaret(at: Caret, applied: readonly Splice[]): Caret {
	const move = (p: number) => applied.reduce((q, s) => (q <= s.at ? q : q >= s.at + s.before.length ? q + s.text.length - s.before.length : s.at + s.text.length), p);
	return { start: move(at.start), end: move(at.end) };
}
