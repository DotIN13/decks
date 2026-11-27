import { type Drawing } from "../model/drawing.ts";
import type { Accessor } from "solid-js";
import { type PenDocument } from "@decks/pen";
import type { Page } from "@decks/protocol";
import { createComputed } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { pagesAhead, pagesOf } from "../model/drawing.ts";
import type { EditorOptions } from "./types.ts";

/** What `createEditorPages` reads of `createEditor` (`editor.tsx`). */
export interface EditorPagesNeeds {
	readonly options: EditorOptions;
	readonly doc: Accessor<PenDocument>;
	readonly drawing: Drawing;
}

/** The cards on the canvas as the view takes them: the host's list or the drawing's own, the same object for a card from one drawing to the next. */
export function createEditorPages(d: EditorPagesNeeds) {
	/*
	 * Owned by whoever makes the editor (the canvas frame's render root), never by
	 * an effect that runs again: made in Studio's effect once, the cards stopped following the
	 * drawing, so a card moved once and then stayed where the canvas last saw it.
	 */
	/*
	 * The same object for a card from one drawing to the next, its fields changed in place, as the
	 * Decks app's store keeps them: the canvas keys each card's slot on its object, and a fresh list
	 * on every edit rebuilt every slot and reloaded every card's page after any drag.
	 */
	const [pages, setPages] = createStore<Page[]>([]);

	/*
	 * A host's list may be a store of its own (the Decks app's): read whole here, every card and
	 * field, so this follows it; reconciling a store's proxy reads it untracked, and the cards would
	 * show only when something else happened to run this again.
	 */
	createComputed(() => {
		/*
		 * A host's list is its server's, which knows nothing of how an item frames its card: its corners
		 * and whether it draws its own outline are the drawing's, read here so a change shows at once.
		 */
		// By its path, or by its path's end: the host names a card from the deck, the drawing from its canvas (`items-layer.tsx` matches the same way).
		const framed = d.options.pages?.list ? pagesOf(d.doc()).filter((one) => one.corners || one.outlined) : [];
		const given = d.options.pages?.list
			? d.options.pages.list().map((card) => {
					const drawn = framed.find((one) => one.path === card.path) ?? framed.find((one) => card.path.endsWith(`/${one.path}`));
					const { corners: _c, outlined: _o, ...rest } = card;
					return { ...rest, ...(drawn?.corners ? { corners: drawn.corners } : {}), ...(drawn?.outlined ? { outlined: drawn.outlined } : {}) };
				})
			: pagesOf(d.doc());
		// The host's own list is its server's: a card the person moved, sized or took off is shown so until the server has it.
		setPages(reconcile(d.options.pages?.list && d.drawing.waiting() ? pagesAhead(given, d.drawing.given(), d.doc()) : given, { key: "path" }));
	});

	return { pages };
}
