import { cut, splitAround, STYLES, unwrap, type Style } from "./card-styles.ts";
import { atom, h, ZW } from "./card-words.ts";
import { createBlockKind } from "./card-block-kind.ts";

/** What `createCardBlocks` reads of the editor (`CardEditor.tsx`). */
export interface CardBlocksNeeds {
	readonly sel: () => Selection;
	readonly topOf: (n: Node | null) => HTMLElement | undefined;
	readonly ed: HTMLDivElement;
	readonly caretInto: (el: Element, all: boolean) => void;
	readonly toggleMenu: (name: string, button: HTMLElement) => void;
	readonly closeMenus: () => void;
	readonly travel: (back: boolean) => void;
	readonly changed: () => void;
}

/** What the style bar does: a style on the words selected, what a block is, a table or a rule put in. */
export function createCardBlocks(of: CardBlocksNeeds) {
	/** A table of two columns and one row, or a rule, under the block the caret is in. */
	function insertBlock(kind: "table" | "rule") {
		const node = of.sel().anchorNode;
		const after = of.topOf(node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null) ?? (of.ed.lastElementChild as HTMLElement | null);
		let made: HTMLElement;
		if (kind === "table") {
			made = h("table", { class: "pce-table", "data-align": "," });
			const head = made.appendChild(h("thead")).appendChild(h("tr"));
			head.append(h("th", {}, "Column"), h("th", {}, "Column"));
			made.appendChild(h("tbody")).appendChild(h("tr")).append(h("td"), h("td"));
		} else made = atom("---", "", "pce-atom pce-rule", "div");
		const next = h("p");
		next.append(document.createTextNode(ZW));
		if (after) after.after(made, next);
		else of.ed.append(made, next);
		of.caretInto(kind === "table" ? made.querySelector("td")! : next, false);
	}

	function restyle(styles: Style[], value: string | null) {
		const runs = cut(of.ed);
		if (!runs.length) return;
		const texts = runs.flatMap((run) => {
			const walk = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
			const out: Text[] = [];
			for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
			return out;
		});
		for (const name of styles) {
			const style = STYLES[name];
			// Bold on what is all bold already takes it off, as everywhere.
			const off = value === null || (style.toggles && runs.every((run) => run.closest(style.selector) || run.querySelector(style.selector)?.textContent === run.textContent));
			for (const run of runs) {
				for (let outer = run.parentElement?.closest(style.selector) as HTMLElement | null; outer && of.ed.contains(outer); outer = run.parentElement?.closest(style.selector) as HTMLElement | null) splitAround(run, outer);
				run.querySelectorAll(style.selector).forEach(unwrap);
				if (off) continue;
				const made = style.make(value ?? "");
				made.append(...run.childNodes);
				run.append(made);
			}
			// Runs side by side in the same style are one.
			for (const el of [...of.ed.querySelectorAll(style.selector)] as HTMLElement[]) {
				let next = el.nextSibling;
				while (next instanceof HTMLElement && next.matches(style.selector) && next.tagName === el.tagName && next.dataset.c === el.dataset.c && next.dataset.fg === el.dataset.fg && next.dataset.size === el.dataset.size && next.dataset.font === el.dataset.font && next.dataset.href === el.dataset.href) {
					el.append(...next.childNodes);
					next.remove();
					next = el.nextSibling;
				}
			}
		}
		runs.forEach(unwrap);
		of.ed.normalize();
		// The words stay selected, for the next style.
		const first = texts.find((t) => t.isConnected);
		const last = [...texts].reverse().find((t) => t.isConnected);
		if (first && last) {
			const r = document.createRange();
			r.setStart(first, 0);
			r.setEnd(last, last.length);
			of.sel().removeAllRanges();
			of.sel().addRange(r);
		}
	}

	function style(event: MouseEvent) {
		const b = (event.target as Element).closest("button");
		if (!b) return;
		const d = b.dataset;
		if (d.menu) return of.toggleMenu(d.menu, b);
		of.closeMenus();
		const commands: Record<string, Style> = { bold: "bold", italic: "italic", underline: "underline", strikeThrough: "strike", code: "code" };
		if (d.block) setBlock(d.block);
		else if (d.blockButton) setBlock(d.blockButton === "codeblock" ? "code" : blockKind() === d.blockButton ? "p" : d.blockButton);
		else if (d.hl) restyle(["hl"], d.hl === "none" ? null : d.hl);
		else if (d.fg) restyle(["fg"], d.fg === "none" ? null : d.fg);
		else if (d.size) restyle(["size"], d.size === "normal" ? null : d.size);
		else if (d.font) restyle(["font"], d.font === "default" ? null : d.font);
		else if (d.insert) insertBlock(d.insert as "table" | "rule");
		else if (d.cmd === "undo" || d.cmd === "redo") return of.travel(d.cmd === "undo");
		else if (d.cmd === "link") {
			const here = (of.sel().anchorNode?.parentElement?.closest("a[data-href]") as HTMLElement | null)?.dataset.href ?? "";
			const href = window.prompt("Link to (empty takes the link off)", here || "https://");
			if (href === null) return;
			restyle(["link"], href.trim() && href.trim() !== "https://" ? href.trim() : null);
		} else if (d.cmd === "clear") restyle(["bold", "italic", "underline", "strike", "code", "hl", "fg", "size", "font"], null);
		else if (d.cmd && commands[d.cmd]) restyle([commands[d.cmd]!], "on");
		of.changed();
	}

	const { setBlock, blockKind } = createBlockKind(of);

	return {
		blockKind,
		restyle,
		style,
	};
}
