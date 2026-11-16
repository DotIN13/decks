/**
 * The canvas engine's drawing: the document both engines hold, its layout as the page is told it,
 * and the cards placed on it, carried and landed.
 */
import type { RootCard, RootLaid, StageEngine as Engine } from "./engine.ts";
import { pictureKey } from "./engine-pictures.ts";
import { SHEET_MARGIN } from "./engine-frame.ts";
import { diff, type Frame, type PenDocument, type PenNode, type Placed, type ThemeState, shapeRadius, isShape, shapeKind, shapeOutline } from "@decks/pen";
import type { CardGeometry, DocEdits, SceneCard, PenPreview } from "./types.ts";
import type { Shift } from "../items/glide.ts";
import { drawnNodes, docIndex } from "../drawing/doc-index.ts";
import { boundsOf } from "../drawing/bounds.ts";
import { fontFiles } from "../look/font-files.ts";
import { BoxIndex } from "./spatial.ts";
import { EMPTY } from "./engine-life.ts";

/** What the page engine laid out again since it was last asked (`Page::layout_changes`). */
export type LayoutChanges = {
	all: boolean;
	/** With `all`: every top-level item, its first paint order and how many items it holds. */
	tops?: Array<[string, number, number]>;
	roots: Array<{ id: string; base: number; items: Array<[string, number, number, number, number, string | null, number, ThemeState, { geometry?: string | null; viewBox?: [number, number, number, number] | null }?]>; cards: RootCard[] }>;
	removed: string[];
	bases: Array<[string, number]>;
};

// The drawing both engines hold, and its layout as the page is told it.
/**
 * The drawing to show: the server's, or a copy with words being typed. What changed from the one
 * held is applied to both engines in place: `edits` when they are from the drawing held (the
 * server's delta, a mounted canvas's own edit), else what `diff` finds; edits they cannot apply,
 * and the drawing goes whole.
 */
export function setDoc(e: Engine, doc: PenDocument | undefined, base: string, edits?: DocEdits, own = false): void {
	if (doc === e.doc && base === e.base) return;
	const before = e.doc;
	e.doc = doc;
	e.base = base;
	/*
	 * What a delete hid while it waited is the drawing's business again: the answer has it gone, or,
	 * after an undo, back. The engines are told (below, after the drawing), or they went on hiding a
	 * restored item until the page was loaded again.
	 */
	const unhide = e.viewState.hidden.length > 0;
	e.viewState.hidden = [];
	if (!e.page) {
		e.prefetchFonts();
		return;
	}
	// Where everything is drawn now, glide included: what this drawing's changes glide from.
	// The person's own edit (a key, a field) was drawn by their hand as it was made: nothing to glide.
	const drawnBefore = e.settling || own ? undefined : e.drawnBoxes();
	/*
	 * A drawing that arrives ends any preview: whatever a drag was showing is now the drawing itself.
	 * The page applies a preview to its own copy and takes it back after, so it is taken back before
	 * the edits rather than over them. Lifted items stay lifted, drawn where the drawing now has them,
	 * until the stage puts the gesture down.
	 */
	e.page.setPreview("null");
	e.shown = undefined;
	if (!doc) e.whole(undefined);
	else if (!before) e.whole(doc);
	else {
		const changes = edits && edits.from === before ? edits.edits : diff(before, doc);
		if (changes.length) {
			const text = JSON.stringify(changes);
			try {
				e.page.applyEdits(text);
				e.post({ type: "edits", edits: text });
			} catch {
				e.whole(doc);
			}
		}
	}
	if (unhide) e.sendView();
	e.laidOut();
	e.needFonts();
	// A drop that moved things glides them in from where they were let go, and any other change from where it was drawn, from this very frame.
	const gliding = e.settling ? e.startGlide() : e.glideFrom(drawnBefore);
	if (!gliding) e.draw();
	// A drag of boards alone that was let go: its arrows are now the drawing's own, routed where the boards landed.
	if (e.cardsOnly && !e.carriedCount) e.landCards();
	else if (e.cardsOnly) e.cardsAnswered = true;
	// A gesture let go: the drawing that answers it is here, so what it lifted goes back into the tiles.
	if (e.settling) {
		e.settling = false;
		e.landing = undefined;
		if (e.lifted.size && !e.cardsOnly) e.post({ type: "drop", ids: [...e.lifted] });
	}
}

