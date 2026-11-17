import type { Tokens } from "marked";
import { cardMarked } from "../model/card-syntax.ts";
import { h, inline, type WordsHost } from "./card-words.ts";

/** What `createCardPaste` reads of the editor (`CardEditor.tsx`). */
export interface CardPasteNeeds {
	readonly sel: () => Selection;
	ed: HTMLDivElement;
	readonly build: (md: string) => void;
	readonly topOf: (n: Node | null) => HTMLElement | undefined;
	readonly words: WordsHost;
	readonly changed: () => void;
}

/** A paste into a card: plain words, read as markdown. */
export function createCardPaste(d: CardPasteNeeds) {
	function onPaste(event: ClipboardEvent) {
		const text = event.clipboardData?.getData("text/plain");
		if (!text) return;
		event.preventDefault();
		const r = d.sel().getRangeAt(0);
		r.deleteContents();
		if (/\n/.test(text)) {
			const holder = h("div");
			const saved = d.ed;
			d.ed = holder as HTMLDivElement;
			d.build(text);
			d.ed = saved;
			const at = d.topOf(r.startContainer);
			const frag = document.createDocumentFragment();
			for (const el of [...holder.children] as HTMLElement[]) {
				delete el.dataset.raw;
				frag.append(el);
			}
			if (at) at.after(frag);
			else d.ed.append(frag);
		} else {
			const holder = h("span");
			const first = cardMarked().lexer(text)[0] as Tokens.Paragraph | undefined;
			inline(d.words, holder, first?.tokens ?? [{ type: "text", raw: text, text } as Tokens.Text]);
			const nodes = [...holder.childNodes];
			for (const n of nodes.reverse()) r.insertNode(n);
		}
		d.changed();
	}

	return {
		onPaste,
	};
}
