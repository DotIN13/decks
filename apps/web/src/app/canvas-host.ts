import { setCanvasHost } from "@decks/canvas/host";
import { connect } from "@decks/sdk";
import { boardTokens } from "../board/board-token.ts";
import { deckAddress } from "../state/decks.ts";
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
	/*
	 * A card's `card.decks` call, on a canvas this page holds itself: made with the card's own token, as
	 * that card, so the harness asks you once whether it may (`verbs/router.ts`). In the canvas frame
	 * the frame answers instead (`@decks/canvas`, `frame/card-calls.ts`).
	 */
	cardCall: async (verb, args, card) => {
		const token = await boardTokens.token(card, stageOnScreen());
		if (!token) throw new Error(`${card} has no token here, so it makes no calls.`);
		const answer = await connect({ url: deckAddress(), notes: () => {}, headers: { authorization: `Bearer ${token}` } }).call(verb, args);
		return answer.value;
	},
});
