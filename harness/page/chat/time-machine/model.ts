/** The four things you can do to a point in the conversation. */
export type Act = "preview" | "rewind" | "fork" | "restore";

/** One row of the menu: what it says, and what it does to the canvas or the conversation. */
export interface ActRow {
	act: Act;
	label: string;
	note: string;
}

/** The rows, in order. Restore sits behind a rule, because it is the one that writes to the cards. */
export function actRows(previewing: boolean): ActRow[] {
	return [
		{ act: "preview", label: previewing ? "Stop previewing" : "Preview", note: "Show the canvas as it was at this message. Nothing is written, and Escape puts it back." },
		{ act: "rewind", label: "Rewind to here", note: "Take back everything after it, and these words go back into the input bar." },
		{ act: "fork", label: "Fork from here", note: "Keep this history and start a second agent from this point." },
		{ act: "restore", label: "Restore", note: "Write the cards back to how they were here. The conversation stays where it is." },
	];
}

/** Preview pressed while this point is already shown puts the canvas back. */
export const previewTarget = (previewing: boolean, entryId: string): string | null => (previewing ? null : entryId);

/** Rewind and fork end any preview first; preview and restore do not. */
export const endsPreview = (act: Act): boolean => act === "rewind" || act === "fork";
