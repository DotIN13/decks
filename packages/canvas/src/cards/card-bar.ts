import { pageFont } from "../look/look.ts";
import { m } from "@decks/i18n";
import type { CardEditorProps } from "./card-editor-props.ts";
import { createCardDrag } from "./card-drag.ts";
import { BLOCK_MENU, SIZE_MENU } from "./card-menus.ts";
import { canvasHost } from "../base/host.ts";

/** How long a selection the keyboard grows must rest before the bar shows. */
export const SELECTION_PAUSE_MS = 300;

/** What `createCardBar` reads of the editor (`CardEditor.tsx`). */
export interface CardBarNeeds {
	readonly bar: HTMLDivElement;
	readonly sel: () => Selection;
	readonly wrap: HTMLDivElement;
	readonly props: CardEditorProps;
	readonly cardDrag: ReturnType<typeof createCardDrag>;
	readonly ed: HTMLDivElement;
	readonly blockKind: () => string;
	readonly tools: HTMLDivElement;
}

/** Where the style bar sits and what it shows pressed, and its menus opening and closing. */
export function createCardBar(d: CardBarNeeds) {
	/* ---------- the style bar ---------- */

	/*
	 * The toolbar: over the words selected, as a selection's bar is, at the screen's size whatever the
	 * zoom, in two rows that scroll sideways when the screen is narrower than them. Above the words, or
	 * under them when the app's own bars or the screen's top are in the way, and never past an edge.
	 * It goes the moment the camera moves and comes back with a fade where the words came to rest, as
	 * the card pill does (`placing`).
	 */
	let wanted = false;

	/*
	 * Shown once a selection stops changing, not while it is being made: a pointer selecting words
	 * shows the bar when it lifts, and a selection the keyboard grows shows it after a short pause.
	 */
	let selecting = false;

	let settleBar: ReturnType<typeof setTimeout> | undefined;


	function placeBar() {
		if (!d.bar.isConnected || !wanted || !d.sel().rangeCount) return;
		const r = d.sel().getRangeAt(0).getBoundingClientRect();
		const w = d.wrap.getBoundingClientRect();
		const z = d.props.zoom;
		d.bar.style.transform = `scale(${1 / z})`;
		const bw = d.bar.offsetWidth;
		const bh = d.bar.offsetHeight;
		const ceiling = Math.max(8, ...[...document.querySelectorAll('[data-inset="top"]')].map((el) => el.getBoundingClientRect().bottom + 6));
		const above = r.top - bh - 10;
		const top = above >= ceiling ? above : Math.min(innerHeight - bh - 8, r.bottom + 10);
		// Centred on the words selected, kept on the screen and clear of the app's tool column at its side.
		// The column in this document, or where the app's page says its own stands over the canvas (`CanvasHost.toolsAt`).
		const said = canvasHost().toolsAt?.();
		const columns = [...[...document.querySelectorAll(".pen-tools")].map((el) => el.getBoundingClientRect()).map((t) => ({ left: t.left, top: t.top, right: t.right, bottom: t.bottom })), ...(said ? [said] : [])];
		const floor = Math.max(8, ...columns.filter((t) => t.right > t.left && t.top < top + bh && t.bottom > top && t.left < innerWidth / 3).map((t) => t.right + 6));
		const left = Math.max(floor, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
		d.bar.style.left = `${(left - w.left) / z}px`;
		d.bar.style.top = `${(top - w.top) / z}px`;
	}

	/** The toolbar says what the words under the caret are: their block, font and size, and which styles are on. */
	function showBar() {
		const s = d.sel();
		const was = wanted;
		// Shown while words are selected, as before; a press inside the bar keeps the selection, so it stays.
		wanted = !d.cardDrag.dragging && !selecting && s.rangeCount > 0 && !s.isCollapsed && d.ed.contains(s.anchorNode);
		d.bar.toggleAttribute("data-off", !wanted);
		if (!wanted) closeMenus();
		if (!wanted) return;
		if (!was || !d.bar.hasAttribute("data-hidden")) placeBar();
		const at = s.anchorNode?.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode?.parentElement;
		const label = (name: string, text: string) => {
			const el = d.bar.querySelector(`[data-label="${name}"]`);
			if (el) el.textContent = text;
		};
		const kind = d.blockKind();
		label("block", (BLOCK_MENU.find(([k]) => k === kind)?.[1] ?? m.canvas_card_block_body)());
		const face = (at?.closest("span[data-font]") as HTMLElement | null)?.dataset.font;
		label("font", face ?? "Inter");
		label("size", (SIZE_MENU.find(([k]) => k === ((at?.closest("span[data-size]") as HTMLElement | null)?.dataset.size ?? "normal"))?.[1] ?? m.canvas_card_size_normal)());
		const on: Record<string, boolean> = {
			bold: !!at?.closest("strong, b"),
			italic: !!at?.closest("em, i"),
			underline: !!at?.closest("u"),
			strikeThrough: !!at?.closest("s, strike, del"),
			code: !!at?.closest("code"),
			link: !!at?.closest("a[data-href]"),
			ul: kind === "ul",
			ol: kind === "ol",
			check: kind === "check",
			quote: kind === "quote",
			codeblock: kind === "code",
		};
		for (const button of d.bar.querySelectorAll<HTMLElement>("[data-cmd], [data-block-button]")) {
			const key = button.dataset.cmd ?? button.dataset.blockButton ?? "";
			if (key in on) button.setAttribute("aria-pressed", String(on[key]));
		}
	}

	/** Open one of the toolbar's menus under its button, or close it; one at a time. */
	function toggleMenu(name: string, button: HTMLElement) {
		const menu = d.bar.querySelector<HTMLElement>(`.pce-menu[data-for="${name}"]`);
		const open = menu?.hasAttribute("data-open");
		closeMenus();
		if (!menu || open) return;
		// The font menu fetches its faces the first time it opens, each name shown in its own.
		if (name === "font") for (const el of menu.querySelectorAll<HTMLElement>("[data-font]")) if (!el.style.fontFamily && el.dataset.font !== "default") el.style.fontFamily = pageFont(el.dataset.font!, 400, false);
		menu.style.left = `${button.offsetLeft - d.tools.scrollLeft}px`;
		menu.setAttribute("data-open", "");
	}

	const closeMenus = () => d.bar.querySelectorAll(".pce-menu").forEach((m) => m.removeAttribute("data-open"));

	return {
		showBar,
		toggleMenu,
		closeMenus,
		placeBar,
		get selecting() {
			return selecting;
		},
		set selecting(next) {
			selecting = next;
		},
		get settleBar() {
			return settleBar;
		},
		set settleBar(next) {
			settleBar = next;
		},
	};
}
