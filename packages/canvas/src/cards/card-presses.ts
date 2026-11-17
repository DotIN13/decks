import { h } from "./card-words.ts";

/** What `createCardPresses` reads of the editor (`CardEditor.tsx`). */
export interface CardPressesNeeds {
	readonly changed: () => void;
	readonly ed: HTMLDivElement;
}

/** Presses inside the card: a check ticked, a suggestion taken or refused, a raw box opened as text. */
export function createCardPresses(d: CardPressesNeeds) {
	/* ---------- presses inside: checks, suggestions, raw boxes ---------- */

	function onClick(event: MouseEvent) {
		const t = event.target as HTMLElement;
		if (t.classList.contains("pce-check")) {
			t.toggleAttribute("data-on");
			return d.changed();
		}
		const sug = t.closest(".pce-sug") as HTMLElement | null;
		if (sug && (t.closest("[data-accept]") || t.closest("[data-reject]"))) {
			const keep = t.closest("[data-accept]") ? sug.querySelector("ins")?.textContent : sug.querySelector("del")?.textContent;
			sug.replaceWith(document.createTextNode(keep ?? ""));
			return d.changed();
		}
	}

	function onDblClick(event: MouseEvent) {
		const raw = (event.target as HTMLElement).closest(".pce-raw") as HTMLElement | null;
		if (!raw || raw.tagName !== "DIV" || raw.parentElement !== d.ed) return;
		const box = h("pre", { class: "pce-rawedit", contenteditable: "true", "data-sep": raw.dataset.sep ?? "\n\n" }, raw.dataset.raw ?? "");
		raw.replaceWith(box);
		box.focus({ preventScroll: true });
		d.changed();
	}

	return {
		onClick,
		onDblClick,
	};
}
