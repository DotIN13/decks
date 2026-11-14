import { defineFeature, type Deck, type Feature } from "../kernel/index.ts";
import { drawingRoute } from "./drawing.ts";
import { lineRoute } from "./line.ts";

// Today's names, answered from this one folder: the old line and the old drawing route.

export function compatFeature(): Feature {
	let deck: Deck | undefined;
	const deckNow = () => {
		if (!deck) throw new Error("compat has not started");
		return deck;
	};
	return defineFeature({
		name: "compat",
		calls: [],
		routes: [lineRoute(deckNow), drawingRoute(deckNow)],
		start(kernel) {
			deck = kernel.deck;
		},
	});
}
