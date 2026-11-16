// The editor's markup and its style bar: where the bar goes, its menus, and the marks
// that show where a dragged piece will land.
import Baseline from "lucide-solid/icons/baseline";
import Bold from "lucide-solid/icons/bold";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Code from "lucide-solid/icons/code";
import Highlighter from "lucide-solid/icons/highlighter";
import Italic from "lucide-solid/icons/italic";
import Link from "lucide-solid/icons/link";
import List from "lucide-solid/icons/list";
import ListChecks from "lucide-solid/icons/list-checks";
import ListOrdered from "lucide-solid/icons/list-ordered";
import Minus from "lucide-solid/icons/minus";
import Redo2 from "lucide-solid/icons/redo-2";
import RemoveFormatting from "lucide-solid/icons/remove-formatting";
import SquareCode from "lucide-solid/icons/square-code";
import Strikethrough from "lucide-solid/icons/strikethrough";
import Table from "lucide-solid/icons/table";
import TextQuote from "lucide-solid/icons/text-quote";
import Underline from "lucide-solid/icons/underline";
import Undo2 from "lucide-solid/icons/undo-2";
import { For, type JSX } from "solid-js";
import { ScribbleCatch } from "@decks/ui";
import { pageFont } from "../../look/look.ts";
import { FONT_GROUPS } from "../card-syntax.ts";

import { sel } from "./model.ts";

import type { EditorCtx } from "./ctx.ts";

