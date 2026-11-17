import { h, ZW } from "./card-words.ts";

/** What `createCardTyping` reads of the editor (`CardEditor.tsx`). */
export interface CardTypingNeeds {
	readonly sel: () => Selection;
	readonly ed: HTMLDivElement;
	readonly topOf: (n: Node | null) => HTMLElement | undefined;
	readonly changed: () => void;
}

/** Typing in a card: words style themselves as they are typed, and a line's start makes it a heading, a list or a quote. */
export function createCardTyping(d: CardTypingNeeds) {
	function placeAfter(node: Node) {
		const z = document.createTextNode(ZW);
		node.parentNode!.insertBefore(z, node.nextSibling);
		const r = document.createRange();
		r.setStart(z, 1);
		r.collapse(true);
		d.sel().removeAllRanges();
		d.sel().addRange(r);
	}

	const INLINE: Array<[RegExp, string]> = [
		[/\*\*([^*​]+)\*\*$/, "strong"],
		[/==([^=​]+)==$/, "mark"],
		[/~~([^~​]+)~~$/, "s"],
		[/`([^`​]+)`$/, "code"],
		[/(?:^|[^*])\*([^*​]+)\*$/, "em"],
		[/(?:^|[^_\w])_([^_​]+)_$/, "em"],
	];

	const BLOCKS: Record<string, string> = { "# ": "h1", "## ": "h2", "### ": "h3", "> ": "blockquote", "- ": "ul", "* ": "ul", "1. ": "ol", "[] ": "check", "[ ] ": "check" };

	function onInput(event: InputEvent) {
		// Words typed straight into the card, outside any block, become a paragraph of their own.
		const loose = d.sel().anchorNode;
		if (loose?.nodeType === 3 && loose.parentNode === d.ed) {
			const at = d.sel().anchorOffset;
			const p = h("p");
			d.ed.insertBefore(p, loose);
			p.append(loose);
			const r = document.createRange();
			r.setStart(loose, at);
			r.collapse(true);
			d.sel().removeAllRanges();
			d.sel().addRange(r);
		}
		if (event.inputType === "insertText") {
			const node = d.sel().anchorNode;
			const off = d.sel().anchorOffset;
			if (node && node.nodeType === 3 && d.ed.contains(node)) {
				const before = (node.textContent ?? "").slice(0, off);
				const blk = d.topOf(node);
				if (event.data === " " && blk && (blk.tagName === "P" || blk.tagName === "DIV")) {
					const typed = (blk.textContent ?? "").replace(/​/g, "");
					const head = before.replace(/​/g, "").replace(/ /g, " ");
					const rule = typed.replace(/ /g, " ").startsWith(head) && blk.firstChild === node ? BLOCKS[head] : undefined;
					if (rule) {
						const r = document.createRange();
						r.setStart(node, 0);
						r.setEnd(node, off);
						r.deleteContents();
						const outer = h((rule === "check" ? "ul" : rule) as "p");
						const inner = rule === "ul" || rule === "ol" || rule === "check" ? outer.appendChild(h("li")) : rule === "blockquote" ? outer.appendChild(h("p")) : outer;
						if (rule === "check") inner.append(h("span", { class: "pce-check", contenteditable: "false" }));
						while (blk.firstChild) inner.append(blk.firstChild);
						const z = document.createTextNode(ZW);
						inner.append(z);
						blk.replaceWith(outer);
						const c = document.createRange();
						c.setStart(z, 1);
						c.collapse(true);
						d.sel().removeAllRanges();
						d.sel().addRange(c);
						return d.changed();
					}
				}
				// In a list already, a list's marker typed at the start of an item is the item itself.
				const li = node.parentElement?.closest("li");
				if (event.data === " " && li && d.ed.contains(li) && (li.firstChild === node || (li.firstChild as HTMLElement | null)?.classList?.contains("pce-check"))) {
					const head = before.replace(/\u200b/g, "").replace(/\u00a0/g, " ");
					if (/^([-*+]|\d+[.)]|\[ ?\])\s$/.test(head)) {
						const r = document.createRange();
						r.setStart(node, 0);
						r.setEnd(node, off);
						r.deleteContents();
						if (head.startsWith("[") && !li.querySelector(":scope > .pce-check")) li.prepend(h("span", { class: "pce-check", contenteditable: "false" }));
						return d.changed();
					}
				}
				for (const [re, tag] of INLINE) {
					const m = re.exec(before);
					if (!m) continue;
					const full = /^[*_=~`]/.test(m[0]) ? m[0] : m[0].slice(1);
					const r = document.createRange();
					r.setStart(node, off - full.length);
					r.setEnd(node, off);
					r.deleteContents();
					const el = h(tag as "strong", {}, m[1]);
					r.insertNode(el);
					placeAfter(el);
					break;
				}
			}
		}
		d.changed();
	}

	return {
		onInput,
	};
}
