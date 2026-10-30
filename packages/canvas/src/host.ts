import { setIconSource, type IconSource } from "./render/icons.ts";

/**
 * What the canvas asks of whoever mounted it, in the few places it reaches past its own state.
 *
 * The canvas is a package (`@decks/canvas`): the Decks app mounts it, and so does any other host
 * (Decks Studio, the package's own demo). These are the questions the canvas cannot answer itself
 * — where a deck file is served from, whether the person may write at all, which links on a board
 * name another board — set once by the host (`setCanvasHost`) and read where they are needed.
 * Module state, like the tool signals beside it (`state/pen-tools.ts`): one canvas to a page.
 */
export interface CanvasHost {
	/** The address a deck file is read at (an image fill, an embed, a file opened in a tab). */
	fileUrl(path: string, rev?: number): string;
	/** Whether the person may add files at all (the Add menu's Open File… and attachments). */
	canWrite(): boolean;
	/**
	 * A link on a drawn item: the board it names, when it names one this host can open on the
	 * canvas, read against the drawing's own folder `base`. Undefined opens it in a tab.
	 */
	boardLink(href: string, base: string): string | undefined;
	/** Where an icon's SVG is, before the CDN is asked (`pen/icons.ts`). Absent: the CDN. */
	iconUrl?: IconSource;
	/**
	 * Where a picture the drawing names (an image fill, a card's picture) is read, given as the
	 * drawing wrote it, relative to its own folder `base`. Absent: the address against `base`, which
	 * is right wherever the canvas's folder is itself an address, as in the Decks app.
	 */
	pictureUrl?(url: string, base: string): string;
	/**
	 * A card's `card.decks` call (`card.ts`), made as that card: answered where this host can, refused
	 * where a card may not reach. Absent: cards make no calls.
	 */
	cardCall?(verb: string, args: unknown[], card: string): Promise<unknown>;
	/**
	 * A document item's line to its file (`decks.document`, `item-surfaces.tsx`): what its editor sends,
	 * and every message about the files this canvas's documents name. Absent: documents do not open here.
	 */
	documents?: {
		send(message: unknown): void;
		listen(listener: (message: unknown) => void): () => void;
		/** A file's bytes, for a Word page or a picture in a document. */
		file?(path: string): Promise<ArrayBuffer>;
		/** The deck's `lib/`, for markdown and maths in a document. */
		lib?: string;
	};
	/** An app item's (`decks.app`): what the app is and whether it runs, and opening it, which the app's page does, in a tab. */
	apps?: {
		status(name: string): Promise<{ title?: string; status?: string } | undefined>;
		open(name: string): void;
	};
	/** Open an address in a tab of its own, for a canvas that may not open one (the frame's sandbox has no popups). Absent: `window.open`. */
	openLink?(href: string): void;
}

const fallback: CanvasHost = {
	fileUrl: (path) => path,
	canWrite: () => true,
	boardLink: () => undefined,
};

let current: CanvasHost = fallback;

/** Answer the canvas's questions; fields left out keep what they had. */
export function setCanvasHost(next: Partial<CanvasHost>): void {
	current = { ...current, ...next };
	if ("iconUrl" in next) setIconSource(next.iconUrl);
}

/** The host's answers, read at the moment they are needed. */
export const canvasHost = (): CanvasHost => current;

/** An address in a tab of its own: the host's way, or the window's. */
export function openInTab(href: string): void {
	if (current.openLink) current.openLink(href);
	else window.open(href, "_blank", "noopener,noreferrer");
}

/** A picture the drawing names, as the address to fetch: the host's answer, or the address against `base`. */
export function pictureAddress(url: string, base: string): string {
	if (current.pictureUrl && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return current.pictureUrl(url, base);
	return new URL(url, new URL(base || "/", typeof location === "undefined" ? "http://canvas.invalid/" : location.href)).href;
}
