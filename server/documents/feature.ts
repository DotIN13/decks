import { defineFeature, type Feature, type Store } from "../kernel/types.ts";
import { googleFor } from "./google/docs.ts";
import { documentCalls, googleCalls } from "./calls.ts";
import { Documents, PAUSE_MS } from "./doc.ts";
import type { GoogleAccount } from "./google.ts";
import { tick, TICK_MS, type GoogleDocs, type Remote } from "./links.ts";
import { events } from "../../protocol/index.ts";
import { documentKindWith } from "./place.ts";
import type { Deck } from "../kernel/types.ts";

// The documents feature: files you type into, their versions and review, Google Docs.

/** googleStore: where the Google sign-in is kept (today's <data>/google/); google and docs override it in tests. */
export type DocumentsOptions = { googleStore?: Store; google?: GoogleAccount; docs?: GoogleDocs; pauseMs?: number; tickMs?: number };

export function documents(given: DocumentsOptions = {}): Feature {
	const made = given.googleStore ? googleFor(given.googleStore) : undefined;
	const options = { ...given, google: given.google ?? made?.google, docs: given.docs ?? made?.docs };
	let docs: Documents | undefined;
	let deck: Deck | undefined;
	return defineFeature({
		name: "documents",
		calls: [...documentCalls(() => docs), ...googleCalls(options.google, options.docs)],
		items: [documentKindWith(() => deck)],
		...(made ? { routes: made.routes } : {}),
		start(kernel) {
			deck = kernel.deck;
			const store = kernel.store("documents");
			const open = new Documents(kernel.deck, kernel.events, store, options.pauseMs ?? PAUSE_MS);
			docs = open;
			const remote = options.docs;
			const tell = (mirror: string, state: Remote) => kernel.events.emit(events.fileChanged, { ids: [mirror], by: "google", rev: 0, part: "remote", remote: state });
			const timer = remote ? setInterval(() => void tick(remote, kernel.deck, store, (path) => open.isOpen(path), tell), options.tickMs ?? TICK_MS) : undefined;
			timer?.unref?.();
			return () => {
				clearInterval(timer);
				open.stop();
			};
		},
	});
}

