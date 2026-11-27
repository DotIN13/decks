import type { Setter } from "solid-js";
import type { Camera } from "@decks/protocol";
import { onCleanup } from "solid-js";
import { boxOf, zoomAbout, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { zoomKey } from "../camera/zoom-keys.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `listenKeys` reads of `createViewInput` (`input.ts`), each read when it is used. */
export interface ListenKeysNeeds {
	readonly pushCamera: (cam: Camera) => void;
	readonly frame: (boxes: Array<{ x: number; y: number; w: number; h: number; }>) => Camera;
	readonly props: CanvasViewProps;
	readonly ctl: CameraController;
	readonly view: () => Viewport;
	readonly centre: () => { x: number; y: number; };
	readonly editor: CanvasEditor;
	readonly setSpaceHeld: Setter<boolean>;
	readonly shortcut: (key: string) => boolean;
}

export function listenKeys(d: ListenKeysNeeds) {
	const keydown = (event: KeyboardEvent) => {
		/*
		 * ⌘+ / ⌘− / ⌘0, before every other guard in this function.
		 *
		 * Above the typing check as well as the modifier one, because these mean the same
		 * thing wherever the caret is: they do nothing useful in a text field, and the
		 * caret is in the composer most of the time — a zoom that stopped working as soon
		 * as you clicked the input would be the bug in a smaller costume.
		 *
		 * These are the one place a person's habit and the browser's collide. On a canvas
		 * ⌘+ means "zoom in"; Chrome hears "make the page bigger", which enlarges the whole
		 * app — chat column, chrome and all — and leaves the camera exactly where it was.
		 * So they are taken here and the browser's page zoom is declined.
		 *
		 * `zoom-keys.ts` decides which keystroke this is, because the answer is not the
		 * obvious one: the key labelled `+` is `=` unshifted, so matching `"+"` misses
		 * every press that is not on the numpad.
		 */
		const zoom = zoomKey(event);
		if (zoom) {
			if (zoom === "fit") d.pushCamera(d.frame(d.props.cards.map(boxOf)));
			else d.pushCamera(zoomAbout(d.ctl.now(), d.view(), d.centre(), zoom === "in" ? 1.2 : 1 / 1.2));
			event.preventDefault();
			return;
		}
		const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
		if (typing) return;
		/*
		 * The drawing's own keys, in either mode but not while drawing. None of them fire while a text box has the caret
		 * (above). Delete, the arrows and ⌘D act on what is selected; ⌘Z and ⇧⌘Z step through the
		 * person's own edits; Escape lets go, then puts the tool down; a letter arms a tool
		 * (`PEN_TOOL_KEYS`), from this document only.
		 */
		if (d.editor.key(event)) {
			event.preventDefault();
			return;
		}
		/*
		 * A key with a modifier on it is not one of ours.
		 *
		 * Every shortcut here is a bare key — `V S C T E` for the tools, `0 1 + -` for
		 * the camera — and none of them wanted a modifier. Without this check the letters
		 * matched anyway, so **⌘C stopped copying**: `event.key` is `"c"` whatever else is
		 * held, so a copy switched the tool to *card* and then `preventDefault()` cancelled
		 * the clipboard. Selecting a line of a reply and copying it did nothing at all, and
		 * ⌘V, ⌘S, ⌘E and ⌘0 were quietly taken the same way. Space is inside the guard
		 * too, because ⌘Space belongs to the OS.
		 */
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.code === "Space") {
			d.setSpaceHeld(true);
			event.preventDefault();
			return;
		}
		if (d.shortcut(event.key)) event.preventDefault();
	};

	const keyup = (event: KeyboardEvent) => {
		if (event.code === "Space") d.setSpaceHeld(false);
	};

	addEventListener("keydown", keydown);

	addEventListener("keyup", keyup);

	onCleanup(() => {
		removeEventListener("keydown", keydown);
		removeEventListener("keyup", keyup);
	});

}