export const BLOCK_MENU: ReadonlyArray<[string, string]> = [["p", "Body text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["quote", "Quote"], ["code", "Code block"]];
export const SIZE_MENU: ReadonlyArray<[string, string]> = [["small", "Small"], ["normal", "Normal"], ["large", "Large"], ["huge", "Huge"]];
export const SIX = ["yellow", "orange", "red", "green", "blue", "purple"] as const;
export const SELECTION_PAUSE_MS = 300;

// The markup
/** The editor's markup: the words, the style bar with its menus, the drop marks. */
export function EditorView(cx: EditorCtx): JSX.Element {
	return (
		<div
			ref={cx.wrap}
			class={`pen-card-editor ${cx.props.class ?? ""}`}
			style={cx.props.style}
			onKeyDown={cx.onKeyDown}
			onFocusOut={cx.onFocusOut}
			// A press in the card is the card's: not the start of a pan or a tap on the canvas behind it.
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ScribbleCatch target={() => cx.ed} append={cx.appendWords} context={() => (cx.ed?.innerText ?? "").replace(/\s+$/, "")} onEnd={cx.commit} />
			<div
				ref={cx.ed}
				class="pce-body"
				contenteditable="true"
				spellcheck={false}
				onInput={(event) => cx.onInput(event as InputEvent)}
				onPaste={cx.onPaste}
				onClick={cx.onClick}
				onDblClick={cx.onDblClick}
				onPointerDown={cx.onPointerDown}
				onMouseDown={(event) => {
					// A press on a suggestion's buttons or a check must not move the caret into it.
					if ((event.target as Element).closest(".pce-sug button, .pce-check")) event.preventDefault();
				}}
			/>
			<StyleBar cx={cx} />
			<div ref={cx.caret} class="pce-caret" />
			<div ref={cx.line} class="pce-line" />
		</div>
	);
}

/** The style bar over the words: two rows of tools, and the menus they open. */
function StyleBar(p: { cx: EditorCtx }): JSX.Element {
	const cx = p.cx;
	return (
		<div ref={cx.bar} class="pce-bar" data-off onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={cx.style}>
			<div ref={cx.tools} class="pce-tools" onScroll={cx.closeMenus}>
				{/* Two rows: what the words are set in, and what is done to them. */}
				<div class="pce-row">
					<button type="button" class="pce-pick pce-pick-block" data-menu="block" title="What the block is">
						<span data-label="block">Body text</span>
						<ChevronDown size={16} />
					</button>
					<button type="button" class="pce-pick pce-pick-font" data-menu="font" title="Font">
						<span data-label="font">Inter</span>
						<ChevronDown size={16} />
					</button>
					<button type="button" class="pce-pick pce-pick-size" data-menu="size" title="Size">
						<span data-label="size">Normal</span>
						<ChevronDown size={16} />
					</button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-cmd="undo" title="Undo (⌘Z)"><Undo2 size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="redo" title="Redo (⌘⇧Z)"><Redo2 size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="clear" title="Clear styling"><RemoveFormatting size={18} /></button>
				</div>
				<div class="pce-row">
					<button type="button" class="pce-icon" data-cmd="bold" title="Bold (⌘B)"><Bold size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="italic" title="Italic (⌘I)"><Italic size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="underline" title="Underline (⌘U)"><Underline size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="strikeThrough" title="Strike (⌘⇧X)"><Strikethrough size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="code" title="Code (⌘E)"><Code size={18} /></button>
					<button type="button" class="pce-icon" data-menu="hl" title="Highlight"><Highlighter size={18} /></button>
					<button type="button" class="pce-icon" data-menu="fg" title="Text colour"><Baseline size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="link" title="Link"><Link size={18} /></button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-block-button="ul" title="Bulleted list"><List size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="ol" title="Numbered list"><ListOrdered size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="check" title="Checklist"><ListChecks size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="quote" title="Quote"><TextQuote size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="codeblock" title="Code block"><SquareCode size={18} /></button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-insert="table" title="Table"><Table size={18} /></button>
					<button type="button" class="pce-icon" data-insert="rule" title="Rule"><Minus size={18} /></button>
				</div>
			</div>
			<BarMenus />
		</div>
	);
}

/** The bar's menus: the block kinds, the fonts, the sizes, the highlights and the colours. */
function BarMenus(): JSX.Element {
	return (
		<>
			<div class="pce-menu" data-for="block">
				<For each={BLOCK_MENU}>{([kind, name]) => <button type="button" class={`pce-opt pce-opt-${kind}`} data-block={kind}>{name}</button>}</For>
			</div>
			<div class="pce-menu pce-fonts" data-for="font">
				<button type="button" class="pce-opt" data-font="default">Inter <small>the card's own</small></button>
				<For each={FONT_GROUPS}>
					{(group) => (
						<>
							<span class="pce-group">{group.group}</span>
							<For each={group.fonts.filter((font) => font !== "Inter")}>{(font) => <button type="button" class="pce-opt" data-font={font}>{font}</button>}</For>
						</>
					)}
				</For>
			</div>
			<div class="pce-menu" data-for="size">
				<For each={SIZE_MENU}>{([size, name]) => <button type="button" class={`pce-opt pce-size-${size}`} data-size={size}>{name}</button>}</For>
			</div>
			<div class="pce-menu pce-swatches" data-for="hl">
				<For each={SIX}>{(c) => <button type="button" class="pce-sw" data-hl={c} title={`${c} highlight`} />}</For>
				<button type="button" class="pce-opt" data-hl="none">No highlight</button>
			</div>
			<div class="pce-menu pce-swatches" data-for="fg">
				<For each={SIX}>{(c) => <button type="button" class="pce-swatch-fg" data-fg={c} title={`${c} text`}>A</button>}</For>
				<button type="button" class="pce-opt" data-fg="none">No colour</button>
			</div>
		</>
	);
}

// Where the bar goes, and its menus
export function placeBar(cx: EditorCtx) {
	if (!cx.bar.isConnected || !cx.wanted || !sel().rangeCount) return;
	const r = sel().getRangeAt(0).getBoundingClientRect();
	const w = cx.wrap.getBoundingClientRect();
	const z = cx.props.zoom;
	cx.bar.style.transform = `scale(${1 / z})`;
	const bw = cx.bar.offsetWidth;
	const bh = cx.bar.offsetHeight;
	const ceiling = Math.max(8, ...[...document.querySelectorAll('[data-inset="top"]')].map((el) => el.getBoundingClientRect().bottom + 6));
	const above = r.top - bh - 10;
	const top = above >= ceiling ? above : Math.min(innerHeight - bh - 8, r.bottom + 10);
	// Centred on the words selected, kept on the screen and clear of the app's tool column at its side.
	const floor = Math.max(8, ...[...document.querySelectorAll(".pen-tools")].map((el) => el.getBoundingClientRect()).filter((t) => t.width && t.top < top + bh && t.bottom > top && t.left < innerWidth / 3).map((t) => t.right + 6));
	const left = Math.max(floor, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
	cx.bar.style.left = `${(left - w.left) / z}px`;
	cx.bar.style.top = `${(top - w.top) / z}px`;
}

/** The toolbar says what the words under the caret are: their block, font and size, and which styles are on. */
export function showBar(cx: EditorCtx) {
	const s = sel();
	const was = cx.wanted;
	// Shown while words are selected, as before; a press inside the bar keeps the selection, so it stays.
	cx.wanted = !cx.dragging && !cx.selecting && s.rangeCount > 0 && !s.isCollapsed && cx.ed.contains(s.anchorNode);
	cx.bar.toggleAttribute("data-off", !cx.wanted);
	if (!cx.wanted) cx.closeMenus();
	if (!cx.wanted) return;
	if (!was || !cx.bar.hasAttribute("data-hidden")) cx.placeBar();
	const at = s.anchorNode?.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode?.parentElement;
	const label = (name: string, text: string) => {
		const el = cx.bar.querySelector(`[data-label="${name}"]`);
		if (el) el.textContent = text;
	};
	const kind = cx.blockKind();
	label("block", BLOCK_MENU.find(([k]) => k === kind)?.[1] ?? "Body text");
	const face = (at?.closest("span[data-font]") as HTMLElement | null)?.dataset.font;
	label("font", face ?? "Inter");
	label("size", SIZE_MENU.find(([k]) => k === ((at?.closest("span[data-size]") as HTMLElement | null)?.dataset.size ?? "normal"))?.[1] ?? "Normal");
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
	for (const button of cx.bar.querySelectorAll<HTMLElement>("[data-cmd], [data-block-button]")) {
		const key = button.dataset.cmd ?? button.dataset.blockButton ?? "";
		if (key in on) button.setAttribute("aria-pressed", String(on[key]));
	}
}

/** Open one of the toolbar's menus under its button, or close it; one at a time. */
export function toggleMenu(cx: EditorCtx, name: string, button: HTMLElement) {
	const menu = cx.bar.querySelector<HTMLElement>(`.pce-menu[data-for="${name}"]`);
	const open = menu?.hasAttribute("data-open");
	cx.closeMenus();
	if (!menu || open) return;
	// The font menu fetches its faces the first time it opens, each name shown in its own.
	if (name === "font") for (const el of menu.querySelectorAll<HTMLElement>("[data-font]")) if (!el.style.fontFamily && el.dataset.font !== "default") el.style.fontFamily = pageFont(el.dataset.font!, 400, false);
	menu.style.left = `${button.offsetLeft - cx.tools.scrollLeft}px`;
	menu.setAttribute("data-open", "");
}

export const closeMenus = (cx: EditorCtx) => cx.bar.querySelectorAll(".pce-menu").forEach((m) => m.removeAttribute("data-open"));

// The marks that show where a dragged piece will land
export function hideMarks(cx: EditorCtx) {
	cx.caret.style.display = cx.line.style.display = "none";
}

export function lineSlot(cx: EditorCtx, y: number) {
	const kids = [...cx.ed.children].filter((k) => k !== cx.dragging);
	let i = kids.findIndex((k) => {
		const r = k.getBoundingClientRect();
		return y < r.top + r.height / 2;
	});
	if (i < 0) i = kids.length;
	const er = cx.ed.getBoundingClientRect();
	const at = !kids.length
		? er.top + 8
		: i === 0
			? kids[0]!.getBoundingClientRect().top - 3
			: i === kids.length
				? kids[i - 1]!.getBoundingClientRect().bottom + 3
				: (kids[i - 1]!.getBoundingClientRect().bottom + kids[i]!.getBoundingClientRect().top) / 2;
	const p = cx.local(er.left, at);
	cx.line.style.display = "block";
	cx.line.style.left = `${p.x}px`;
	cx.line.style.top = `${p.y - 1.5 / cx.props.zoom}px`;
	cx.line.style.width = `${er.width / cx.props.zoom}px`;
	cx.line.style.height = `${3 / cx.props.zoom}px`;
	cx.target = { kind: "line", before: kids[i] ?? null };
}

export function textSlot(cx: EditorCtx, x: number, y: number) {
	const r = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y);
	const n = r && (r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement);
	if (!r || !n || !cx.ed.contains(n) || n === cx.ed || n.closest(".pce-piece, .pce-sug, .pce-atom, pre") || cx.dragging!.contains(n)) return;
	const rect = r.getClientRects()[0] ?? n.getBoundingClientRect();
	const p = cx.local(rect.left, rect.top);
	cx.caret.style.display = "block";
	cx.caret.style.left = `${p.x - 1 / cx.props.zoom}px`;
	cx.caret.style.top = `${p.y}px`;
	cx.caret.style.width = `${2 / cx.props.zoom}px`;
	cx.caret.style.height = `${Math.max(16, rect.height) / cx.props.zoom}px`;
	cx.target = { kind: "text", range: r };
}
