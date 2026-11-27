import { type Frame, type PenDocument, type PenNode, type Placed, type ThemeState } from "@decks/pen";
import { fontFiles, textNeeds } from "../look/font-files.ts";
import { boundsOf } from "../model/bounds.ts";
import { drawnNodes } from "../model/doc-index.ts";
import { type Words } from "./measure.ts";
import type { CardGeometry } from "./types.ts";
import type { CanvasEngine } from "./engine.ts";

export const EMPTY = '{"version":"2.14","children":[]}';

/** What the page engine laid out again since it was last asked (`Page::layout_changes`). */
type LayoutChanges = {
	all: boolean;
	/** With `all`: every top-level item, its first paint order and how many items it holds. */
	tops?: Array<[string, number, number]>;
	roots: Array<{ id: string; base: number; items: Array<[string, number, number, number, number, string | null, number, ThemeState, { geometry?: string | null; viewBox?: [number, number, number, number] | null }?]>; cards: RootCard[] }>;
	removed: string[];
	bases: Array<[string, number]>;
};

/** A card as the engine sends it with its top-level item: its place in that item's tree (`i`) rather than its paint order. */
export type RootCard = Omit<CardGeometry, "order"> & { i: number };

type RootLaid = { base: number; items: Array<[string, number]>; cards: RootCard[] };

/**
 * The drawing laid out: where the page engine put each item, kept as the maps the view reads
 * (`placed`, `bounds`), taken whole the first time and item by item after an edit; the cards'
 * geometry within their items; and how wide words run, measured for the engine. A part of the
 * engine (`engine.ts`), which it reaches through `of`.
 */
export class EngineLayout {
	constructor(private readonly of: CanvasEngine) {}

	whole(doc: PenDocument | undefined): void {
		const text = doc ? JSON.stringify(doc) : EMPTY;
		this.of.page?.setDocument(text);
		// The fonts its words name are asked for first, so a worker still to paint its first view hears
		// they are coming before it has the drawing, and waits for them rather than paint it twice.
		this.of.faces.needFonts();
		this.of.post({ type: "doc", doc: text, dark: this.of.scheme === "dark" });
	}

	/**
	 * Take in what the page engine laid out again since the last time (`layoutChanges`): each item's box
	 * with its node, what it covers, the cards. Only the top-level items it re-laid are read, so a
	 * drag's step (the arrows it bends) and an edit (what it reached) cost what they changed, not the
	 * canvas. `placed` stays in paint order.
	 *
	 * `quiet` (a drag's step that only moves things, `showPreview`): the click shapes over boards and
	 * the stage's readers of the layout (`drawn`) wait for the gesture's end, since nothing they read
	 * changed but the arrows the drag bends.
	 */
	laidOut(quiet = false): void {
		if (!this.of.page) return;
		const doc = this.of.doc;
		const changes = JSON.parse(this.of.page.layoutChanges()) as LayoutChanges;
		const nodes = doc ? drawnNodes(doc) : new Map<string, PenNode>();
		const placed = this.of.placed as Map<string, Placed>;
		const bounds = this.of.bounds as Map<string, Frame>;
		const forget = (root: RootLaid) => {
			for (const [id] of root.items) {
				placed.delete(id);
				bounds.delete(id);
			}
		};
		if (changes.all) return this.laidOutWhole(changes.tops ?? [], nodes, quiet);
		// Whether the map is still in paint order after the changes: items set again keep their place, new ones go last.
		let inOrder = changes.bases.length === 0;
		let last = -1;
		for (const root of this.laid.values()) last = Math.max(last, root.base);
		for (const id of changes.removed) {
			const root = this.laid.get(id);
			if (!root) continue;
			forget(root);
			this.laid.delete(id);
		}
		for (const [id, base] of changes.bases) {
			const root = this.laid.get(id);
			if (!root) continue;
			root.base = base;
			for (const [item, i] of root.items) {
				const was = placed.get(item);
				if (was) placed.set(item, { ...was, order: base + i + 1 });
			}
		}
		for (const { id, base, items, cards } of changes.roots) {
			const was = this.laid.get(id);
			const subset = new Map<string, Placed>();
			const ids: Array<[string, number]> = [];
			for (const [item, x, y, w, h, parent, i, theme, route] of items) {
				let node = nodes.get(item);
				if (!node) continue;
				// An arrow the engine routed after an edit (`reroute_after`): its click shape and bounds follow the route drawn, not the drawing's copy, which the server's answer brings up to date.
				if (route && typeof route.geometry === "string" && route.geometry !== node.geometry) node = { ...node, geometry: route.geometry, ...(route.viewBox ? { viewBox: route.viewBox } : {}) };
				subset.set(item, { node, box: { x, y, w, h }, parent: parent ?? undefined, theme, order: base + i + 1 });
				ids.push([item, i]);
			}
			if (was) {
				const same = was.items.length === ids.length && was.items.every(([item], at) => item === ids[at]![0]);
				if (!same) {
					forget(was);
					inOrder = false;
				}
			} else if (base < last) inOrder = false;
			for (const [item, one] of subset) placed.set(item, one);
			for (const [item, frame] of boundsOf(subset)) bounds.set(item, frame);
			this.laid.set(id, { base, items: ids, cards });
		}
		if (!inOrder) {
			// Put back in paint order: an item came inside a top-level one, or the top level changed order.
			const all = [...placed.values()].sort((a, b) => a.order - b.order);
			placed.clear();
			for (const one of all) placed.set(one.node.id, one);
		}
		if (changes.all || changes.roots.length || changes.removed.length || changes.bases.length) {
			this.cardList = undefined;
			this.of.questions.placedList = undefined;
			this.of.questions.frameIds = undefined;
			// A gesture's or a glide's step re-lays only the arrows it bends: no page's item changes, so the page ids stand.
			if (!quiet) this.of.questions.pageIds = undefined;
			this.of.questions.placedIndex = undefined;
		}
		this.of.drawnDoc = doc;
		if (quiet) return;
		this.of.questions.writeHits();
		this.of.drawn?.();
	}

