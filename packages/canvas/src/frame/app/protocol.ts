import type { ItemEnd, ItemStart } from "../kind-host.tsx";

/**
 * The app frame: one app, whole, in the frame every kind runs in (`@decks/frame`), as a tab of its
 * own shows it. The app's own page is a frame inside this one, as it is inside a canvas's: it loads at
 * an address with its app pass in the path (`server/src/auth/passes.ts`), and what it keeps in its
 * browser storage is the page's to keep, said up from here.
 */

/** Everything an app frame starts from. */
export interface AppStart extends ItemStart {
	kind: "app";
	app: {
		name: string;
		title: string;
		/** Where the app loads, its pass in the path. */
		url: string;
		/** What the app saved in its browser storage on this page, by key: handed to it after `#` as it opens (`decks-canvas.js`). */
		stored: Record<string, string>;
	};
}

/** What an app's frame says to the page beside the shared words: a value the app saved, or took away (null). */
export interface AppSays {
	"app-store": { key: string; value: string | null };
}

/** The frame's end. */
export type AppEnd = ItemEnd<unknown, AppSays>;
