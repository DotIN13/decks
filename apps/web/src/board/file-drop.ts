/**
 * Files dragged in from outside the browser, landing on a board.
 *
 * This is the same problem `frame-gestures.ts` solves for wheels and pointers, and
 * the same answer: a board frame is a separate document, so a file dragged over a
 * board produces `dragover`/`drop` inside `frame.contentDocument` and *nothing* in
 * the app's document. No amount of listening in the parent will see one. Same
 * origin (DESIGN §4) makes the fix small — listen inside the frame, hand the files
 * to the app.
 *
 * Two things follow from that, one free and one dangerous.
 *
 * **The drop point needs no camera maths.** `clientX/clientY` on a drag event are
 * in the frame's own pixels, which are board pixels, because the stage's zoom is a
 * CSS transform on an ancestor and the frame's coordinate system knows nothing
 * about it — exactly as for the pointer events the editor uses. That *was* asserted
 * rather than assumed: `e2e/checks/file-drop.mjs` dropped at a known point and read
 * the `left`/`top` the server wrote. That check has been cut, so it is assumed now.
 *
 * **A paste is a drop with no cursor, and it lands here too.** Pasting an image was
 * the obvious sibling of dropping one and was listed as a known edge; it costs almost
 * nothing now that the plumbing exists, and on a phone it is not a nicety — a
 * screenshot is the commonest file anybody has and there is no desktop to drag it from.
 * The only thing a paste lacks is a point, so it uses the last place the board was
 * touched, falling back to the middle of it.
 *
 * **The app's own document must refuse the browser's default.** The default action
 * for a dropped file is to *navigate to it*, which would unload the SPA — socket,
 * camera, transcript and all — to show the file. So the parent swallows file drags
 * globally (`guardDocumentDrops`), not only where a board happens to be; a drop that
 * misses every board is answered with a sentence instead of a lost session.
 */

import { typingInto } from "./Editor.ts";

/** Whether a drag is carrying files, as opposed to text or a component of its own. */
export function carriesFiles(transfer: DataTransfer | null): boolean {
	if (!transfer) return false;
	// `types` is the only thing readable during a drag — the files themselves are
	// withheld until the drop — so this is what "is this a file drag" has to be.
	return Array.from(transfer.types).includes("Files");
}

export interface FileDropHost {
	/** Whether this board can take a drop; below `INTERACT_ZOOM` the frame is inert. */
	enabled(): boolean;
	/** Files landed on this board, at a point already in board coordinates. */
	drop(files: File[], at: { x: number; y: number }): void;
}

/**
 * Listen for a file drop inside one board's frame.
 *
 * The highlight is an element appended to the board's document and marked
 * `data-decks-ui`, the same contract the editor's handles keep: affordances live in
 * the board's DOM and never in the file.
 */
