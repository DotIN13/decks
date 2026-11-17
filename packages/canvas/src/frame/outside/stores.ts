import { type FramedEditorOptions } from "./host.tsx";

/**
 * Where an app inside a canvas keeps its browser storage on this page: by the app, not the canvas, so
 * the same app on another canvas reads the same values; the same keys its own tab uses on this origin
 * (`decks-canvas.js`, `server/src/apps/canvas-guest.ts`).
 */
export const APP_STORE = "decks.app:";

/** What the frame's own views were kept under in that store (`createAgentViews`'s key "frame"). */
export const FRAME_VIEWS = "decks.views:frame";

/** What `createFrameStores` reads of the frame's host (`host.tsx`). */
export interface FrameStoresNeeds {
	readonly options: FramedEditorOptions;
}

/** Where the frame's canvas and the apps in it keep what they store, on the page outside. */
export function createFrameStores(d: FrameStoresNeeds) {
	const storage = d.options.frame.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);

	const storeKey = (canvas: string) => `decks.frame:${canvas}:`;

	/** Every app's saved browser values on this page, by app name and key. */
	const appStoredNow = (): Record<string, Record<string, string>> => {
		const out: Record<string, Record<string, string>> = {};
		if (!storage) return out;
		for (let i = 0; i < (storage as Storage).length; i++) {
			const key = (storage as Storage).key(i);
			if (!key?.startsWith(APP_STORE)) continue;
			const rest = key.slice(APP_STORE.length);
			const at = rest.indexOf(":");
			if (at <= 0) continue;
			(out[rest.slice(0, at)] ??= {})[rest.slice(at + 1)] = storage.getItem(key) ?? "";
		}
		return out;
	};

	return {
		storage,
		storeKey,
		appStoredNow,
	};
}
