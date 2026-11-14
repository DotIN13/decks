import { defineFeature, type Feature } from "../kernel/types.ts";
import { documentCalls, googleCalls } from "./calls.ts";
import { Documents, PAUSE_MS } from "./doc.ts";
import type { GoogleAccount } from "./google.ts";
import { documentKind } from "./item.ts";

// The documents feature: files you type into, their versions and review, Google Docs.

export type DocumentsOptions = { google?: GoogleAccount; pauseMs?: number };

export function documents(options: DocumentsOptions = {}): Feature {
	let docs: Documents | undefined;
	return defineFeature({
		name: "documents",
		calls: [...documentCalls(() => docs), ...googleCalls(options.google)],
		items: [documentKind],
		start(kernel) {
			docs = new Documents(kernel.deck, kernel.events, kernel.store("documents"), options.pauseMs ?? PAUSE_MS);
			return () => docs?.stop();
		},
	});
}

export default documents();