export function attachFrameDrop(frame: HTMLIFrameElement, host: FileDropHost): () => void {
	const doc = frame.contentDocument;
	const win = frame.contentWindow;
	if (!doc || !win) return () => {};

	const style = doc.createElement("style");
	style.dataset.decksUi = "true";
	style.textContent = `
		.decks-drop {
			position: fixed; inset: 0; z-index: 2147483100; pointer-events: none;
			display: flex; align-items: center; justify-content: center;
			border: 2px dashed var(--b-accent, #3b5cf6); border-radius: 10px;
			background: color-mix(in srgb, var(--b-accent, #3b5cf6) 10%, transparent);
			color: var(--b-fg, #161616);
			font: 600 15px/1.2 var(--b-sans, system-ui, sans-serif);
		}
		.decks-drop > span {
			padding: 6px 12px; border-radius: 999px;
			background: var(--b-bg, #fff); box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
		}
	`;
	doc.head.appendChild(style);

	const overlay = doc.createElement("div");
	overlay.className = "decks-drop";
	overlay.dataset.decksUi = "true";
	const label = doc.createElement("span");
	overlay.appendChild(label);

	/*
	 * Counted, not toggled. `dragenter` and `dragleave` fire per element the cursor
	 * crosses and both bubble here, so a drag moving over a card inside the board
	 * produces a leave for the body in the middle of the drag — a boolean flag makes
	 * the highlight strobe as the cursor crosses components.
	 */
	let depth = 0;

	const show = (count: number) => {
		label.textContent = count > 1 ? `Drop ${count} files here` : "Drop file here";
		if (!overlay.isConnected) doc.body.appendChild(overlay);
	};
	const hide = () => {
		depth = 0;
		overlay.remove();
	};

	const countOf = (transfer: DataTransfer | null) =>
		transfer ? Math.max(1, Array.from(transfer.items).filter((item) => item.kind === "file").length) : 1;

	const onDragEnter = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer) || !host.enabled()) return;
		event.preventDefault();
		depth += 1;
		show(countOf(event.dataTransfer));
	};

	const onDragOver = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer) || !host.enabled()) return;
		// Both lines are load-bearing: without `preventDefault` on *dragover* the drop
		// never happens at all, and `dropEffect` is what makes the cursor say "copy"
		// rather than "move" — the file stays where it was and a copy comes in.
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		if (depth === 0) show(countOf(event.dataTransfer));
	};

	const onDragLeave = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer)) return;
		depth = Math.max(0, depth - 1);
		if (depth === 0) hide();
	};

	const onDrop = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		hide();
		if (!host.enabled()) return;
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length === 0) return;
		// `scrollX/Y` for the same reason the editor's insert adds them: a board taller
		// than its frame can be scrolled inside it, and the component belongs where the
		// cursor was on the *board*.
		host.drop(files, { x: event.clientX + win.scrollX, y: event.clientY + win.scrollY });
	};

	/**
	 * Where this board was last touched, for a paste to land on.
	 *
	 * A drop carries `clientX/clientY` and a paste carries nothing at all, so the point
	 * has to come from somewhere — and the last tap is both the most recent thing the
	 * user pointed at and, on a touchscreen, how they selected the board in the first
	 * place. The middle of the board is the fallback, which is what a paste onto a board
	 * nobody has touched yet means.
	 */
	let lastTouched: { x: number; y: number } | undefined;
	const onPointerDown = (event: PointerEvent) => {
		lastTouched = { x: event.clientX + win.scrollX, y: event.clientY + win.scrollY };
	};

	const onPaste = (event: ClipboardEvent) => {
		// Somebody typing over a run of text, or into a source editor, owns their clipboard.
		if (typingInto(event.target)) return;
		const files = Array.from(event.clipboardData?.files ?? []);
		if (files.length === 0 || !host.enabled()) return;
		event.preventDefault();
		host.drop(files, lastTouched ?? { x: win.innerWidth / 2, y: win.innerHeight / 2 });
	};

	doc.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
	doc.addEventListener("paste", onPaste);
	doc.addEventListener("dragenter", onDragEnter);
	doc.addEventListener("dragover", onDragOver);
	doc.addEventListener("dragleave", onDragLeave);
	doc.addEventListener("drop", onDrop);
	// A drag that ends outside the frame — cancelled with Escape, or dropped on the
	// desktop — never sends a leave for the last element, so the highlight would stay.
	win.addEventListener("dragend", hide);
	win.addEventListener("blur", hide);

	return () => {
		doc.removeEventListener("pointerdown", onPointerDown, true);
		doc.removeEventListener("paste", onPaste);
		doc.removeEventListener("dragenter", onDragEnter);
		doc.removeEventListener("dragover", onDragOver);
		doc.removeEventListener("dragleave", onDragLeave);
		doc.removeEventListener("drop", onDrop);
		win.removeEventListener("dragend", hide);
		win.removeEventListener("blur", hide);
		overlay.remove();
		style.remove();
	};
}

/**
 * Stop the app's own document from opening a dropped file.
 *
 * The browser's default for a file dropped anywhere is to navigate to it, which
 * unloads the SPA — the socket, the camera, the transcript, all of it — to show a
 * PNG. That has to be refused globally rather than over the boards, because
 * "anywhere" includes the conversation, the rail and the gap between boards.
 *
 * A drop that reaches here missed every board, since a drop over a live frame is
 * consumed inside that frame's document — and missed the composer, which takes its own.
 * So this is where a file dropped on the canvas is answered, and `outside` gets the point
 * and the files, which is enough to make a board for them where they landed.
 */
export function guardDocumentDrops(target: Document, outside: (at: { x: number; y: number }, files: File[]) => void): () => void {
	const onDragOver = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
	};
	const onDrop = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		outside({ x: event.clientX, y: event.clientY }, Array.from(event.dataTransfer?.files ?? []));
	};
	target.addEventListener("dragover", onDragOver);
	target.addEventListener("drop", onDrop);
	return () => {
		target.removeEventListener("dragover", onDragOver);
		target.removeEventListener("drop", onDrop);
	};
}

export { flow, HEAD_PX, isImage, naturalSize, shapeFor } from "@decks/canvas/tools";
