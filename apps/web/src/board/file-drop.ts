/**
 * Files dragged in from outside the browser.
 *
 * **The app's own document must refuse the browser's default.** The default action for a
 * dropped file is to *navigate to it*, which would unload the SPA — socket, camera, transcript
 * and all — to show the file. So the app swallows file drags globally (`guardDocumentDrops`),
 * not only over the canvas. A drop over a board's page arrives here too: the page hands it back
 * and the canvas replays it on the board's frame (`embed-guest.js`, `plain-board.tsx`), because
 * nothing is ever dropped into a board.
 */

/** Whether a drag is carrying files, as opposed to text or a component of its own. */
export function carriesFiles(transfer: DataTransfer | null): boolean {
	if (!transfer) return false;
	// `types` is the only thing readable during a drag — the files themselves are
	// withheld until the drop — so this is what "is this a file drag" has to be.
	return Array.from(transfer.types).includes("Files");
}

/**
 * Stop the app's own document from opening a dropped file.
 *
 * The browser's default for a file dropped anywhere is to navigate to it, which
 * unloads the SPA — the socket, the camera, the transcript, all of it — to show a
 * PNG. That has to be refused globally rather than over the boards, because
 * "anywhere" includes the conversation, the rail and the gap between boards.
 *
 * A drop over a board's page is replayed on its frame and arrives here too; the composer
 * takes its own. So this is where a file dropped on the canvas is answered, and `outside` gets the point
 * and the files, which is enough to put them on the canvas where they landed.
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

export { naturalSize } from "@decks/canvas/tools";