	/** Everything laid out again (a new drawing, the scheme, a font): read whole, in one list and one of cards. */
	private laidOutWhole(tops: Array<[string, number, number]>, nodes: Map<string, PenNode>, quiet: boolean): void {
		if (!this.of.page) return;
		const placed = new Map<string, Placed>();
		this.laid.clear();
		const roots = tops.map(([id, base, count]) => {
			const root: RootLaid = { base, items: [], cards: [] };
			this.laid.set(id, root);
			return { root, end: base + count };
		});
		let at = 0;
		const rootFor = (order: number) => {
			while (at < roots.length && order > roots[at]!.end) at++;
			return roots[at]?.root;
		};
		for (const [id, x, y, w, h, parent, order, theme] of JSON.parse(this.of.page.layout()) as Array<[string, number, number, number, number, string | null, number, ThemeState]>) {
			const node = nodes.get(id);
			if (!node) continue;
			placed.set(id, { node, box: { x, y, w, h }, parent: parent ?? undefined, theme, order });
			const root = rootFor(order);
			root?.items.push([id, order - root.base - 1]);
		}
		at = 0;
		for (const { order, ...card } of JSON.parse(this.of.page.cards()) as CardGeometry[]) {
			const root = rootFor(order);
			root?.cards.push({ ...card, i: order - root.base - 1 });
		}
		this.of.placed = placed;
		this.of.bounds = boundsOf(placed);
		this.cardList = undefined;
		this.of.questions.placedList = undefined;
		this.of.questions.frameIds = undefined;
		this.of.questions.pageIds = undefined;
		this.of.questions.placedIndex = undefined;
		this.of.drawnDoc = this.of.doc;
		if (quiet) return;
		this.of.questions.writeHits();
		this.of.drawn?.();
	}

	/** Each top-level item as last laid out: its first paint order, its items with their place in it, its cards. */
	private laid = new Map<string, RootLaid>();

	private cardList: CardGeometry[] | undefined;

	/** The markdown cards, in paint order, made from `laid` when first asked for after a change. */
	cards(): CardGeometry[] {
		if (this.cardList) return this.cardList;
		const list: CardGeometry[] = [];
		for (const root of this.laid.values()) for (const { i, ...card } of root.cards) list.push({ ...card, order: root.base + i + 1 });
		return (this.cardList = list);
	}

	/**
	 * The cards as the stage places them. Sent whole only when something but liveness changed (a place, a
	 * picture, a title, the news): a change of which are live alone, which every start and end of a camera
	 * move is for the apps and documents it covers, sends the live paths and nothing else (`setLive`). The
	 * stage's own index over the cards (`index`, in the same order) is taken when given, so none is built here.
	 */
	/** An item's box as laid out, with the item it is inside: what a mark over an agent's edit is drawn at. */
	boxOf(id: string): { x: number; y: number; w: number; h: number; parent?: string | undefined } | undefined {
		const one = this.of.placed.get(id);
		return one ? { x: one.box.x, y: one.box.y, w: one.box.w, h: one.box.h, ...(one.parent ? { parent: one.parent } : {}) } : undefined;
	}

	/**
	 * Words measured by the page's engine (`measure.ts`), kept as the server keeps them: by the fonts
	 * there were (`wordsGeneration`, counted up as fonts are given), kind, width, style and words.
	 */
	private wordSizes = new Map<string, { w: number; h: number }>();

	wordsGeneration = 0;

	/**
	 * Words measured as the server measures them: the engine's own fonts once every file the words
	 * need has settled, else nothing (the estimate, `measure.ts`), and the files are sent for.
	 */
	readonly words: Words = (text, style, maxWidth, markdown, align) => {
		if (!this.of.page) return undefined;
		const key = JSON.stringify([this.wordsGeneration, markdown, align, Math.round(maxWidth * 10), style, text]);
		const known = this.wordSizes.get(key);
		if (known) return known;
		const files = fontFiles(textNeeds(text, style, markdown));
		if (files.some((file) => !this.of.faces.fontsSettled.has(file.key))) {
			this.of.faces.fetchFonts(files);
			return undefined;
		}
		const [w = 0, h = 0] = this.of.page.measure(text, JSON.stringify(style), maxWidth, markdown, align);
		if (this.wordSizes.size >= 8192) this.wordSizes.delete(this.wordSizes.keys().next().value!);
		const size = { w, h };
		this.wordSizes.set(key, size);
		return size;
	};
}
