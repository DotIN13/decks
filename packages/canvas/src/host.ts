import { setIconSource, type IconSource } from "./pen/icons.ts";

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
