import { canvasPass } from "../canvases/pass.ts";
import { openTab } from "./tabs.ts";

/** The canvas a file of the deck is in, by its path: `canvases/<name>/…` is `<name>`'s, `shared/canvases/<owner>/<name>/…` is `shared/<owner>/<name>`'s. */
export function canvasOfPath(path: string): string | undefined {
	const own = /^canvases\/([^/]+)\//.exec(path);
	if (own) return own[1];
	const shared = /^shared\/canvases\/([^/]+)\/([^/]+)\//.exec(path);
	return shared ? `shared/${shared[1]}/${shared[2]}` : undefined;
}

/**
 * Open a card, a document or an app whole, from its pill on a canvas (New tab): a card in a tab of
 * this window, by its kind (`kinds/card.tsx`). A document and an app have no kind yet, and open as
 * they did, in the browser's tab: the document's file on its canvas's pass, the app's own page.
 */
export function openItem(item: { kind: "card" | "document" | "app"; target: string }): void {
	if (item.kind === "card") return openTab("card", item.target);
	if (item.kind === "app") return void window.open(`/app/${encodeURIComponent(item.target)}/`, "_blank", "noopener");
	const canvas = canvasOfPath(item.target);
	if (canvas) void canvasPass(canvas).then((pass) => window.open(`${pass.files}${item.target.split("/").map(encodeURIComponent).join("/")}`, "_blank", "noopener"));
}
