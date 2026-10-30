import { createEffect, on, onCleanup, untrack } from "solid-js";
import { INTERACTIVE, isCardSheet, mountCard, scrollsInside, type MountedCard } from "./card.ts";
import { snapshotOfCard, type CardShot } from "./card-snapshot.ts";
import { cardLoader } from "./card-load.ts";
import { scheme } from "../lib/theme.ts";
import { canvasHost, openInTab } from "../host.ts";

/** The cards mounted on this page, by path: how each is written out for an agent's screenshot (`card-snapshot.ts`). */
const shots = new Map<string, () => CardShot | undefined>();

/** A card on this page as it stands now, as a page the server's Chrome draws; nothing when it is not mounted (asleep, or not here). */
export function cardShot(path: string): CardShot | undefined {
	return shots.get(path)?.();
}

/**
 * A card's surface in its slot on the stage (`item-slot.tsx`): a host element whose shadow root holds the
 * card (`card.ts`). A card's events reach the stage as they are; this only decides which of them are
 * the card's own.
 *
 * Decided on the card's root, not its host: from outside a closed root an event's path stops at the
 * host, so nothing there can tell a press on the card's button from one on its background.
 *
 * - **A mouse or pen press** inside the card is the card's: it never starts a marquee or a pan, and it
 *   selects the card. The card moves by its bar and its edge.
 * - **A finger** pans the canvas across a card, unless it lands on one of the card's controls.
 * - **A wheel** scrolls what inside the card can take it, and pans the canvas otherwise; a pinch always zooms.
 * - **Keys** typed into the card's own fields stay in it, so Delete in a text box deletes a letter, not the card.
 * - **Its buttons** are the card's own module's: they act through `card.decks` (`card.ts`), answered
 *   where the host says (`CanvasHost.cardCall`). A card has no `data-eval` blocks.
 */
