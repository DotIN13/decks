import { events, layout } from "../../protocol/index.ts";
import { defineFeature, type Feature, type Kernel } from "../kernel/types.ts";
import { cardCalls, fileCalls } from "./calls.ts";
import { cardKind } from "./item.ts";
import { syncLib, type LibSource } from "./lib.ts";
import { routes } from "./page.ts";

// The cards feature: every file in the deck, cards, a card's page, lib/.

export type CardsOptions = { lib?: LibSource };

/** Cards and files. lib is where this build's card runtime is read from. */
export function cards(options: CardsOptions = {}): Feature {
	let kernel: Kernel | undefined;
	return defineFeature({
		name: "cards",
		calls: [...fileCalls, ...cardCalls(() => kernel)],
		items: [cardKind],
		routes,
		async start(given) {
			kernel = given;
			if (options.lib) await syncLib(options.lib, given.deck);
			// A write to any file in a card's folder is news about the card.
			return given.deck.watch((change) => {
				const card = layout.cardOf(change.path);
				if (!card) return;
				const removed = change.kind === "deleted" && change.path === card;
				given.events.emit(events.cardChanged, { canvas: layout.canvasOfPath(card)?.name ?? "", ids: [card], by: change.by, rev: change.rev, ...(removed ? { removed } : {}) });
			});
		},
	});
}

export default cards();
