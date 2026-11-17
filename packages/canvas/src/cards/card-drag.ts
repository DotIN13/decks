import type { CardEditorProps } from "./card-editor-props.ts";

/** What `createCardDrag` reads of the editor (`CardEditor.tsx`). */
export interface CardDragNeeds {
	readonly wrap: HTMLDivElement;
	readonly props: CardEditorProps;
	readonly caret: HTMLDivElement;
	readonly line: HTMLDivElement;
	readonly ed: HTMLDivElement;
	readonly closeMenus: () => void;
	readonly sel: () => Selection;
	readonly changed: () => void;
}

/** A piece of the card that drags: a whole-line piece between lines, an in-line one into a sentence, with a ghost and a mark where it will land. */
export function createCardDrag(d: CardDragNeeds) {
	/* ---------- pieces that drag ---------- */

	let dragging: HTMLElement | undefined;

	let ghost: HTMLElement | undefined;

	let press: { it: HTMLElement; x: number; y: number; id: number } | undefined;

	let target: { kind: "line"; before: Element | null } | { kind: "text"; range: Range } | undefined;

	const local = (x: number, y: number) => {
		const w = d.wrap.getBoundingClientRect();
		return { x: (x - w.left) / d.props.zoom, y: (y - w.top) / d.props.zoom };
	};

	function hideMarks() {
		d.caret.style.display = d.line.style.display = "none";
	}

	function lineSlot(y: number) {
		const kids = [...d.ed.children].filter((k) => k !== dragging);
		let i = kids.findIndex((k) => {
			const r = k.getBoundingClientRect();
			return y < r.top + r.height / 2;
		});
		if (i < 0) i = kids.length;
		const er = d.ed.getBoundingClientRect();
		const at = !kids.length
			? er.top + 8
			: i === 0
				? kids[0]!.getBoundingClientRect().top - 3
				: i === kids.length
					? kids[i - 1]!.getBoundingClientRect().bottom + 3
					: (kids[i - 1]!.getBoundingClientRect().bottom + kids[i]!.getBoundingClientRect().top) / 2;
		const p = local(er.left, at);
		d.line.style.display = "block";
		d.line.style.left = `${p.x}px`;
		d.line.style.top = `${p.y - 1.5 / d.props.zoom}px`;
		d.line.style.width = `${er.width / d.props.zoom}px`;
		d.line.style.height = `${3 / d.props.zoom}px`;
		target = { kind: "line", before: kids[i] ?? null };
	}

	function textSlot(x: number, y: number) {
		const r = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y);
		const n = r && (r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement);
		if (!r || !n || !d.ed.contains(n) || n === d.ed || n.closest(".pce-piece, .pce-sug, .pce-atom, pre") || dragging!.contains(n)) return;
		const rect = r.getClientRects()[0] ?? n.getBoundingClientRect();
		const p = local(rect.left, rect.top);
		d.caret.style.display = "block";
		d.caret.style.left = `${p.x - 1 / d.props.zoom}px`;
		d.caret.style.top = `${p.y}px`;
		d.caret.style.width = `${2 / d.props.zoom}px`;
		d.caret.style.height = `${Math.max(16, rect.height) / d.props.zoom}px`;
		target = { kind: "text", range: r };
	}

	function onPointerDown(event: PointerEvent) {
		// A press on a suggestion's buttons or a check keeps the caret where it is, a finger's too: a
		// finger's press would otherwise take the focus away, and that saves the card and closes it.
		if ((event.target as Element).closest(".pce-sug button, .pce-check")) {
			event.preventDefault();
			return;
		}
		const it = (event.target as Element).closest(".pce-piece") as HTMLElement | null;
		if (!it || event.button !== 0 || !d.ed.contains(it)) return;
		event.preventDefault();
		event.stopPropagation();
		press = { it, x: event.clientX, y: event.clientY, id: event.pointerId };
	}

	function onPointerMove(event: PointerEvent) {
		if (!press || event.pointerId !== press.id) return;
		if (!dragging) {
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 4) return;
			dragging = press.it;
			ghost = dragging.cloneNode(true) as HTMLElement;
			ghost.className += " pce-ghost";
			d.wrap.append(ghost);
			dragging.classList.add("pce-dragging");
			d.closeMenus();
			d.sel().removeAllRanges();
		}
		const p = local(event.clientX, event.clientY);
		// Below and right of the pointer, so the mark where it lands stays in view.
		ghost!.style.left = `${p.x + 12 / d.props.zoom}px`;
		ghost!.style.top = `${p.y + 12 / d.props.zoom}px`;
		hideMarks();
		target = undefined;
		const over = document.elementFromPoint(event.clientX, event.clientY);
		if (over && d.ed.contains(over)) {
			if (dragging.classList.contains("pce-block")) lineSlot(event.clientY);
			else textSlot(event.clientX, event.clientY);
		}
	}

	function endDrag(cancel: boolean) {
		const el = dragging;
		press = undefined;
		if (!el) return;
		dragging = undefined;
		hideMarks();
		ghost?.remove();
		ghost = undefined;
		el.classList.remove("pce-dragging");
		if (cancel || !target) return;
		const from = el.parentElement;
		// Taking a piece out of a sentence leaves one space, not two.
		const prev = el.previousSibling;
		const next = el.nextSibling;
		if (prev?.nodeType === 3 && next?.nodeType === 3 && /\s$/.test(prev.textContent ?? "") && /^\s/.test(next.textContent ?? "")) next.textContent = (next.textContent ?? "").replace(/^\s+/, "");
		if (target.kind === "line") d.ed.insertBefore(el, target.before);
		else {
			const r = target.range;
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
		if (from && from !== d.ed && from.parentElement === d.ed && !from.textContent?.replace(/​/g, "").trim() && !from.querySelector(".pce-piece, .pce-check")) from.remove();
		target = undefined;
		d.changed();
	}

	return {
		get dragging() {
			return dragging;
		},
		set dragging(next) {
			dragging = next;
		},
		endDrag,
		onPointerMove,
		onPointerDown,
	};
}