export function whole(e: Engine, doc: PenDocument | undefined): void {
	const text = doc ? JSON.stringify(doc) : EMPTY;
	e.page?.setDocument(text);
	// The fonts its words name are asked for first, so a worker still to paint its first view hears
	// they are coming before it has the drawing, and waits for them rather than paint it twice.
	e.needFonts();
	e.post({ type: "doc", doc: text, dark: e.scheme === "dark" });
}

/** Whether a top-level item of the drawing frames itself: its own outline or shadow (`paint`'s `has_frame`). */
export function framesItself(doc: PenDocument | undefined, id: string): boolean {
	const node = doc?.children?.find((one) => one.id === id) as { stroke?: unknown; strokeWidth?: unknown; effect?: unknown } | undefined;
	return !!node && ((node.stroke !== undefined && node.stroke !== null) || node.strokeWidth !== undefined || (node.effect !== undefined && node.effect !== null));
}

/**
 * Where each item is drawn now: its laid-out box moved by the glide still in hand, its own shift
 * or the shift of the item it is inside. What a new drawing's changes glide from, so a change
 * that lands mid-glide goes on from where things are rather than jumping back.
 */
export function drawnBoxes(e: Engine): Map<string, Frame> {
	const out = new Map<string, Frame>();
	const shifts = e.glide?.shifts;
	for (const [id, one] of e.placed) {
		let shift: Shift | undefined;
		for (let up: string | undefined = id; up && !shift; up = e.placed.get(up)?.parent) shift = shifts?.get(up);
		out.set(id, shift ? { x: one.box.x + shift.dx, y: one.box.y + shift.dy, w: one.box.w, h: one.box.h } : one.box);
	}
	return out;
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
export function laidOut(e: Engine, quiet = false): void {
	if (!e.page) return;
	const doc = e.doc;
	const changes = JSON.parse(e.page.layoutChanges()) as LayoutChanges;
	const nodes = doc ? drawnNodes(doc) : new Map<string, PenNode>();
	const placed = e.placed as Map<string, Placed>;
	const bounds = e.bounds as Map<string, Frame>;
	const forget = (root: RootLaid) => {
		for (const [id] of root.items) {
			placed.delete(id);
			bounds.delete(id);
		}
	};
	if (changes.all) return e.laidOutWhole(changes.tops ?? [], nodes, quiet);
	// Whether the map is still in paint order after the changes: items set again keep their place, new ones go last.
	let inOrder = changes.bases.length === 0;
	let last = -1;
	for (const root of e.laid.values()) last = Math.max(last, root.base);
	for (const id of changes.removed) {
		const root = e.laid.get(id);
		if (!root) continue;
		forget(root);
		e.laid.delete(id);
	}
	for (const [id, base] of changes.bases) {
		const root = e.laid.get(id);
		if (!root) continue;
		root.base = base;
		for (const [item, i] of root.items) {
			const was = placed.get(item);
			if (was) placed.set(item, { ...was, order: base + i + 1 });
		}
	}
	for (const { id, base, items, cards } of changes.roots) {
		const was = e.laid.get(id);
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
		e.laid.set(id, { base, items: ids, cards });
	}
	if (!inOrder) {
		// Put back in paint order: an item came inside a top-level one, or the top level changed order.
		const all = [...placed.values()].sort((a, b) => a.order - b.order);
		placed.clear();
		for (const one of all) placed.set(one.node.id, one);
	}
	if (changes.all || changes.roots.length || changes.removed.length || changes.bases.length) {
		e.cardList = undefined;
		e.placedList = undefined;
		// A gesture's or a glide's step re-lays only the arrows it bends: no page's item changes, so the page ids stand.
		if (!quiet) e.pageIds = undefined;
		e.placedIndex = undefined;
	}
	e.drawnDoc = doc;
	if (quiet) return;
	e.writeHits();
	e.drawn?.();
}

/** Everything laid out again (a new drawing, the scheme, a font): read whole, in one list and one of cards. */
export function laidOutWhole(e: Engine, tops: Array<[string, number, number]>, nodes: Map<string, PenNode>, quiet: boolean): void {
	if (!e.page) return;
	const placed = new Map<string, Placed>();
	e.laid.clear();
	const roots = tops.map(([id, base, count]) => {
		const root: RootLaid = { base, items: [], cards: [] };
		e.laid.set(id, root);
		return { root, end: base + count };
	});
	let at = 0;
	const rootFor = (order: number) => {
		while (at < roots.length && order > roots[at]!.end) at++;
		return roots[at]?.root;
	};
	for (const [id, x, y, w, h, parent, order, theme] of JSON.parse(e.page.layout()) as Array<[string, number, number, number, number, string | null, number, ThemeState]>) {
		const node = nodes.get(id);
		if (!node) continue;
		placed.set(id, { node, box: { x, y, w, h }, parent: parent ?? undefined, theme, order });
		const root = rootFor(order);
		root?.items.push([id, order - root.base - 1]);
	}
	at = 0;
	for (const { order, ...card } of JSON.parse(e.page.cards()) as CardGeometry[]) {
		const root = rootFor(order);
		root?.cards.push({ ...card, i: order - root.base - 1 });
	}
	e.placed = placed;
	e.bounds = boundsOf(placed);
	e.cardList = undefined;
	e.placedList = undefined;
	e.pageIds = undefined;
	e.placedIndex = undefined;
	e.drawnDoc = e.doc;
	if (quiet) return;
	e.writeHits();
	e.drawn?.();
}

/** The markdown cards, in paint order, made from `laid` when first asked for after a change. */
export function cards(e: Engine): CardGeometry[] {
	if (e.cardList) return e.cardList;
	const list: CardGeometry[] = [];
	for (const root of e.laid.values()) for (const { i, ...card } of root.cards) list.push({ ...card, order: root.base + i + 1 });
	return (e.cardList = list);
}

export function setView(e: Engine, view: { width: number; height: number }): void {
	e.sheet = undefined;
	e.view = view;
	e.fitCanvases();
	e.sendCamera();
	e.writeHits();
	e.draw();
}

/**
 * The canvas the window's size, in device pixels; the engine's
 * surface follows in `frame`. It is drawn again for every camera, as one cheap draw of the tiles
 * and pictures as textured quads, and placed over the window wherever the world has moved
 * (`place`), as the old engine's was: a canvas a margin bigger than the window, slid during a
 * pan rather than drawn, made the worker paint that margin too (120 tiles at rest, not 50).
 */
export function fitCanvases(e: Engine): void {
	/*
	 * Not before there is a canvas to size: a view set first (the shot page sets it before it attaches the
	 * canvas) recorded the size with nothing sized, so the canvas, attached later, was taken as sized and
	 * kept its own CSS size, its backing's in CSS pixels: at a density of 2 the drawing came out twice as big.
	 */
	if (!e.over) return;
	const dpr = Math.min(2, devicePixelRatio || 1);
	// The sheet: the window and a margin round it (`drawRect`).
	const cssW = Math.round(e.view.width * (1 + 2 * SHEET_MARGIN));
	const cssH = Math.round(e.view.height * (1 + 2 * SHEET_MARGIN));
	const w = Math.max(1, Math.round(cssW * dpr));
	const h = Math.max(1, Math.round(cssH * dpr));
	if (w === e.size.w && h === e.size.h) return;
	e.size = { w, h };
	e.drawnAt = undefined;
	for (const canvas of [e.over]) {
		if (!canvas) continue;
		canvas.width = w;
		canvas.height = h;
		canvas.style.width = `${cssW}px`;
		canvas.style.height = `${cssH}px`;
	}
}

/**
 * The stage rectangle the canvas covers: the sheet, the window and `SHEET_MARGIN` of it on each
 * side, placed round the camera and left there while the window stays inside it.
 *
 * The stage scrolls (`camera/scroll-area.ts`): a pan is the browser moving the world, and this
 * canvas with it, on its compositor. So the canvas is not drawn again for each step of a pan, which
 * would put our code back in every frame; it is drawn round the camera once, with room on each
 * side, and again only when the window reaches its edge (`setCamera`), the zoom changes, or the
 * camera rests (`setMoving`), where it is centred again.
 */
export function drawRect(e: Engine): { x: number; y: number; zoom: number; width: number; height: number } {
	const width = Math.round(e.view.width * (1 + 2 * SHEET_MARGIN));
	const height = Math.round(e.view.height * (1 + 2 * SHEET_MARGIN));
	if (!e.sheet || e.sheet.zoom !== e.camera.zoom) {
		const zoom = e.camera.zoom;
		e.sheet = { x: e.camera.x - width / 2 / zoom, y: e.camera.y - height / 2 / zoom, zoom };
	}
	return { x: e.sheet.x, y: e.sheet.y, zoom: e.sheet.zoom, width, height };
}

// Cards: placed, carried by a drag, and landed.
/**
 * The cards as the stage places them. Sent whole only when something but liveness changed (a place, a
 * picture, a title, the news): a change of which are live alone, which every start and end of a camera
 * move is for the apps and documents it covers, sends the live paths and nothing else (`setLive`). The
 * stage's own index over the cards (`index`, in the same order) is taken when given, so none is built here.
 */
export function setCards(e: Engine, cards: readonly SceneCard[], index?: BoxIndex): void {
	const was = e.placedCards;
	e.placedCards = cards;
	if (!e.page) return;
	const key = JSON.stringify(cards.map((b) => [b.path, b.id, b.x, b.y, b.w, b.h, b.news, b.glow, b.picture, b.title, b.kind, b.status, b.corners]));
	const live = JSON.stringify(cards.filter((b) => b.live).map((b) => b.path));
	if (key === e.cardKey) {
		// The same boxes as the ones the index was made for: it answers for these too.
		if (e.indexed === was) e.indexed = cards;
		if (live !== e.liveKey) {
			e.liveKey = live;
			e.cardsSent.calls++;
			e.cardsSent.bytes += live.length;
			e.page.setLive(live);
			// An item let go wants its picture drawn now, and one gone live its hole: a frame, as the whole list gets one.
			e.wantCardPictures();
			e.draw();
		}
		return;
	}
	e.cardKey = key;
	e.liveKey = live;
	// Its item's id and corners too: the engine cuts its picture to the corners, and draws the frame of a carried card from its item (`engine.rs`, `carried_frame`).
	const sent = JSON.stringify(cards.map((b) => ({ path: b.path, id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, live: b.live, news: b.news, glow: b.glow, title: b.title, kind: b.kind, status: b.status, corners: b.corners })));
	e.cardsSent.calls++;
	e.cardsSent.bytes += sent.length;
	e.page.setCards(sent);
	/*
	 * The fonts the engine paints cards' own words in, over and above the drawing's: their titles and a
	 * placeholder's kind (Inter 600, `engine.rs`, `paint_placeholder`, `paint_title`) and a missing card's
	 * why (Inter 500), with the fallbacks their characters need. A canvas whose drawing has no words of
	 * its own was never given them, so no card title or placeholder was ever painted on it.
	 */
	const titles = cards.map((b) => b.title ?? "").join(" ");
	e.fetchFonts(
		fontFiles([
			{ family: "Inter", weight: 600, italic: false, text: `${titles} Card App Document Board · missing` },
			...(cards.some((b) => b.kind === "missing") ? [{ family: "Inter", weight: 500, italic: false, text: "Studio has no copy of this card yet, and no harness of yours with it is in reach." }] : []),
		]),
	);
	const boxes = cards.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join("|");
	e.indexed = cards;
	if (boxes !== e.cardBoxes) {
		e.cardBoxes = boxes;
		e.cardIndex = index ?? new BoxIndex(cards.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })));
		e.indexNodes();
		e.writeHits();
	}
	/*
	 * A card whose picture changed (a new revision) is asked for again, against the card's own
	 * address: the one fetched carries a rung (`&w=480`). The old picture stays drawn until the new
	 * one replaces it.
	 */
	e.cardByKey = new Map(cards.map((card) => [pictureKey(card.path), card]));
	for (const card of cards) {
		const key = pictureKey(card.path);
		const asked = e.picturesAsked.get(key);
		if (asked && card.picture && asked.source !== card.picture) {
			e.picturesAsked.delete(key);
			e.heldWidth.delete(key);
		}
		if (!(e.picturesAsked.get(key)?.size ?? 0) && !e.heldWidth.get(key)) e.unpictured.add(key);
	}
	// A card taken off the canvas lets go of its picture on the GPU: nothing else ever did.
	if (e.pictureBytes.size > 0) {
		const here = new Set(cards.map((card) => pictureKey(card.path)));
		for (const key of [...e.pictureBytes.keys()]) {
			if (here.has(key)) continue;
			e.pictureBytes.delete(key);
			e.heldWidth.delete(key);
			e.picturesAsked.delete(key);
			e.page?.forgetPicture(key);
		}
	}
	e.wantCardPictures();
	e.draw();
}

