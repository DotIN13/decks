import { reconcile } from "solid-js/store";
import { setState, state } from "../../state/deck.ts";
import { notice } from "../../state/notices.ts";
import { send } from "../../state/socket.ts";
import { watchedBeingNamed } from "../watching.ts";
import { receiveCanvasChanged } from "../../state/pens.ts";
import { receiveStages } from "../../state/canvases.ts";
import type { FrameHooks, Of } from "../socket-messages.ts";

/**
 * What changed in the deck: the deck itself, one of its cards, a document made for a drop, a canvas's
 * drawing, and the list of canvases.
 */
export function heardDeck(message: Of<"deck"> | Of<"card"> | Of<"doc"> | Of<"canvas">, hooks: FrameHooks): void {
	switch (message.type) {
		case "deck.changed":
			setState("deck", message.deck);
			/*
			 * Reconciled by path, not replaced.
			 *
			 * A board row owns a live iframe, and Solid re-creates a row whose item
			 * is a new object — so assigning a fresh array reloaded every board on
			 * screen. That is what "moving a board refreshes the page" was: a drag
			 * writes deck.json, the watcher reports it, and the whole deck arrived
			 * as new objects. `reconcile` keyed on the path updates the boards that
			 * changed and leaves the rest — and their documents — alone.
			 */
			setState("pages", reconcile(message.deck.boards, { key: "path", merge: false }));
			hooks.landed();
			return;
		case "card.changed": {
			if (message.removed) {
				setState("pages", (boards) => boards.filter((board) => board.path !== message.path));
				return;
			}
			if (!message.card) return;
			const board = message.card;
			/*
			 * An agent named this board while its own stage was the one on screen: it was watched
			 * being written, so it is not news. Reading it is how the browser says so, and the read
			 * stamp is the server's, so the mark clears on every device signed in.
			 */
			if (watchedBeingNamed(board, { focused: state.focused })) {
				send({ type: "card.seen", path: board.path });
			}
			// Merged into the existing row so its frame survives; only a board that
			// is genuinely new grows the array.
			//
			// `reconcile` with `merge` rather than a plain assignment: `CanvasView` renders
			// the boards with `<For>`, which keys by reference, so replacing the object
			// at this index makes the row new — and re-creating a row re-creates its
			// iframe, which reloads the document. That is a full white-flash reload of
			// the board on screen, on every change to the deck, showing the very
			// bytes the live DOM already has. Merging leaves the identity alone and
			// updates only the fields that moved.
			const index = state.pages.findIndex((existing) => existing.path === board.path);
			if (index === -1) {
				setState("pages", (boards) => [...boards, board].sort((a, b) => a.path.localeCompare(b.path)));
			} else {
				setState("pages", index, reconcile(board, { merge: true }));
			}
			return;
		}
		case "doc.created":
			hooks.hearCreated(message.request, message.path);
			return;

		case "canvas.changed":
			receiveCanvasChanged(message);
			if (message.doc && message.error) notice("warn", message.error);
			return;

		// What stages there are, and who is on them: the manager's whole list.
		case "canvas.list":
			receiveStages(message);
			return;
		default:
			return;
	}
}
