/**
 * The editor's side effects on the page (`core/gesture.ts`, `Effect`), run here in the order a
 * step gives them: the composer marked as a drop target and told what was dropped on it, the
 * ghost of what a drag carries over a card, a card's link opened, a film played, cards moved and
 * sized, and when the camera was last dragged.
 */
import { isDeckLink, walk, type MediaItem, type PenDocument, type PenNode } from "@decks/pen";
import { canvasHost, openInTab, type CanvasHost } from "../../base/host.ts";
import { shortLabel } from "@decks/ui";
import type { Effect } from "../core/gesture.ts";
import type { Pt, Rect } from "../core/model.ts";
import { createGhost } from "./ghost.ts";

/** The composer a drag is over: its element, or the host's word for one outside this document. */
type ReferTarget = HTMLElement | NonNullable<CanvasHost["composer"]>;

/** A mention of something dropped on the composer. */
/** `label` is what the pill shows; `name` what it is called in full, for its card and the sent message. */
type ReferPill = { kind: "card" | "item"; id: string; label: string; name?: string };

export type EffectHost = {
	/** The canvas's element: what the ghost's attribute goes on. */
	element: () => HTMLElement | undefined;
	/** Where a canvas point is on the screen, relative to the canvas's element. */
	toScreen: (point: Pt) => Pt;
	/** Where an item is drawn, in canvas pixels. */
	box: (id: string) => Rect | undefined;
	/** The carried picture of a drag, and whether the engine draws it. */
	cutFromCarried: (rect: { left: number; top: number; width: number; height: number }) => HTMLCanvasElement | undefined;
	showCarriedLayer: (on: boolean) => void;
	pen: () => { doc: PenDocument; base: string } | undefined;
	cards: () => ReadonlyArray<{ path: string; title?: string | undefined }>;
	onRefer?: ((pills: ReferPill[]) => void) | undefined;
	onOpenPage?: ((path: string, hash: string) => boolean | void) | undefined;
	onSelect: (path: string | undefined) => void;
	onMove: (path: string, x: number, y: number) => void;
	onResize?: ((path: string, size: { w: number; h: number }) => void) | undefined;
	toggleMedia: (id: string, media: MediaItem) => void;
	settle: (landing?: ReadonlyMap<string, Rect>) => void;
	/** Step the editor again at a time (`tick`). */
	wake: (at: number) => void;
	panned: () => void;
	awaitFrame: (resize: Extract<Effect, { do: "await-frame" }>["resize"]) => void;
};