/** An item's box as laid out, with the item it is inside: what a mark over an agent's edit is drawn at. */
export function boxOf(e: Engine, id: string): { x: number; y: number; w: number; h: number; parent?: string | undefined } | undefined {
	const one = e.placed.get(id);
	return one ? { x: one.box.x, y: one.box.y, w: one.box.w, h: one.box.h, ...(one.parent ? { parent: one.parent } : {}) } : undefined;
}

/**
 * The boards a drag carries, and how far. An arrow with an end on one bends with it: the gesture's
 * preview is sent again with the boards where they are now, or, when only boards are dragged, a
 * preview of nothing but them. Such a drag's arrows stay as last routed when it is let go, until
 * the server's drawing comes back routed to where the boards landed (`setDoc`), or two seconds pass.
 */
export function carry(e: Engine, paths: readonly string[], offset: { dx: number; dy: number }): void {
	e.carriedBy = { dx: offset.dx, dy: offset.dy };
	e.carriedCount = paths.length;
	e.carriedPaths = [...paths];
	if (!e.page) return;
	e.page.carry(JSON.stringify(paths), offset.dx, offset.dy);
	if (paths.length) {
		// A drag of cards is a gesture too: a glide still in hand would put its arrows down under it.
		e.endGlide();
		e.cardsAnswered = false;
		if (e.shown === undefined) {
			e.cardsOnly = true;
			clearTimeout(e.cardsLanding);
		}
		e.lift(e.page.setPreview(e.shown ?? "[]"));
		// A card that frames itself (its own outline or shadow, painted with the drawing) is left out of the tiles while it is carried, once: the stage draws its frame round its picture where the drag has it (`engine.rs`, `carried_frame`), and it goes back with the rest when the drag lands.
		const framed = paths
			.map((path) => e.placedCards.find((card) => card.path === path)?.id)
			.filter((id): id is string => !!id && !e.lifted.has(id) && framesItself(e.doc, id));
		if (framed.length) e.lift(JSON.stringify(framed));
		e.laidOut(e.shown === undefined || e.moveOnly);
	} else if (e.cardsOnly && e.shown === undefined) {
		clearTimeout(e.cardsLanding);
		// The drawing that answers the drop came while the boards were held where they were dropped (`editor/core/gesture.ts`, `holdPages`): its arrows are routed already.
		if (e.cardsAnswered) e.landCards();
		else e.cardsLanding = setTimeout(() => e.landCards(), 2000);
	}
	e.draw();
}

