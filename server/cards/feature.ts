import { events, layout } from "../../protocol/index.ts";
import { defineFeature, type Feature, type FileChange, type Kernel } from "../kernel/types.ts";
import { cardCalls, fileCalls } from "./calls.ts";
import { cardKindWith } from "./prepare.ts";
import { followSizes } from "./resize.ts";
import { syncLib, type LibSource } from "./lib.ts";
import { filesRoutes } from "./page.ts";
import { upgradeNews } from "./upgrade/news.ts";

// The cards feature: every file in the deck, cards, a card's page, lib/.

export type CardsOptions = { lib?: LibSource };

/** Cards and files. lib is where this build's card runtime is read from. */
export function cards(options: CardsOptions = {}): Feature {
	let kernel: Kernel | undefined;
	return defineFeature({
		name: "cards",
		calls: [...fileCalls, ...cardCalls(() => kernel)],
		items: [cardKindWith(() => kernel?.deck)],
		routes: filesRoutes((canvas) => placedPaths(kernel, canvas)),
		// A deck from today keeps its cards' bylines and what the person has read (upgrade/news.ts).
		upgrade: (deck, _version, parts) => upgradeNews(deck, parts),
		async start(given) {
			kernel = given;
			if (options.lib) await syncLib(options.lib, given.deck);
			const sizes = followSizes(given);
			// A write to any file in a card's folder is news about the card.
			const files = given.deck.watch((change) => {
				if (change.kind === "written") void announceIfNew(given, change);
				const card = layout.cardOf(change.path);
				if (!card) return;
				const removed = change.kind === "deleted" && change.path === card;
				given.events.emit(events.cardChanged, { canvas: layout.canvasOfPath(card)?.name ?? "", ids: [card], by: change.by, rev: change.rev, ...(removed ? { removed } : {}) });
			});
			return () => {
				sizes();
				files();
			};
		},
	});
}

/** A written file the deck's history did not have one revision earlier is new: file.created. */
async function announceIfNew(kernel: Kernel, change: FileChange): Promise<void> {
	if (!kernel.deck.readAt) return;
	const existed = await kernel.deck.readAt(change.path, change.rev - 1).then(() => true, () => false);
	if (!existed) kernel.events.emit(events.fileCreated, { ids: [change.path], by: change.by, rev: change.rev });
}

/**
 * The deck paths a canvas's drawing names, at any depth: each item's card, path and file, and every url
 * in it (an old page placed from the deck's root), as the canvas reads them (server/canvas/paths.ts).
 */
function placedPaths(kernel: Kernel | undefined, canvas: string): Set<string> {
	const out = new Set<string>();
	const add = (raw: string) => {
		const resolved = layout.resolveReference(canvas, raw);
		if ("path" in resolved) out.add(resolved.path);
		out.add(raw.replace(/^\/+/, ""));
	};
	const walk = (value: unknown, key = ""): void => {
		if (Array.isArray(value)) value.forEach((one) => walk(one));
		else if (value && typeof value === "object") for (const [k, one] of Object.entries(value)) walk(one, k);
		else if (typeof value === "string" && ["card", "path", "file", "url"].includes(key)) add(value);
	};
	try {
		if (kernel) walk(kernel.canvas(canvas).read());
	} catch {
		// A canvas that cannot be read places nothing.
	}
	return out;
}
