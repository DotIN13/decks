import { setCanvasHost } from "@decks/canvas/host.ts";
import { deckBoardLink } from "../board/board-links.ts";
import { can } from "../connections/backend.ts";
import { deckFileUrl } from "../lib/api.ts";

/**
 * The Decks app's answers to the canvas's questions (`canvas/host.ts`): deck files from this
 * server (or the connection the tab is on), writes as the backend allows, and the links on a
 * drawing that name a board in this deck.
 */
setCanvasHost({
	fileUrl: (path, rev) => deckFileUrl(path, rev),
	canWrite: () => can("write"),
	boardLink: (href, base) => deckBoardLink(href, base),
});
