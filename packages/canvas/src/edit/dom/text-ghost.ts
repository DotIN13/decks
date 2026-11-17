import { onCleanup } from "solid-js";
import { type TextHost } from "./TextEditing.tsx";

/** What `createTextGhost` reads of `createTextEditing` (`TextEditing.tsx`). */
export interface TextGhostNeeds {
	readonly host: TextHost;
}

/** The editor's still copy, left over the words from the moment it closes until the canvas draws what was typed. */
export function createTextGhost(d: TextGhostNeeds) {
	/*
	 * A still copy of the editor, left where the editor was when the typing was put away, until the
	 * canvas has a frame with the words in it. Without it the words were gone for two or three frames:
	 * the editor was taken away at once, and the canvas, which leaves the words out while they are
	 * the editor's, drew them only once the server's answer had been laid out.
	 */
	let editorGhost: HTMLElement | undefined;

	/** The copy goes with the first frame painted after the canvas heard it may draw the words (`render/engine.ts`, `mark`). */
	let ghostUntil: number | undefined;

	const leaveGhost = () => {
		dropGhost();
		const live = d.host.world()?.querySelector<HTMLElement>(":scope > .pen-text");
		if (!live) return;
		const copy = live.cloneNode(true) as HTMLElement;
		if (live instanceof HTMLTextAreaElement) (copy as HTMLTextAreaElement).value = live.value;
		// Only the words and what holds them: not the card's style bar, the caret, or the focus ring.
		for (const extra of copy.querySelectorAll(".pce-bar, [data-editorGhost-skip]")) extra.remove();
		copy.removeAttribute("id");
		copy.setAttribute("aria-hidden", "true");
		copy.setAttribute("tabindex", "-1");
		copy.querySelectorAll("[contenteditable]").forEach((el) => el.setAttribute("contenteditable", "false"));
		if (copy.hasAttribute("contenteditable")) copy.setAttribute("contenteditable", "false");
		copy.style.pointerEvents = "none";
		copy.style.boxShadow = "none";
		copy.style.caretColor = "transparent";
		copy.classList.add("pen-editorGhost");
		live.after(copy);
		editorGhost = copy;
		ghostUntil = undefined;
		// Never left standing: a sheet that paints nothing for a second has had its chance.
		const left = copy;
		setTimeout(() => {
			if (editorGhost === left && ghostUntil !== undefined) dropGhost();
		}, 1000);
	};

	const dropGhost = () => {
		editorGhost?.remove();
		editorGhost = undefined;
		ghostUntil = undefined;
	};

	onCleanup(dropGhost);

	return {
		get editorGhost() {
			return editorGhost;
		},
		set editorGhost(next) {
			editorGhost = next;
		},
		get ghostUntil() {
			return ghostUntil;
		},
		set ghostUntil(next) {
			ghostUntil = next;
		},
		leaveGhost,
		dropGhost,
	};
}
