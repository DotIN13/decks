// Today's names, answered from this one folder: the old line, the old drawing and tile routes.
import { defineFeature, type Deck, type Feature, type Route } from "../kernel/index.ts";
import { translate } from "./args.ts";
import { appOpenRoutes } from "./apps.ts";
import { deckRoute } from "./deck.ts";
import { drawingRoute } from "./drawing.ts";
import { uploadRoute, whereRoute } from "./files.ts";
import { lineRoute } from "./line.ts";
import { pictureRoutes } from "./pictures.ts";
import { tabRoute } from "./tab.ts";

/** leave: route prefixes the host serves itself (Studio its own /api/upload, which checks an edit role). */
export type CompatOptions = { leave?: string[] };

export function compatFeature(options: CompatOptions = {}): Feature {
	let deck: Deck | undefined;
	let url: () => string | undefined = () => undefined;
	let folder: () => string | undefined = () => undefined;
	const deckNow = () => {
		if (!deck) throw new Error("compat has not started");
		return deck;
	};
	return defineFeature({
		name: "compat",
		calls: [],
		routes: ([lineRoute(deckNow, () => url()), drawingRoute(deckNow), ...pictureRoutes(() => url()), tabRoute(deckNow), deckRoute(deckNow, () => folder()), uploadRoute, whereRoute, ...appOpenRoutes(() => url())] as Route[]).filter((route) => !options.leave?.includes(route.prefix)),
		start(kernel) {
			deck = kernel.deck;
			url = () => kernel.url();
			folder = () => kernel.folder();
			kernel.translate(translate);
		},
	});
}