export function landCards(e: Engine): void {
	clearTimeout(e.cardsLanding);
	if (!e.cardsOnly) return;
	e.cardsOnly = false;
	if (e.shown !== undefined || !e.page) return;
	e.page.setPreview("null");
	if (e.lifted.size) e.post({ type: "drop", ids: [...e.lifted] });
	e.laidOut();
	e.draw();
}

/**
 * What `setPreview` newly lifted (its answer): the arrows it bent, and a shape's outline resized
 * with it. The worker leaves them out of its tiles too, and they are put down with the rest.
 */
export function lift(e: Engine, answer: string): void {
	const bent = JSON.parse(answer) as string[];
	if (!bent.length) return;
	for (const id of bent) e.lifted.add(id);
	e.post({ type: "lift", ids: bent });
}

/**
 * Items a gesture is moving or reshaping: lifted out of the worker's tiles and drawn here each
 * frame, moved and with the fields shown, until the gesture ends (`undefined`) and the saved
 * drawing has been painted into the tiles again.
 */
export function preview(e: Engine, moving: ReadonlyMap<string, PenPreview> | undefined): void {
	// A gesture's own preview ends a glide still in hand: what it shows is where things are now.
	e.endGlide();
	e.showPreview(moving);
}

export function showPreview(e: Engine, moving: ReadonlyMap<string, PenPreview> | undefined): void {
	if (!e.page) return;
	// Only moved: nothing the stage reads of the layout changes but the arrows bent, so it is told at the end.
	// A fade in (`opacity` alone) changes no layout either.
	e.moveOnly = !!moving?.size && [...moving.values()].every((one) => one.w === undefined && one.h === undefined && one.radius === undefined && (!one.set || Object.keys(one.set).every((key) => key === "opacity")));
	if (moving?.size) {
		const fresh = [...moving.keys()].filter((id) => !e.lifted.has(id));
		if (fresh.length) {
			for (const id of fresh) e.lifted.add(id);
			e.page.lift(JSON.stringify(fresh));
			e.post({ type: "lift", ids: fresh });
		}
		const first = moving.values().next().value;
		e.offset = { dx: first?.dx ?? 0, dy: first?.dy ?? 0 };
		// The arrows joined to what moves bend with it, routed by the page's engine: lifted out of the tiles too.
		e.shown = JSON.stringify(e.withOutlines(moving));
		e.cardsOnly = false;
		e.settling = false;
		e.lift(e.page.setPreview(e.shown));
	} else {
		e.shown = undefined;
		e.cardsOnly = false;
		e.page.setPreview("null");
		e.offset = { dx: 0, dy: 0 };
		if (e.lifted.size) e.post({ type: "drop", ids: [...e.lifted] });
	}
	e.laidOut(e.moveOnly);
	e.draw();
}

