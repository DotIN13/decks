import { defineFeature, type Feature } from "../kernel/types.ts";
import { documentCalls, googleCalls } from "./calls.ts";
import { Documents, PAUSE_MS } from "./doc.ts";
import type { GoogleAccount } from "./google.ts";
import { tick, TICK_MS, type GoogleDocs } from "./links.ts";
import { documentKindWith } from "./place.ts";
import type { Deck } from "../kernel/types.ts";

// The documents feature: files you type into, their versions and review, Google Docs.

export type DocumentsOptions = { google?: GoogleAccount; docs?: GoogleDocs; pauseMs?: number; tickMs?: number };

export function documents(options: DocumentsOptions = {}): Feature {
	let docs: Documents | undefined;
	let deck: Deck | undefined;
	return defineFeature({
		name: "documents",
		calls: [...documentCalls(() => docs), ...googleCalls(options.google, options.docs)],
		items: [documentKindWith(() => deck)],
		start(kernel) {
			deck = kernel.deck;
			const store = kernel.store("documents");
			const open = new Documents(kernel.deck, kernel.events, store, options.pauseMs ?? PAUSE_MS);
			docs = open;
			const remote = options.docs;
			const timer = remote ? setInterval(() => void tick(remote, kernel.deck, store, (path) => open.isOpen(path)), options.tickMs ?? TICK_MS) : undefined;
			timer?.unref?.();
			return () => {
				clearInterval(timer);
				open.stop();
			};
		},
	});
}

export default documents();
