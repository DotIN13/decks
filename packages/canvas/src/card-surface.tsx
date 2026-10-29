import { createEffect, on, onCleanup, untrack } from "solid-js";
import { INTERACTIVE, mountCard, scrollsInside, type MountedCard } from "./card.ts";
import { scheme } from "./lib/theme.ts";

/**
 * A card's surface in a board's place (`plain-board.tsx`): a host element whose shadow root holds the
 * card (`card.ts`). Where a board's frame needs a bridge to hand the stage its gestures, a card's
 * events reach the stage as they are; this only decides which of them are the card's own.
 *
 * Decided on the card's root, not its host: from outside a closed root an event's path stops at the
 * host, so nothing there can tell a press on the card's button from one on its background.
 *
 * - **A mouse or pen press** inside the card is the card's: it never starts a marquee or a pan, and it
 *   selects the card. The card moves by its bar and its edge, as a live board does.
 * - **A finger** pans the canvas across a card, unless it lands on one of the card's controls.
 * - **A wheel** scrolls what inside the card can take it, and pans the canvas otherwise; a pinch always zooms.
 * - **Keys** typed into the card's own fields stay in it, so Delete in a text box deletes a letter, not the card.
 * - **A `data-eval` button** runs its `text/decks-eval` block with the stage as this card, as a board's
 *   does (`board.js`): the card's own token, from the host, and the harness asks the person once.
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
	/** The card's token for its buttons, when the host gives cards one. */
	token?: (() => Promise<string | undefined>) | undefined;
	/** The card's content height, for a host that grows a board to fit it (`extent.ts`): its file's height stays the floor. */
	onExtent?: ((extent: { w: number; h: number; at: number; page: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void) | undefined;
}) {
	let host!: HTMLDivElement;
	/*
	 * The card's address with its folder stamped with its revision (`cards/sales@<rev>/index.html`,
	 * `@decks/board-host`): what it imports beside it is then a new address at each version. A page keeps
	 * every module it has imported, so the same address would hand a changed `chart.js` back as it was.
	 */
	const stamped = () => new URL(props.page, location.href).href.replace(/[?#].*$/, "").replace(/\/cards\/([^/@]+)\/index\.html$/i, `/cards/$1@${(props.rev >>> 0).toString(36)}/index.html`);
	let mounted: MountedCard | undefined;
	let asked = 0;
	const load = async () => {
		const ask = ++asked;
		let html = "";
		try {
			const url = new URL(stamped());
			url.searchParams.set("raw", "1");
			const response = await fetch(url, { cache: "no-cache" });
			html = response.ok ? await response.text() : "";
		} catch {
			html = "";
		}
		if (ask !== asked || !host) return;
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
		});
		listen(mounted.root, fresh);
		// What fit reads, as a board's frame says it (`extent.ts`): the height, and how the card reads at it.
		const card = mounted;
		mounted.onHeight((h) => {
			const w = untrack(props.size).w;
			props.onExtent?.({ w, h, at: w, page: h, ...card.reading() });
		});
		props.onShown();
	};
	createEffect(on(() => [props.page.replace(/[?#].*$/, ""), props.rev, props.reload] as const, () => void load()));
	createEffect(() => mounted?.setTheme(scheme()));
	createEffect(() => mounted?.setSize(props.size()));
	onCleanup(() => {
		asked++;
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
		root.addEventListener("click", (event) => runEval(root, event as MouseEvent), true);
		root.addEventListener("click", (event) => followLink(event as MouseEvent));
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
		const at = url.pathname.indexOf("/api/board/");
		if (url.origin === location.origin && at >= 0 && /\.(?:html?|md)$/i.test(url.pathname) && props.onOpenBoard) {
			const path = decodeURIComponent(url.pathname.slice(at + "/api/board/".length)).replace(/(\/cards\/[^/@]+)@[A-Za-z0-9]+\//, "$1/");
			if (!path.split("/").some((part) => part === "" || part === "." || part === "..")) return props.onOpenBoard(path);
		}
		if (/^https?:$/.test(url.protocol)) window.open(url.href, "_blank", "noopener");
	};

	const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
	let stage: Promise<unknown> | undefined;
	/** The SDK as this card: the harness that served it, with the card's own token. */
	const cardStage = (): Promise<unknown> => {
		if (stage) return stage;
		const url = new URL(props.page, location.href);
		const at = url.pathname.indexOf("/api/board/");
		const prefix = at < 0 ? "" : url.pathname.slice(0, at);
		let token: string | undefined;
		stage = (async () => {
			token = await props.token?.();
			if (!token) throw new Error("This canvas gives this card no token, so its buttons have no stage here.");
			const sdk = (await import(/* @vite-ignore */ `${url.origin}${prefix}/api/sdk/decks.mjs`)) as { connect(o: { url: string; token: () => string | undefined }): unknown };
			return sdk.connect({ url: `${url.origin}${prefix}`, token: () => token });
		})();
		// A refusal is not kept: the token may come on the next press.
		stage.catch(() => (stage = undefined));
		return stage;
	};
	/** A person's press on a `data-eval` control: its block runs, as on a board (`board.js`, `onEvalClick`). */
	const runEval = (root: ShadowRoot, event: MouseEvent) => {
		if (!props.trusted || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !event.isTrusted) return;
		const origin = event.composedPath()[0];
		const target = origin instanceof Element ? origin.closest("[data-eval]") : null;
		const id = target?.getAttribute("data-eval")?.trim();
		if (!target || !id) return;
		event.preventDefault();
		const carried = target.getAttribute("data-value");
		const own = (target as HTMLInputElement).value;
		const value = carried !== null ? carried : typeof own === "string" ? own : undefined;
		const block = [...root.querySelectorAll('script[type="text/decks-eval"]')].find((one) => (one.getAttribute("data-for") ?? "").trim() === id);
		if (!block) return console.warn(`card ${props.path}: nothing answers "${id}".`);
		const card = { id, board: props.path, path: props.path, ...(value !== undefined ? { value } : {}) };
		void (async () => {
			try {
				await new AsyncFunction("stage", "event", block.textContent ?? "")(await cardStage(), card);
			} catch (error) {
				console.error(`card ${props.path}: "${id}" failed:`, error);
			}
		})();
	};

	return <div class="card-surface" ref={(element) => (host = element)} style={{ width: "100%", height: "100%" }} />;
}