/**
 * A library shape being resized or rounded shows its outline as the saved drawing will have it
 * (`fitShapes`): sized to the shape, and built at that size by its kind (`build`) so a curve stays
 * a circle, rather than left at its old size. Its radius is the shape's own, not a frame corner.
 */
export function withOutlines(e: Engine, moving: ReadonlyMap<string, PenPreview>): Array<[string, PenPreview]> {
	const list = [...moving];
	if (!e.doc) return list;
	for (const [at, [id, change]] of list.entries()) {
		if (change.w === undefined && change.h === undefined && change.radius === undefined) continue;
		const node = docIndex(e.doc).get(id)?.node;
		const outline = node && isShape(node) ? shapeOutline(node) : undefined;
		if (!node || !outline) continue;
		const w = change.w ?? node.width;
		const h = change.h ?? node.height;
		if (typeof w !== "number" || typeof h !== "number") continue;
		const set: Record<string, unknown> = { x: 0, y: 0, width: w, height: h };
		const build = shapeKind(node.metadata?.kind)?.build;
		if (build) {
			const metadata = change.radius === undefined ? node.metadata : ({ ...node.metadata, radius: change.radius ?? undefined } as PenNode["metadata"]);
			set.geometry = build(w, h, shapeRadius({ ...node, width: w, height: h, metadata }) ?? 0);
			set.viewBox = [0, 0, w, h];
		}
		if (change.radius !== undefined) {
			const { radius: _, ...rest } = change;
			list[at] = [id, rest];
		}
		list.push([outline.id, { dx: 0, dy: 0, set }]);
	}
	return list;
}

