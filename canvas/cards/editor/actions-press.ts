// Presses, keys and drags: a piece dragged between lines or into a sentence, the keys
// the editor answers itself, and the effect that wires the document's presses on mount.
import { onCleanup, onMount } from "solid-js";
import { type Style, ZW, h } from "./model.ts";

import { sel } from "./markup.ts";
import { SELECTION_PAUSE_MS } from "./view.tsx";
import { caretInto } from "./actions.ts";
import type { EditorCtx } from "./ctx.ts";

/** What the editor does once it is on the page: reads the card in, watches it, and wires the document's presses. */
export function mountEditor(cx: EditorCtx): void {
	onMount(() => {
		document.execCommand("defaultParagraphSeparator", false, "p");
		cx.build(cx.props.value);
		const watch = watchBlocks(cx);
		cx.past.push(cx.serialise());
		keepBar(cx);
		wireDocument(cx, watch);
		requestAnimationFrame(() => placeCaret(cx));
	});
}

/** Marks the top-level block a change lands in, so it is written from what it now holds. */
function watchBlocks(cx: EditorCtx): MutationObserver {
	// A block that changes is written from what it now holds; one that does not keeps its source.
	const watch = new MutationObserver((records) => {
		for (const record of records) {
			const top = cx.topOf(record.target === cx.ed ? null : record.target);
			if (top) top.dataset.dirty = "1";
		}
	});
	watch.observe(cx.ed, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-on"] });
	return watch;
}

/** The style bar's own wheel, and its place kept over the words while the card moves. Called in onMount. */
function keepBar(cx: EditorCtx): void {
	// A wheel over the toolbar or its menus scrolls them; the canvas, which takes every other wheel
	// for its camera, never hears of it.
	const ownWheel = (event: WheelEvent) => {
		if ((event.target as Element).closest(".pce-menu, .pce-tools")) event.stopPropagation();
	};
	cx.bar.addEventListener("wheel", ownWheel, { passive: true });
	onCleanup(() => cx.bar.removeEventListener("wheel", ownWheel));
	// Watched once a frame: while the card moves on screen, a pan or a zoom, the bar is gone; once it
	// has rested a moment the bar is put back over the words and fades in.
	let placing = 0;
	let seen = "";
	let movedAt = 0;
	const keep = () => {
		const w = cx.wrap.getBoundingClientRect();
		const now = `${Math.round(w.left)},${Math.round(w.top)},${Math.round(w.width)}`;
		if (now !== seen) {
			const first = !seen;
			seen = now;
			if (!first) {
				movedAt = performance.now();
				if (!cx.bar.hasAttribute("data-hidden")) {
					cx.bar.setAttribute("data-hidden", "");
					cx.closeMenus();
				}
			}
		} else if (cx.bar.hasAttribute("data-hidden") && performance.now() - movedAt > 140) {
			cx.placeBar();
			cx.bar.removeAttribute("data-hidden");
		}
		placing = requestAnimationFrame(keep);
	};
	placing = requestAnimationFrame(keep);
	onCleanup(() => cancelAnimationFrame(placing));
}

/** The document's presses, moves, lifts and selection changes the editor hears, until it goes. Called in onMount. */
function wireDocument(cx: EditorCtx, watch: MutationObserver): void {
	const move = (event: PointerEvent) => cx.onPointerMove(event);
	const up = () => {
		cx.endDrag(false);
		if (cx.selecting) {
			cx.selecting = false;
			cx.showBar();
		}
	};
	const cancel = () => {
		cx.endDrag(true);
		cx.selecting = false;
	};
	// A press in the words starts a selection; the bar waits for the lift (`up`).
	const press = (event: PointerEvent) => {
		if (event.button !== 0 || !cx.ed.contains(event.target as Node)) return;
		cx.selecting = true;
		clearTimeout(cx.settleBar);
		cx.showBar();
	};
	const selection = () => {
		clearTimeout(cx.settleBar);
		if (cx.selecting) return;
		// Up already: it follows the selection. Not up yet: it waits until the selection rests.
		if (!cx.bar.hasAttribute("data-off")) cx.showBar();
		else cx.settleBar = setTimeout(cx.showBar, SELECTION_PAUSE_MS);
	};
	document.addEventListener("pointerdown", press, true);
	document.addEventListener("pointermove", move);
	document.addEventListener("pointerup", up);
	document.addEventListener("pointercancel", cancel);
	document.addEventListener("selectionchange", selection);
	onCleanup(() => {
		watch.disconnect();
		clearTimeout(cx.settleBar);
		document.removeEventListener("pointerdown", press, true);
		document.removeEventListener("pointermove", move);
		document.removeEventListener("pointerup", up);
		document.removeEventListener("pointercancel", cancel);
		document.removeEventListener("selectionchange", selection);
		if (cx.frame !== undefined) cancelAnimationFrame(cx.frame);
	});
}

/** Where the caret goes once the editor shows: a new line in a gap, the point double-clicked, or the end of the words. */
function placeCaret(cx: EditorCtx): void {
	cx.ed.focus({ preventScroll: true });
	// A double-click in a gap: a new line there, empty until something is typed in it.
	if (cx.props.insertAt !== undefined) {
		const line = h("p");
		line.append(document.createTextNode(ZW));
		const before = cx.ed.children[Math.max(0, Math.min(cx.props.insertAt, cx.ed.children.length))] ?? null;
		const lone = cx.ed.children.length === 1 && !cx.ed.firstElementChild!.textContent!.replace(/\u200b/g, "").trim() ? (cx.ed.firstElementChild as HTMLElement) : undefined;
		if (lone) caretInto(lone, false);
		else {
			cx.ed.insertBefore(line, before);
			caretInto(line, false);
			const r = sel().getRangeAt(0);
			r.setStart(line.firstChild!, 1);
			r.collapse(true);
		}
		return;
	}
	// A double-click on the words: the caret where it landed.
	const point = cx.props.caretAt;
	const there = point ? (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(point.x, point.y) : null;
	if (there && cx.ed.contains(there.startContainer) && !(there.startContainer.parentElement?.closest("[contenteditable=false]"))) {
		sel().removeAllRanges();
		sel().addRange(there);
		return;
	}
	// The caret at the end of the last block's words, inside it, so typing continues that block.
	let end: Node = cx.ed;
	while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
	const r = document.createRange();
	r.selectNodeContents(end);
	r.collapse(false);
	sel().removeAllRanges();
	sel().addRange(r);
}

// Dragging a piece
export const local = (cx: EditorCtx, x: number, y: number) => {
	const w = cx.wrap.getBoundingClientRect();
	return { x: (x - w.left) / cx.props.zoom, y: (y - w.top) / cx.props.zoom };
};

export function onPointerDown(cx: EditorCtx, event: PointerEvent) {
	// A press on a suggestion's buttons or a check keeps the caret where it is, a finger's too: a
	// finger's press would otherwise take the focus away, and that saves the card and closes it.
	if ((event.target as Element).closest(".pce-sug button, .pce-check")) {
		event.preventDefault();
		return;
	}
	const it = (event.target as Element).closest(".pce-piece") as HTMLElement | null;
	if (!it || event.button !== 0 || !cx.ed.contains(it)) return;
	event.preventDefault();
	event.stopPropagation();
	cx.press = { it, x: event.clientX, y: event.clientY, id: event.pointerId };
}

export function onPointerMove(cx: EditorCtx, event: PointerEvent) {
	if (!cx.press || event.pointerId !== cx.press.id) return;
	if (!cx.dragging) {
		if (Math.hypot(event.clientX - cx.press.x, event.clientY - cx.press.y) < 4) return;
		cx.dragging = cx.press.it;
		cx.ghost = cx.dragging.cloneNode(true) as HTMLElement;
		cx.ghost.className += " pce-ghost";
		cx.wrap.append(cx.ghost);
		cx.dragging.classList.add("pce-dragging");
		cx.closeMenus();
		sel().removeAllRanges();
	}
	const p = cx.local(event.clientX, event.clientY);
	// Below and right of the pointer, so the mark where it lands stays in view.
	cx.ghost!.style.left = `${p.x + 12 / cx.props.zoom}px`;
	cx.ghost!.style.top = `${p.y + 12 / cx.props.zoom}px`;
	cx.hideMarks();
	cx.target = undefined;
	const over = document.elementFromPoint(event.clientX, event.clientY);
	if (over && cx.ed.contains(over)) {
		if (cx.dragging.classList.contains("pce-block")) cx.lineSlot(event.clientY);
		else cx.textSlot(event.clientX, event.clientY);
	}
}

export function endDrag(cx: EditorCtx, cancel: boolean) {
	const el = cx.dragging;
	cx.press = undefined;
	if (!el) return;
	cx.dragging = undefined;
	cx.hideMarks();
	cx.ghost?.remove();
	cx.ghost = undefined;
	el.classList.remove("pce-dragging");
	if (cancel || !cx.target) return;
	const from = el.parentElement;
	// Taking a piece out of a sentence leaves one space, not two.
	const prev = el.previousSibling;
	const next = el.nextSibling;
	if (prev?.nodeType === 3 && next?.nodeType === 3 && /\s$/.test(prev.textContent ?? "") && /^\s/.test(next.textContent ?? "")) next.textContent = (next.textContent ?? "").replace(/^\s+/, "");
	if (cx.target.kind === "line") cx.ed.insertBefore(el, cx.target.before);
	else {
		const r = cx.target.range;
		let n = r.startContainer;
		let o = r.startOffset;
		// Never inside a word: to its nearer edge, with a space either side.
		if (n.nodeType === 3) {
			const text = n.textContent ?? "";
			const back = text.slice(0, o).search(/\S+$/);
			const fwd = text.slice(o).search(/\s|$/);
			if (back >= 0 && fwd > 0) o = o - back <= fwd ? back : o + fwd;
			r.setStart(n, o);
			r.collapse(true);
		}
		r.insertNode(el);
		if (!/\s$/.test(el.previousSibling?.textContent ?? " ")) el.before(" ");
		if (!/^\s/.test(el.nextSibling?.textContent ?? "")) el.after(" ");
	}
	if (from && from !== cx.ed && from.parentElement === cx.ed && !from.textContent?.replace(/​/g, "").trim() && !from.querySelector(".pce-piece, .pce-check")) from.remove();
	cx.target = undefined;
	cx.changed();
}

// Keys
export function onKeyDown(cx: EditorCtx, event: KeyboardEvent) {
	/*
	 * Home and End move the caret to the line's start and end, Shift extending the selection. On a Mac
	 * they scroll the nearest scroll area instead, which is now the stage (`camera/scroll-area.ts`):
	 * Home in a card sent the canvas some 110,000 units up. The note editor does the same itself.
	 */
	if ((event.key === "Home" || event.key === "End") && !event.metaKey && !event.ctrlKey && !event.altKey) {
		event.preventDefault();
		const selection = sel() as Selection & { modify?: (alter: string, direction: string, granularity: string) => void };
		selection.modify?.(event.shiftKey ? "extend" : "move", event.key === "Home" ? "backward" : "forward", "lineboundary");
		return;
	}
	const at = sel().anchorNode;
	const here = at ? (at.nodeType === 1 ? (at as Element) : at.parentElement) : null;
	// In a callout's title, Enter goes on to its first line.
	const chead = here?.closest(".pce-chead");
	if (event.key === "Enter" && chead && cx.ed.contains(chead)) {
		event.preventDefault();
		const next = chead.nextElementSibling ?? chead.parentElement!.appendChild(h("p"));
		caretInto(next, false);
		return;
	}
	// In a table, Enter goes down a column (adding a row past the last), Tab across the cells.
	const cell = here?.closest("td, th") as HTMLTableCellElement | null;
	if (cell && cx.ed.contains(cell) && ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab")) {
		event.preventDefault();
		const table = cell.closest("table")!;
		const rows = [...table.querySelectorAll("tr")];
		const row = cell.parentElement as HTMLTableRowElement;
		const r = rows.indexOf(row);
		const c = [...row.children].indexOf(cell);
		let target: Element | undefined;
		if (event.key === "Tab") {
			const flat = rows.flatMap((one) => [...one.children]);
			target = flat[flat.indexOf(cell) + (event.shiftKey ? -1 : 1)];
		} else {
			if (r === rows.length - 1) {
				const fresh = h("tr");
				for (let i = 0; i < row.children.length; i++) fresh.append(h("td"));
				table.querySelector("tbody")!.append(fresh);
				rows.push(fresh);
			}
			target = rows[r + 1]!.children[c];
		}
		if (target) caretInto(target, true);
		return cx.changed();
	}
	const mod = event.metaKey || event.ctrlKey;
	// The card keeps its own history, since the browser's cannot follow what the toolbar does.
	if (mod && event.key.toLowerCase() === "z") {
		event.preventDefault();
		return cx.travel(!event.shiftKey);
	}
	if (mod && event.key.toLowerCase() === "y") {
		event.preventDefault();
		return cx.travel(false);
	}
	// ⌘B, ⌘I, ⌘U, ⌘E and ⌘⇧X go through the card's own styles, as the toolbar's buttons do.
	const keyed: Record<string, Style> = { b: "bold", i: "italic", u: "underline", x: "strike", e: "code" };
	const want = mod && keyed[event.key.toLowerCase()];
	if (want && (want !== "strike" || event.shiftKey) && !sel().isCollapsed) {
		event.preventDefault();
		cx.restyle([want], "on");
		return cx.changed();
	}
	if (event.key === "Escape") {
		event.preventDefault();
		if (cx.dragging) return cx.endDrag(true);
		cx.done = true;
		cx.props.onCancel(cx.serialise());
	} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
		event.preventDefault();
		cx.commit();
	}
}
