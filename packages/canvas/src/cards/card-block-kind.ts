import { h, ZW } from "./card-words.ts";

/** What `createBlockKind` reads of the editor (`CardEditor.tsx`). */
export interface BlockKindNeeds {
	readonly sel: () => Selection;
	readonly topOf: (n: Node | null) => HTMLElement | undefined;
	readonly ed: HTMLDivElement;
}

/** What a block is: text, a heading, a quote, code, a list; read for the bar, and set from its menu. */
export function createBlockKind(d: BlockKindNeeds) {
	const BLOCK_NAMES: Record<string, string> = { p: "Text", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", quote: "Quote", code: "Code", ul: "Bullets", ol: "Numbers", check: "Checklist" };

	/** What the block the caret is in is, by the names the block menu uses. */
	function blockKind(): string {
		const node = d.sel().anchorNode;
		const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
		const top = d.topOf(el);
		if (!top) return "p";
		if (/^H[1-3]$/.test(top.tagName)) return top.tagName.toLowerCase();
		if (top.tagName === "BLOCKQUOTE") return "quote";
		if (top.tagName === "PRE") return "code";
		if (top.tagName === "OL") return "ol";
		if (top.tagName === "UL") return el?.closest("li")?.querySelector(":scope > .pce-check") ? "check" : "ul";
		return "p";
	}

	/** Every block the selection touches becomes `kind`: its lines kept, its words' styles with them. */
	function setBlock(kind: string) {
		if (!d.sel().rangeCount) return;
		const range = d.sel().getRangeAt(0);
		const touched = ([...d.ed.children] as HTMLElement[]).filter((block) => range.intersectsNode(block) && !block.classList.contains("pce-piece") && !block.classList.contains("pce-atom"));
		if (!touched.length) return;
		// Each block as lines of inline words.
		const lines: Node[][] = [];
		const inlineOf = (el: Element) => [...el.childNodes].filter((n) => !(n instanceof HTMLElement && (n.classList.contains("pce-check") || n.tagName === "UL" || n.tagName === "OL")));
		for (const block of touched) {
			if (block.tagName === "UL" || block.tagName === "OL") {
				for (const li of block.querySelectorAll("li")) lines.push(inlineOf(li).flatMap((n) => (n instanceof HTMLElement && n.tagName === "P" ? [...n.childNodes] : [n])));
			} else if (block.tagName === "BLOCKQUOTE") {
				for (const p of block.querySelectorAll(":scope > p")) lines.push([...p.childNodes]);
			} else if (block.tagName === "PRE") {
				for (const text of (block.textContent ?? "").split("\n")) lines.push([document.createTextNode(text)]);
			} else if (block.tagName === "TABLE") continue;
			else lines.push([...block.childNodes]);
		}
		const made: HTMLElement[] = [];
		const filled = (el: HTMLElement, nodes: Node[]) => {
			el.append(...(nodes.length ? nodes : [document.createTextNode(ZW)]));
			return el;
		};
		if (kind === "quote") {
			const quote = h("blockquote");
			for (const nodes of lines) quote.append(filled(h("p"), nodes));
			made.push(quote);
		} else if (kind === "code") made.push(h("pre", { class: "pce-code", "data-lang": "" }, lines.map((nodes) => nodes.map((n) => n.textContent).join("")).join("\n")));
		else if (kind === "ul" || kind === "ol" || kind === "check") {
			const list = h(kind === "ol" ? "ol" : "ul");
			for (const nodes of lines) {
				const li = filled(h("li"), nodes);
				if (kind === "check") li.prepend(h("span", { class: "pce-check", contenteditable: "false" }));
				list.append(li);
			}
			made.push(list);
		} else for (const nodes of lines) made.push(filled(h(kind as "p"), nodes));
		touched[0]!.before(...made);
		touched.forEach((block) => block.remove());
		const last = made.at(-1)!;
		const r = document.createRange();
		r.selectNodeContents(last.querySelector("li:last-child, p:last-child") ?? last);
		r.collapse(false);
		d.sel().removeAllRanges();
		d.sel().addRange(r);
	}

	return {
		setBlock,
		blockKind,
	};
}