/**
 * A picture of what a drag carries, for the ghost a drag over a card shows (`CanvasView.tsx`): the lifted
 * items drawn alone for one frame and copied off the canvas in the same task, then the canvas drawn
 * whole again. `rect` is where they lay on screen before the drag; they are now the drag's offset on.
 */
export function cutFromCarried(e: Engine, rect: { left: number; top: number; width: number; height: number }): HTMLCanvasElement | undefined {
	const canvas = e.over;
	if (!e.page || !canvas || !e.lifted.size || rect.width < 1 || rect.height < 1) return undefined;
	const drawn = e.drawRect();
	e.page.frameLifted(drawn.x, drawn.y, drawn.zoom, Math.min(2, devicePixelRatio || 1), drawn.width, drawn.height);
	e.drawnAt = { x: drawn.x, y: drawn.y, zoom: drawn.zoom };
	e.place();
	const at = canvas.getBoundingClientRect();
	if (!at.width || !at.height) {
		e.drawNow();
		return undefined;
	}
	const sx = canvas.width / at.width;
	const sy = canvas.height / at.height;
	const left = rect.left + e.offset.dx * e.camera.zoom - at.left;
	const top = rect.top + e.offset.dy * e.camera.zoom - at.top;
	const out = document.createElement("canvas");
	out.width = Math.max(1, Math.round(rect.width * sx));
	out.height = Math.max(1, Math.round(rect.height * sy));
	out.getContext("2d")?.drawImage(canvas, left * sx, top * sy, rect.width * sx, rect.height * sy, 0, 0, out.width, out.height);
	// Drawn whole again before the browser paints, whatever frame this is.
	e.drawNow();
	return out;
}

/** The lifted items drawn or not, while a ghost of them stands in. */
export function showCarriedLayer(e: Engine, on: boolean): void {
	e.page?.showLifted(on);
	e.draw();
}
