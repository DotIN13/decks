import { defineFeature, type Deck, type Feature } from "../kernel/index.ts";
import { translate } from "./args.ts";
import { deckRoute } from "./deck.ts";
import { drawingRoute } from "./drawing.ts";
import { lineRoute } from "./line.ts";
import { pictureRoutes } from "./pictures.ts";
import { tabRoute } from "./tab.ts";

// Today's names, answered from this one folder: the old line, the old drawing and tile routes.

export function compatFeature(): Feature {
	let deck: Deck | undefined;
	let url: () => string | undefined = () => undefined;
	const deckNow = () => {
		if (!deck) throw new Error("compat has not started");
		return deck;
	};
	return defineFeature({
		name: "compat",
		calls: [],
		routes: [lineRoute(deckNow), drawingRoute(deckNow), ...pictureRoutes(() => url()), tabRoute(deckNow), deckRoute(deckNow)],
		start(kernel) {
			deck = kernel.deck;
			url = () => kernel.url();
			kernel.translate(translate);
		},
	});
}
