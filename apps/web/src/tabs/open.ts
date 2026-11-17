import { canvasOnScreen, openTab } from "./tabs.ts";

/** The canvas a file of the deck is in, by its path: `canvases/<name>/…` is `<name>`'s, `shared/canvases/<owner>/<name>/…` is `shared/<owner>/<name>`'s. */
export function canvasOfPath(path: string): string | undefined {
	const own = /^canvases\/([^/]+)\//.exec(path);
	if (own) return own[1];
	const shared = /^shared\/canvases\/([^/]+)\/([^/]+)\//.exec(path);
	return shared ? `shared/${shared[1]}/${shared[2]}` : undefined;
}

/**
 * Open a card, a document or an app whole, from its pill on a canvas (New tab): a card and a document
 * in a tab of this window, each by its kind (`kinds/`), the document on the canvas it was opened from.
 * An app has no kind yet, and opens as it did, in the browser's tab, on its own page.
 */
export function openItem(item: { kind: "card" | "document" | "app"; target: string }): void {
	if (item.kind === "card") return openTab("card", item.target);
	if (item.kind === "document") return openTab("document", item.target, canvasOnScreen()?.name ?? canvasOfPath(item.target));
	window.open(`/app/${encodeURIComponent(item.target)}/`, "_blank", "noopener");
}
