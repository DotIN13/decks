import { isDeckLink } from "@decks/pen";
import { canvasHost, freshAddress, openInTab } from "../base/host.ts";
import type { CardSurfaceProps } from "./card-surface-props.ts";

/** What `createCardLinks` reads of `CardSurface` (`card-surface.tsx`). */
export interface CardLinksNeeds {
	readonly stamped: () => string;
	readonly props: CardSurfaceProps;
}

/** A press on a link in a card: another card opens beside it, a download is fetched and saved, anything else opens in a tab. */
export function createCardLinks(d: CardLinksNeeds) {
	/*
	 * A link in a card never takes the app's own page away. Its address is read against the card's own
	 * (`../../files/plan.html` is a file of the card's canvas), never against the page the card is drawn
	 * in. A link to another card (`cards/<name>/index.html`) opens it beside this one, as `card.js` does; a link to something in the deck by its address in the window (`#canvas/<name>`,
	 * `#app/<name>`) opens it as a tab, where the host has tabs; a link with `download` saves the file, under the name it gives; any other link,
	 * a file of the deck's among them, opens in a tab of its own.
	 */
	const followLink = (event: MouseEvent) => {
		if (event.defaultPrevented || event.button !== 0) return;
		const origin = event.composedPath()[0];
		const link = origin instanceof Element ? origin.closest("a[href]") : null;
		const href = link?.getAttribute("href");
		// A link to something in the deck, by its address in the window (`#canvas/…`, `@decks/pen`, `link.ts`): the host's to open, as a tab; ⌘ or Ctrl asks for the browser's.
		if (link && href && isDeckLink(href)) {
			event.preventDefault();
			return void canvasHost().openAddress?.(href.trim(), event.metaKey || event.ctrlKey);
		}
		if (!link || !href || href.startsWith("#")) return;
		event.preventDefault();
		let url: URL;
		try {
			url = new URL(href, d.stamped());
		} catch {
			return;
		}
		if (!/^(?:https?|blob|data):$/.test(url.protocol)) return;
		const address = freshAddress(url.href);
		if (link.hasAttribute("download")) return void saveFile(address, link.getAttribute("download") || decodeURIComponent(url.pathname.split("/").pop() ?? "") || "download");
		const page = pageOf(url);
		if (page && opensBeside(page) && d.props.onOpenPage) return d.props.onOpenPage(page);
		openInTab(address);
	};

	/**
	 * A file saved as a download from inside the canvas's frame: the browser saves a link's `download` only
	 * for an address of the page's own origin, which the frame's blank origin never is, so the file is
	 * fetched and saved from memory. One that cannot be fetched (another site's, which says no) opens in a tab.
	 */
	const saveFile = async (address: string, name: string) => {
		try {
			const response = await fetch(address);
			if (!response.ok) throw new Error(String(response.status));
			const blob = await response.blob();
			const local = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = local;
			anchor.download = name;
			anchor.style.display = "none";
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(local), 60_000);
		} catch {
			openInTab(address);
		}
	};

	/**
	 * The deck path a link names: under the app's `/api/card/` on this
	 * page's origin, or, in the canvas frame, under its pass's address, which only its host knows.
	 */
	const pageOf = (url: URL): string | undefined => {
		const prefix = /\/api\/card\//.exec(url.pathname);
		const named = url.origin === location.origin && prefix ? decodeURIComponent(url.pathname.slice(prefix.index + prefix[0].length)) : canvasHost().cardLink(url.href, location.href);
		const path = named?.replace(/(\/cards\/[^/@]+)@[A-Za-z0-9]+\//, "$1/");
		return path && !path.split("/").some((part) => part === "" || part === "." || part === "..") ? path : undefined;
	};

	/** Whether a deck path is one the canvas opens beside a card: another card. */
	const opensBeside = (path: string) => /(?:^|\/)cards\/[^/]+\/index\.html$/i.test(path) || /(?:^|\/)boards\/.+\.html?$/i.test(path);

	return {
		followLink,
	};
}
