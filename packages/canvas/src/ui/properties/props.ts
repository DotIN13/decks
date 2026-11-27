import type { PenDocument } from "@decks/pen";

/** What the properties panel is given: the drawing, and where its edits and its exports go. */
export interface PropertiesProps {
	doc: PenDocument | undefined;
	onEdit: (ops: unknown[]) => void;
	/** Download a picture of these items, taken by the server (`server/canvas/shots.ts`). */
	onExport: (ids: string[]) => void;
}
