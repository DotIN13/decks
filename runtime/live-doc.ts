import { mountDocPage } from "@decks/docs/page";

/**
 * `lib/live-doc.js`: a `[data-live="doc"]` box on a board, drawn as a document page you type into.
 *
 * The page is `@decks/docs/page`; this is only how it talks. A board has no socket of its own:
 * it hands every message up to the app, which carries it on the connection it already has, and
 * the app hands the server's answers back down (`apps/web/src/board/live-doc.ts`).
 *
 * `data-path` names the file the way an embed does: relative to the board, or absolute.
 *
 *     npm run build:live-doc
 */
export function mountLiveDoc(
	host: HTMLElement,
	board: string | null,
	renderers: {
		markdown?: (into: HTMLElement, source: string) => Promise<void> | void;
		math?: (into: HTMLElement) => Promise<void> | void;
		file?: (path: string) => Promise<ArrayBuffer>;
		pdf?: (into: HTMLElement, bytes: ArrayBuffer, width: number) => Promise<number>;
		api?: string;
	} = {},
): void {
	const raw = host.dataset.path?.trim();
	if (!raw) {
		host.textContent = "This document box names no file: give it a data-path.";
		return;
	}
	const page = mountDocPage(host, {
		...renderers,
		path: resolvePath(raw, board),
		send: (message) => window.parent.postMessage({ decks: "doc", message }, "*"),
		listen: (listener) => {
			const onMessage = (event: MessageEvent) => {
				if (event.source !== window.parent) return;
				const data = event.data as { decks?: string; message?: unknown } | null;
				if (data?.decks === "doc" && data.message && typeof data.message === "object") listener(data.message as never);
			};
			addEventListener("message", onMessage);
			return () => removeEventListener("message", onMessage);
		},
	});
	addEventListener("pagehide", () => page.destroy(), { once: true });
}

/** A path as a board means it: from the board's own folder, unless it is absolute. */
function resolvePath(raw: string, board: string | null): string {
	if (raw.startsWith("/") || raw.startsWith("~") || !board) return raw;
	const parts = board.split("/").slice(0, -1);
	for (const part of raw.split("/")) {
		if (part === "..") parts.pop();
		else if (part !== "." && part !== "") parts.push(part);
	}
	return parts.join("/");
}
