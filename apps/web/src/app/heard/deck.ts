import { reconcile } from "solid-js/store";
import { setState, state } from "../../state/deck.ts";
import { notice } from "../../state/notices.ts";
import { send } from "../../state/socket.ts";
import { watchedBeingNamed } from "../watching.ts";
import { receiveCanvasChanged } from "../../state/pens.ts";
import { receiveCanvases } from "../../state/canvases.ts";
import type { FrameHooks, Of } from "../socket-messages.ts";
import { heardAppReload } from "../../tabs/kinds/app.tsx";

/**
 * What changed in the deck: the deck itself, one of its cards, a document made for a drop, a canvas's
 * drawing, the list of canvases, and an app told to load again.
 */
export function heardDeck(message: Of<"deck"> | Of<"card"> | Of<"doc"> | Of<"canvas"> | Of<"app">, hooks: FrameHooks): void {
	switch (message.type) {
		// An app's pages are to load again: its tab here does (its windows on a canvas hear it in their frame).
		case "app.changed":
			if (message.reload !== undefined) heardAppReload(message.name, message.reload);
			return;
		case "deck.changed":
			setState("deck", message.deck);
			/*
			 * Reconciled by path, not replaced.
			 *
			 * A card row owns a live iframe, and Solid re-creates a row whose item
			 * is a new object — so assigning a fresh array reloaded every card on
			 * screen. That is what "moving a card refreshes the page" was: a drag
			 * writes deck.json, the watcher reports it, and the whole deck arrived
			 * as new objects. `reconcile` keyed on the path updates the cards that
			 * changed and leaves the rest — and their documents — alone.
			 */
			setState("pages", reconcile(message.deck.boards, { key: "path", merge: false }));
			hooks.landed();
			return;
		case "card.changed": {
			if (message.removed) {
				setState("pages", (cards) => cards.filter((card) => card.path !== message.path));
				return;
			}
			if (!message.card) return;
			const card = message.card;
			/*
			 * An agent named this card while its own canvas was the one on screen: it was watched
			 * being written, so it is not news. Reading it is how the browser says so, and the read
			 * stamp is the server's, so the mark clears on every device signed in.
			 */
			if (watchedBeingNamed(card, { focused: state.focused })) {
				send({ type: "card.seen", path: card.path });
			}
			// Merged into the existing row so its frame survives; only a card that
			// is genuinely new grows the array.
			//
			// `reconcile` with `merge` rather than a plain assignment: `CanvasView` renders
			// the cards with `<For>`, which keys by reference, so replacing the object
			// at this index makes the row new — and re-creating a row re-creates its
			// iframe, which reloads the document. That is a full white-flash reload of
			// the card on screen, on every change to the deck, showing the very
			// bytes the live DOM already has. Merging leaves the identity alone and
			// updates only the fields that moved.
			const index = state.pages.findIndex((existing) => existing.path === card.path);
			if (index === -1) {
				setState("pages", (cards) => [...cards, card].sort((a, b) => a.path.localeCompare(b.path)));
			} else {
				setState("pages", index, reconcile(card, { merge: true }));
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

		// What canvases there are, and who is on them: the manager's whole list.
		case "canvas.list":
			receiveCanvases(message);
			return;
		default:
			return;
	}
}