/** The page's half of the editor: each effect a step asks for, done. */
export function createEffects(host: EffectHost) {
	/**
	 * The composer under a point, when a drag of drawn items could be a mention instead of a move.
	 *
	 * `elementFromPoint` rather than a rectangle we keep: the composer is a float the person can
	 * drag anywhere and can be folded away to a tab, so where it is is a question only the
	 * document can answer. Pointer capture does not change hit testing, so this works mid-drag.
	 *
	 * Cards as well as drawn items, and a drag of both mentions both. The composer is a small
	 * target a hand has to aim at, so a card parked at the bottom of the canvas is parked *beside*
	 * it rather than on it; and a card is the thing most worth saying "this one" about.
	 */
	/** Where the composer was last seen on the screen, read again every 200 ms: a point far from it needs no hit test. */
	let composerSeen: { rect: DOMRect | undefined; at: number } | undefined;
	const nearComposer = (at: Pt): boolean => {
		const now = performance.now();
		if (!composerSeen || now - composerSeen.at > 200) composerSeen = { rect: document.querySelector<HTMLElement>(".composer-box")?.getBoundingClientRect(), at: now };
		const r = composerSeen.rect;
		return !!r && at.x >= r.left - 24 && at.x <= r.right + 24 && at.y >= r.top - 24 && at.y <= r.bottom + 24;
	};
	const composerUnder = (at: Pt, ids: readonly string[], cards: readonly string[]): ReferTarget | undefined => {
		if (!host.onRefer || ids.length + cards.length === 0) return undefined;
		// A hit test (elementFromPoint) at every step of a drag cost more than the drawing; it is asked only near the composer's last place.
		const element = nearComposer(at) ? (document.elementFromPoint(at.x, at.y) as HTMLElement | null) : null;
		const own = element?.closest<HTMLElement>(".composer-box");
		if (own) return own;
		// In the canvas frame the composer is the page's: the host knows where it is.
		const outside = canvasHost().composer;
		return outside?.at(at.x, at.y) ? outside : undefined;
	};
	/**
	 * What to call each thing that was dropped on the composer.
	 *
	 * A card is its title, which is the sentence on its own bar; an item is its name, or the
	 * words it draws when it has none — a note reads as what it says — and its id when it is a
	 * shape with neither. The id is what the mention *is*; this is only what it shows.
	 */
	const referPills = (ids: readonly string[], cards: readonly string[]): ReferPill[] => {
		const named = new Map<string, PenNode>();
		const pen = host.pen();
		if (pen) for (const node of walk(pen.doc.children)) named.set(node.id, node);
		return [
			...cards.map((path) => {
				const name = host.cards().find((card) => card.path === path)?.title || (path.split("/").pop() ?? path);
				return { kind: "card" as const, id: path, label: shortLabel(name), name };
			}),
			...ids.map((id) => {
				const node = named.get(id);
				const content = (node as { content?: unknown } | undefined)?.content;
				const words = (node?.name || (typeof content === "string" ? content : "")).replace(/\s+/g, " ").trim();
				return { kind: "item" as const, id, label: shortLabel(words) || id, name: words || id };
			}),
		];
	};

	/** The composer being told it is a drop target, so the mark can be taken off wherever the drag ends. */
	let referTarget: ReferTarget | undefined;
	const mark = (target: ReferTarget, on: boolean) => {
		if (!(target instanceof HTMLElement)) return target.mark(on);
		if (on) target.dataset.refer = "true";
		else delete target.dataset.refer;
	};
	const markComposer = (target: ReferTarget | undefined) => {
		if (referTarget === target) return;
		if (referTarget) mark(referTarget, false);
		referTarget = target;
		if (target) mark(target, true);
	};

	const { ghostTake, ghostShow, ghostDrop } = createGhost({
		host,
	});

	/**
	 * A link followed. One to something in the deck by its address in the window (`#canvas/…`,
	 * `@decks/pen`, `link.ts`) is the host's to open, as a tab of its own, or with `browser` the browser's.
	 * A link to a card of this deck opens that card on the canvas, exactly as the host opens one
	 * (`onOpenLink`, `types.ts`); anything else is a new tab. A relative link is read against the
	 * canvas's own folder.
	 */
	const openLink = (href: string, browser = false) => {
		if (isDeckLink(href)) return void canvasHost().openAddress?.(href.trim(), browser);
		const base = host.pen()?.base ?? "";
		const card = canvasHost().cardLink(href, base);
		if (card && host.onOpenPage?.(card, "")) return;
		let url: URL;
		try {
			url = new URL(href, new URL(base || "/", location.href));
		} catch {
			return;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return;
		openInTab(url.href);
	};

	const run = (effect: Effect) => {
		switch (effect.do) {
			case "select-card":
				return host.onSelect(effect.path);
			case "ghost-take":
				return ghostTake(effect.ids);
			case "ghost-show":
				return ghostShow(effect.over, effect.client, effect.gap);
			case "ghost-drop":
				return ghostDrop();
			case "composer":
				return markComposer(effect.client ? composerUnder(effect.client, effect.ids, effect.cards) : undefined);
			case "refer":
				return host.onRefer?.(referPills(effect.ids, effect.cards));
			case "open-link":
				return openLink(effect.href, effect.browser === true);
			case "media":
				return host.toggleMedia(effect.id, effect.media);
			case "move-cards":
				for (const move of effect.moves) host.onMove(move.path, move.x, move.y);
				return;
			case "card-size":
				return host.onResize?.(effect.path, effect.size);
			case "settle":
				return host.settle(effect.landing);
			case "wake":
				return host.wake(effect.at);
			case "panned":
				return host.panned();
			case "await-frame":
				return host.awaitFrame(effect.resize);
		}
	};

	return { run, openLink, ghostDrop, overComposer: (at: Pt, ids: readonly string[], cards: readonly string[]) => composerUnder(at, ids, cards) !== undefined };
}