export function CardSurface(props: {
	page: string;
	path: string;
	trusted: boolean;
	rev: number;
	reload?: number | undefined;
	size: () => { w: number; h: number };
	selected: boolean;
	onSelect: () => void;
	onShown: () => void;
	/** Open a board or card the card links to, beside it (`Stage`'s `onOpenBoard`), by its deck path. */
	onOpenBoard?: ((path: string) => void) | undefined;
	/** The card's content height, for `decks.canvas.fit` (`card-reading.ts`): its file's height stays the floor. */
	onExtent?: ((extent: { w: number; h: number; at: number; page: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void) | undefined;
	/** Words selected in the card, when a press or a key ends a selection: what to quote, the block they are in, and where they are. */
	onWords?: ((words: { quote: string; component?: string; anchor: () => DOMRect | undefined }) => void) | undefined;
}) {
	let host!: HTMLDivElement;
	/*
	 * The card's address with its folder stamped with its revision (`cards/sales@<rev>/index.html`,
	 * `@decks/board-host`): what it imports beside it is then a new address at each version. A page keeps
	 * every module it has imported, so the same address would hand a changed `chart.js` back as it was.
	 */
	const stamped = () => new URL(props.page, location.href).href.replace(/[?#].*$/, "").replace(/\/cards\/([^/@]+)\/index\.html$/i, `/cards/$1@${(props.rev >>> 0).toString(36)}/index.html`);
	let mounted: MountedCard | undefined;
	let forget = () => {};
	const cardCall = canvasHost().cardCall;
	/*
	 * Mounted only once its file has come: a file refused (a ticket run out) or not reached leaves the
	 * card's picture shown, and is asked for once more a moment later (`card-load.ts`).
	 */
	const loader = cardLoader({
		url: () => {
			const url = new URL(stamped());
			url.searchParams.set("raw", "1");
			return url.href;
		},
		read: (url) => fetch(url, { cache: "no-cache" }),
		mount: (html) => {
			if (!host) return;
			mount(html);
		},
	});
	const mount = (html: string) => {
		mounted?.dispose();
		// A closed root is made once per element: a new file gets a new element.
		const fresh = document.createElement("div");
		fresh.className = "card-host";
		// Sized here, not by the card's sheet: a root contained in size with no size of its own is nothing tall.
		fresh.style.cssText = "width: 100%; height: 100%";
		host.replaceChildren(fresh);
		mounted = mountCard(fresh, {
			html,
			url: stamped(),
			path: props.path,
			trusted: props.trusted,
			theme: untrack(scheme),
			size: untrack(props.size),
			...(cardCall ? { call: (verb: string, args: unknown[]) => cardCall(verb, args, props.path) } : {}),
		});
		listen(mounted.root, fresh);
		const root = mounted.root;
		const url = stamped();
		const shot = () => snapshotOfCard(root, { ...untrack(props.size), scheme: untrack(scheme), url, skip: isCardSheet });
		shots.set(props.path, shot);
		forget = () => shots.get(props.path) === shot && shots.delete(props.path);
		// What fit reads (`card-reading.ts`): the height, and how the card reads at it.
		const card = mounted;
		mounted.onHeight((h) => {
			const w = untrack(props.size).w;
			props.onExtent?.({ w, h, at: w, page: h, ...card.reading() });
		});
		props.onShown();
	};
	createEffect(on(() => [props.page.replace(/[?#].*$/, ""), props.rev, props.reload] as const, () => loader.load()));
	/*
	 * The scheme and the size are read before the card is asked: a card mounts later than these run
	 * first, and `mounted?.setTheme(scheme())` reads nothing while `mounted` is unset, so the effect
	 * would never run again and a card would keep the scheme it woke in.
	 */
	createEffect(() => {
		const theme = scheme();
		mounted?.setTheme(theme);
	});
	createEffect(() => {
		const size = props.size();
		mounted?.setSize(size);
	});
	onCleanup(() => {
		loader.stop();
		forget();
		mounted?.dispose();
	});

	const own = (event: Event) => event.composedPath().some((target) => target instanceof Element && target.matches?.(INTERACTIVE));
	const editable = (event: Event) => {
		const target = event.composedPath()[0];
		return target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.localName));
	};
	/** What the card's own root hears, and how much of it goes on to the stage. */
	const listen = (root: ShadowRoot, element: HTMLElement) => {
		root.addEventListener("pointerdown", (event) => {
			const press = event as PointerEvent;
			if (press.pointerType === "touch") {
				if (own(press)) press.stopPropagation();
				return;
			}
			if (press.button !== 0 && press.button !== 2) return;
			if (!props.selected) props.onSelect();
			press.stopPropagation();
		});
		for (const type of ["pointerup", "click", "dblclick", "contextmenu"]) root.addEventListener(type, (event) => (event as PointerEvent).pointerType !== "touch" && event.stopPropagation());
		root.addEventListener(
			"wheel",
			(event) => {
				const wheel = event as WheelEvent;
				if (wheel.ctrlKey) return;
				if (scrollsInside(wheel.composedPath(), element, wheel.deltaX, wheel.deltaY)) wheel.stopPropagation();
			},
			{ passive: true },
		);
		for (const type of ["keydown", "keyup", "keypress"]) root.addEventListener(type, (event) => editable(event) && event.stopPropagation());
		root.addEventListener("click", (event) => followLink(event as MouseEvent));
		// A selection ends with a press let go, or a key with Shift: a moment later, it is read.
		const readSoon = () => void setTimeout(() => readWords(root), 0);
		root.addEventListener("pointerup", readSoon);
		root.addEventListener("keyup", (event) => (event as KeyboardEvent).shiftKey && readSoon());
	};

	/**
	 * The words selected in this card. A closed root hides its selection from the page's `getSelection()`,
	 * which reports the host; `getComposedRanges`, handed the root, gives the range inside it.
	 */
	const readWords = (root: ShadowRoot) => {
		if (!props.onWords) return;
		const selection = document.getSelection() as (Selection & { getComposedRanges?: (...args: unknown[]) => StaticRange[] }) | null;
		// Not `isCollapsed`: seen from the page, a selection inside a shadow root is collapsed at its host.
		if (!selection || selection.rangeCount === 0 || typeof selection.getComposedRanges !== "function") return;
		let ranges: StaticRange[];
		try {
			ranges = selection.getComposedRanges({ shadowRoots: [root] });
		} catch {
			// Safari 17's form: the roots as arguments.
			ranges = selection.getComposedRanges(root);
		}
		const given = ranges[0];
		if (!given || given.collapsed || !root.contains(given.startContainer) || !root.contains(given.endContainer)) return;
		const range = document.createRange();
		range.setStart(given.startContainer, given.startOffset);
		range.setEnd(given.endContainer, given.endOffset);
		const quote = range.toString().replace(/\s+/g, " ").trim();
		if (!quote) return;
		const at = given.startContainer instanceof Element ? given.startContainer : given.startContainer.parentElement;
		const component = at?.closest("[data-id]")?.getAttribute("data-id") ?? undefined;
		props.onWords({ quote, ...(component ? { component } : {}), anchor: () => (range.collapsed ? undefined : range.getBoundingClientRect()) });
	};

	/*
	 * A link in a card never takes the app's own page away. A link to a board or card of the deck opens it
	 * beside this one, as on a board (`board.js`); any other opens in a tab of its own.
	 */
	const followLink = (event: MouseEvent) => {
		if (event.defaultPrevented || event.button !== 0) return;
		const origin = event.composedPath()[0];
		const link = origin instanceof Element ? origin.closest("a[href]") : null;
		const href = link?.getAttribute("href");
		if (!link || !href || href.startsWith("#")) return;
		event.preventDefault();
		let url: URL;
		try {
			url = new URL(href, location.href);
		} catch {
			return;
		}
		const board = /\.(?:html?|md)$/i.test(url.pathname) ? boardOf(url) : undefined;
		if (board && props.onOpenBoard) return props.onOpenBoard(board);
		if (/^https?:$/.test(url.protocol)) openInTab(url.href);
	};

	/**
	 * The deck path a link names: under the app's `/api/board/` on this page's origin, or, in the canvas
	 * frame, under its ticketed address (`/api/t/<ticket>/board/`), which only its host knows.
	 */
	const boardOf = (url: URL): string | undefined => {
		const at = url.pathname.indexOf("/api/board/");
		const named = url.origin === location.origin && at >= 0 ? decodeURIComponent(url.pathname.slice(at + "/api/board/".length)) : canvasHost().boardLink(url.href, location.href);
		const path = named?.replace(/(\/cards\/[^/@]+)@[A-Za-z0-9]+\//, "$1/");
		return path && !path.split("/").some((part) => part === "" || part === "." || part === "..") ? path : undefined;
	};

	return <div class="card-surface" ref={(element) => (host = element)} style={{ width: "100%", height: "100%" }} />;
}
