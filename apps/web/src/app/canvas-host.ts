import { setCanvasHost } from "@decks/canvas/host";
import { deckBoardLink } from "../board/board-links.ts";
import { can } from "../connections/backend.ts";
import { deckFileUrl } from "../lib/api.ts";
import { stageOnScreen } from "../state/decks.ts";
import { viewOnly } from "../state/stages.ts";

/**
 * The Decks app's answers to the canvas's questions (`canvas/host.ts`): deck files from this
 * server (or the connection the tab is on), writes as the backend allows, and the links on a
 * drawing that name a board in this deck.
 */
setCanvasHost({
	fileUrl: (path, rev) => deckFileUrl(path, rev),
	// A friend's canvas shared with you to view is read here, and changed only in your own copy.
	canWrite: () => can("write") && !viewOnly(stageOnScreen()),
	boardLink: (href, base) => deckBoardLink(href, base),
});
