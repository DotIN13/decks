import { type FrameEnd } from "../protocol.ts";
import { life } from "./life.ts";
import { probes } from "../../base/debug.ts";
import { dismissMenus } from "@decks/ui";
import type { CardSlot } from "../protocol.ts";

/** What `listenToPage` reads of `wireFrame` (`events.ts`). */
export interface ListenToPageNeeds {
	readonly end: FrameEnd;
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
		// Over a card they go into it, between its blocks where they land: only the stage here knows what is under the point.
		const card = probes.cardAt?.(at.x, at.y) as CardSlot | undefined;
		const files = Array.from(event.dataTransfer?.files ?? []);
		void Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: await file.arrayBuffer() }))).then((read) =>
			d.end.call("upload", { files: read, at, ...(card ? { card } : {}) }, read.map((one) => one.bytes)).catch((error: unknown) => console.warn(error)),
		);
	}, { signal: life() });

	/*
	 * A shortcut the canvas did not take goes to the page, so the app's own keys work wherever the focus
	 * is: only one with a modifier, since a bare letter typed here is the canvas's or a card's.
	 */
	addEventListener("keydown", (event) => {
		if (event.defaultPrevented || !(event.metaKey || event.ctrlKey || event.altKey)) return;
		d.end.emit("keys", { key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
	}, { signal: life() });

	/*
	 * A press or Escape here puts away the page's menus, which hear nothing from this document; and one
	 * there puts away this frame's (`@decks/ui` dismiss).
	 */
	addEventListener("pointerdown", () => d.end.emit("away", {}), { capture: true, signal: life() });

	addEventListener("keydown", (event) => event.key === "Escape" && d.end.emit("away", {}), { capture: true, signal: life() });

	d.end.on("away", () => dismissMenus());

}
