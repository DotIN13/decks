import { type FrameEnd } from "../protocol.ts";
import { life } from "./life.ts";
import { probes } from "../../base/debug.ts";
import { dismissMenus } from "@decks/ui";
import type { CardSlot } from "../protocol.ts";
import { drawing, inkSelection } from "../../ink/ink.ts";
import { penHolds } from "../../edit/pen-tools.ts";

/** What `listenToPage` reads of `wireFrame` (`events.ts`). */
export interface ListenToPageNeeds {
	readonly end: FrameEnd;
	readonly pageKeys?: readonly string[] | undefined;
	readonly pageKeysFirst?: readonly string[] | undefined;
	/** The page draws the tools, the pen tray among them. */
	readonly pageTools?: boolean | undefined;
}

/** What the frame hears from its own page: a file dropped on it, keys, and a press that closes the page's menus. */
export function listenToPage(d: ListenToPageNeeds) {
	/*
	 * Files dropped from outside the browser: never opened in place (a dropped file's default is to
	 * replace the page with it), but handed to the page, which uploads them into this canvas's folder
	 * and places them where they landed, as it does a drop of its own.
	 */
	const carries = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

	addEventListener("dragover", (event) => {
		if (!carries(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
	}, { signal: life() });

	addEventListener("drop", (event) => {
		if (!carries(event)) return;
		event.preventDefault();
		const at = { x: event.clientX, y: event.clientY };
		// Over a card they go into it, between its blocks where they land: only the canvas here knows what is under the point.
		const card = probes.cardAt?.(at.x, at.y) as CardSlot | undefined;
		const files = Array.from(event.dataTransfer?.files ?? []);
		void Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: await file.arrayBuffer() }))).then((read) =>
			d.end.call("upload", { files: read, at, ...(card ? { card } : {}) }, read.map((one) => one.bytes)).catch((error: unknown) => console.warn(error)),
		);
	}, { signal: life() });

	/*
	 * The keys the page's tools take ahead of the canvas's own (`pageKeysFirst`): heard first, passed on,
	 * and stopped here. Not held down, not with ⌘, ⌃ or ⌥, not typed into a field or words being edited,
	 * and not inside a card, whose keys are its own.
	 */
	addEventListener("keydown", (event) => {
		if (!d.pageKeysFirst?.length || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
		if (!d.pageKeysFirst.includes(event.key.toLowerCase()) && !d.pageKeysFirst.includes(`${event.shiftKey ? "shift+" : ""}${event.code}`)) return;
		const target = event.composedPath()[0];
		if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role=dialog], .card-host")) return;
		if (event.composedPath().some((one) => one instanceof Element && one.matches(".card-host, .card-surface"))) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		d.end.emit("keys", { key: event.key, code: event.code, meta: false, ctrl: false, alt: false, shift: event.shiftKey });
	}, { capture: true, signal: life() });

	/*
	 * While the pen is out and the page draws its tray, the tray's keys are the page's: Escape (let the
	 * lasso go, then put the pen away) and Delete on what the lasso holds. Heard first and passed on, as
	 * the tray heard them first when it stood in this document; nothing here acts on them as well.
	 */
	addEventListener("keydown", (event) => {
		if (!d.pageTools || !drawing() || event.metaKey || event.ctrlKey || event.altKey) return;
		const key = event.key.toLowerCase();
		if (key !== "escape" && !((key === "delete" || key === "backspace") && inkSelection())) return;
		const target = event.composedPath()[0];
		if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		d.end.emit("keys", { key: event.key, code: event.code, meta: false, ctrl: false, alt: false, shift: event.shiftKey });
	}, { capture: true, signal: life() });

	/*
	 * A popup of the page's tools that Escape shuts before anything else (the colour picker, `penHolds`):
	 * Escape pressed here shuts it there, and does nothing here, so what is selected stays selected.
	 */
	addEventListener("keydown", (event) => {
		if (!d.pageTools || event.key !== "Escape" || penHolds() === 0) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		d.end.emit("away", {});
	}, { capture: true, signal: life() });

	/*
	 * A shortcut the canvas did not take goes to the page, so the app's own keys work wherever the focus
	 * is: only one with a modifier, since a bare letter typed here is the canvas's or a card's.
	 */
	addEventListener("keydown", (event) => {
		const said = { key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey };
		if (event.metaKey || event.ctrlKey || event.altKey) {
			if (!event.defaultPrevented) d.end.emit("keys", said);
			return;
		}
		/*
		 * And the bare keys the page's own tools take, when the page draws the tools (`pageKeys`): not one
		 * held down, not one typed into a field or a card's words, and only if nothing here took it, which is
		 * known once every listener has heard it.
		 */
		if (!d.pageKeys?.includes(event.key.toLowerCase()) || event.repeat) return;
		const target = event.composedPath()[0];
		if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
		setTimeout(() => !event.defaultPrevented && d.end.emit("keys", said), 0);
	}, { signal: life() });

	/*
	 * A press or Escape here puts away the page's menus, which hear nothing from this document; and one
	 * there puts away this frame's (`@decks/ui` dismiss).
	 */
	addEventListener("pointerdown", () => d.end.emit("away", {}), { capture: true, signal: life() });

	addEventListener("keydown", (event) => event.key === "Escape" && d.end.emit("away", {}), { capture: true, signal: life() });

	d.end.on("away", () => dismissMenus());

}
