/**
 * The editor's side effects on the page (`core/gesture.ts`, `Effect`), run here in the order a
 * step gives them: the composer marked as a drop target and told what was dropped on it, the
 * ghost of what a drag carries over a card, a card's link opened, a film played, boards moved and
 * sized, and when the camera was last dragged.
 */
import { walk, type MediaItem, type PenDocument, type PenNode } from "@decks/pen";
import { canvasHost } from "../../host.ts";
import { shortLabel } from "../../lib/labels.ts";
import type { Effect } from "../core/gesture.ts";
import type { Pt, Rect } from "../core/model.ts";

/** A mention of something dropped on the composer. */
export type ReferPill = { kind: "board" | "item"; id: string; label: string };

export type EffectHost = {
	/** The stage's element: what the ghost's attribute goes on. */
	element: () => HTMLElement | undefined;
	/** Where a stage point is on the screen, relative to the stage's element. */
	toScreen: (point: Pt) => Pt;
	/** Where an item is drawn, in stage pixels. */
	box: (id: string) => Rect | undefined;
	/** The carried picture of a drag, and whether the engine draws it. */
	cutFromCarried: (rect: { left: number; top: number; width: number; height: number }) => HTMLCanvasElement | undefined;
	showCarriedLayer: (on: boolean) => void;
	pen: () => { doc: PenDocument; base: string } | undefined;
	boards: () => ReadonlyArray<{ path: string; title?: string | undefined }>;
	onRefer?: ((pills: ReferPill[]) => void) | undefined;
	onOpenBoard?: ((path: string, hash: string) => boolean | void) | undefined;
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
	 * Boards as well as drawn items, and a drag of both mentions both. The composer is a small
	 * target a hand has to aim at, so a board parked at the bottom of the canvas is parked *beside*
	 * it rather than on it; and a board is the thing most worth saying "this one" about.
	 */
	const composerUnder = (at: Pt, ids: readonly string[], boards: readonly string[]): HTMLElement | undefined => {
		if (!host.onRefer || ids.length + boards.length === 0) return undefined;
		const element = document.elementFromPoint(at.x, at.y) as HTMLElement | null;
		return element?.closest<HTMLElement>(".composer-box") ?? undefined;
	};
	/**
	 * What to call each thing that was dropped on the composer.
	 *
	 * A board is its title, which is the sentence on its own bar; an item is its name, or the
	 * words it draws when it has none — a note reads as what it says — and its id when it is a
	 * shape with neither. The id is what the mention *is*; this is only what it shows.
	 */
	const referPills = (ids: readonly string[], boards: readonly string[]): ReferPill[] => {
		const named = new Map<string, PenNode>();
		const pen = host.pen();
		if (pen) for (const node of walk(pen.doc.children)) named.set(node.id, node);
		return [
			...boards.map((path) => ({
				kind: "board" as const,
				id: path,
				label: shortLabel(host.boards().find((board) => board.path === path)?.title || (path.split("/").pop() ?? path)),
			})),
			...ids.map((id) => {
				const node = named.get(id);
				const content = (node as { content?: unknown } | undefined)?.content;
				const words = node?.name || (typeof content === "string" ? content : "");
				return { kind: "item" as const, id, label: shortLabel(words) || id };
			}),
		];
	};

	/** The composer being told it is a drop target, so the mark can be taken off wherever the drag ends. */
	let referTarget: HTMLElement | undefined;
	const markComposer = (element: HTMLElement | undefined) => {
		if (referTarget === element) return;
		if (referTarget) delete referTarget.dataset.refer;
		referTarget = element;
		if (element) element.dataset.refer = "true";
	};

	/*
	 * The ghost of what a drag carries over a card: a picture of the items cut from the sheet as the
	 * drag starts, laid beside the pointer with a shadow and a slight tilt, as the card's own pieces are
	 * (`pen/CardEditor.tsx`), while the carried picture and the selection's handles stand aside.
	 */
	let ghost: { el?: HTMLCanvasElement; rect: { left: number; top: number; width: number; height: number } } | undefined;
	/** Where the carried items lie on screen as the drag starts: the ghost is cut from there. */
	const ghostTake = (ids: readonly string[]) => {
		ghostDrop();
		const element = host.element();
		if (!element || !ids.length) return;
		const r = element.getBoundingClientRect();
		const boxes = ids.map((id) => host.box(id)).filter((b): b is NonNullable<typeof b> => !!b);
		if (!boxes.length) return;
		const a = host.toScreen({ x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)) });
		const b = host.toScreen({ x: Math.max(...boxes.map((b) => b.x + b.w)), y: Math.max(...boxes.map((b) => b.y + b.h)) });
		ghost = { rect: { left: r.left + a.x, top: r.top + a.y, width: b.x - a.x, height: b.y - a.y } };
	};
	/** Over a card, the ghost beside the pointer `gap` px off; elsewhere, the carried picture as before. */
	const ghostShow = (over: boolean, client?: Pt, gap = 12) => {
		if (over && ghost && !ghost.el) {
			const el = host.cutFromCarried(ghost.rect);
			if (el) {
				el.className = "pen-drag-ghost";
				// A large item rides at most about a card's width, so the slot it is aimed at stays in view.
				const scale = Math.min(1, 220 / Math.max(ghost.rect.width, 1));
				el.style.width = `${ghost.rect.width * scale}px`;
				el.style.height = `${ghost.rect.height * scale}px`;
				document.body.append(el);
				ghost.el = el;
			}
		}
		const showing = over && !!ghost?.el;
		host.element()?.toggleAttribute("data-ghosting", showing);
		host.showCarriedLayer(!showing);
		if (!ghost?.el) return;
		ghost.el.hidden = !over;
		if (over && client) {
			ghost.el.style.left = `${client.x + gap}px`;
			ghost.el.style.top = `${client.y + gap}px`;
		}
	};
	const ghostDrop = () => {
		ghost?.el?.remove();
		ghost = undefined;
		host.element()?.removeAttribute("data-ghosting");
		host.showCarriedLayer(true);
	};

	/**
	 * A card's link. A link to a board of this deck opens that board on the canvas, exactly as
	 * the same link on a board does (`board/board-links.ts`); anything else is a new tab. A
	 * relative link is read against the stage's own folder.
	 */
	const openLink = (href: string) => {
		const base = host.pen()?.base ?? "";
		const board = canvasHost().boardLink(href, base);
		if (board && host.onOpenBoard?.(board, "")) return;
		let url: URL;
		try {
			url = new URL(href, new URL(base || "/", location.href));
		} catch {
			return;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return;
		window.open(url.href, "_blank", "noopener,noreferrer");
	};

	const run = (effect: Effect) => {
		switch (effect.do) {
			case "select-board":
				return host.onSelect(effect.path);
			case "ghost-take":
				return ghostTake(effect.ids);
			case "ghost-show":
				return ghostShow(effect.over, effect.client, effect.gap);
			case "ghost-drop":
				return ghostDrop();
			case "composer":
				return markComposer(effect.client ? composerUnder(effect.client, effect.ids, effect.boards) : undefined);
			case "refer":
				return host.onRefer?.(referPills(effect.ids, effect.boards));
			case "open-link":
				return openLink(effect.href);
			case "media":
				return host.toggleMedia(effect.id, effect.media);
			case "move-boards":
				for (const move of effect.moves) host.onMove(move.path, move.x, move.y);
				return;
			case "board-size":
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

	return { run, openLink, ghostDrop, overComposer: (at: Pt, ids: readonly string[], boards: readonly string[]) => composerUnder(at, ids, boards) !== undefined };
}
