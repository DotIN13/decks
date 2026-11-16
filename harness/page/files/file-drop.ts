/* Files dragged in from outside the browser. */

/** Whether a drag is carrying files, as opposed to text or a component of its own. */
export function carriesFiles(transfer: DataTransfer | null): boolean {
	if (!transfer) return false;
	// `types` is the only thing readable during a drag — the files themselves are
	// withheld until the drop — so this is what "is this a file drag" has to be.
	return Array.from(transfer.types).includes("Files");
}

/**
 * Stop the app's own document from opening a dropped file, which would unload the app to show
 * it. Refused on the whole document, since "anywhere" includes the conversation and the gaps
 * between cards. The composer takes its own drops; `outside` gets the point and the files of
 * any other, enough to put them on the canvas where they landed.
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
