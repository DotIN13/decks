import { copySharedCanvas } from "../canvas/copy-shared.ts";
import { canvasOfPath } from "./move-home.ts";
import { basename, dirname } from "node:path";
import { apply, ARROW, baseTheme, expandVariables, ids, placements, shortVariables, updateWarnings, walk, warnings, type Op, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import { canvasFile } from "../canvas/canvas-files.ts";
import { boardOf, CARD_ITEM, type ReadMore } from "../canvas/pens.ts";
import { canvasFolder, isCardPath, pageName } from "@decks/hub/layout";
import { existsSync } from "node:fs";
import { serverText } from "../canvas/text.ts";
import { blockers, cornerOf, GAP, placeBy, roomFor, slug, stepClear, type StepWay } from "@decks/deck-kit";
import type { ShotFormat, ShotOf } from "../canvas/shots.ts";
import { fitOn } from "./fit.ts";
import { documentItemPath } from "../docs/item-path.ts";
import { shootOn } from "./shoot.ts";
import type { Verbs as Stage } from "@decks/sdk";
import type { VerbContext } from "./context.ts";
import { freeSpot, type Side } from "./space.ts";
import { exportPage } from "./export.ts";
import { resolveInDeck } from "../deck/roots.ts";
import { heldClip, holdClip, pasteItems } from "./paste.ts";
import { itemFinder, linkFromItem, linkToItem } from "./link-item.ts";

/**
 * An agent's shape with no colour given gets the colours the canvas tools give theirs, the drawing's
 * own light/dark Decks variables (`$decks-fill-slate`, … : `@decks/pen` colors.ts, defined in the same
 * edit by `CanvasPens.edit`), so it reads on a dark canvas too. Only an item at the top level with
 * neither a fill nor a stroke: a rectangle, an ellipse, an icon or an arrow, and a frame with nothing in it
 * and no metadata (a frame holding items is a layout as often as a box, and a card or a library
 * shape is drawn its own way). Anything given a colour keeps it.
 */
function colourDefaults(node: Record<string, unknown>): void {
	if (node.fill !== undefined || node.stroke !== undefined) return;
	if (node.type === "rectangle") node.fill = "$decks-fill-slate";
	else if (node.type === "ellipse") node.fill = "$decks-fill-sky";
	else if (node.type === "icon") node.fill = "$decks-text";
	else if ((node.metadata as { type?: unknown } | undefined)?.type === ARROW) node.stroke = "$decks-line";
	else if (node.type === "frame" && node.metadata === undefined && !(Array.isArray(node.children) && node.children.length)) {
		node.fill = "$decks-surface";
		node.stroke = "$decks-line-subtle";
		node.strokeWidth ??= 1;
	}
}

/**
 * The canvas calls: everything on one canvas, cards included, read and changed as items.
 *
 * A card on a canvas is pen's own `browser` item tagged `{ type: "decks.card", path }`
 * (`canvas/pens.ts`); here it reads and is written as `{ type: "card", card: <path>, width? }`,
 * and anywhere an item's id is taken a card's path is taken too. Every call names its canvas or
 * means `decks.here()`; none changes which canvas anybody is on. Every change is one edit of the
 * canvas's file, all of a batch or none of it.
 *
 * The item calls (read, insert, update, replace, delete, move, copy, variables, batch) take
 * `{ frame: "frames/<name>" }` instead to act on a frame file, with the same items and answers; the
 * change shows on every canvas placing the frame. A frame holds drawn items, never a card.
 */

/** A read's variables also short (`shortVariables`: `"#hex"`, `16`, `{ light, dark }`), as `canvas.variables` takes them, under `values`. */
const withValues = (read: { variables?: unknown; themes?: unknown }) => (read.variables ? { values: shortVariables(read as Pick<PenDocument, "variables" | "themes">) } : {});


type Corner = { x1: number; y1: number } | { x: number; y: number };
/** What an item call acts on: a canvas by its folder name, or a frame file by its ref. */
type Target = { canvas: string; frame?: undefined } | { frame: string; canvas?: undefined };
/** The options every item call takes to say what it acts on. */
type On = { canvas?: string; frame?: string };
type ItemIn = { type: string; [key: string]: unknown };
type CanvasOpIn =
	| { op: "insert"; item: ItemIn; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }
	| { op: "update"; id: string; set?: Record<string, unknown>; at?: Corner; size?: { w?: number; h?: number } }
	| { op: "replace"; id: string; item: ItemIn }
	| { op: "delete"; id: string }
	| { op: "move"; id: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }
	| { op: "copy"; id: string; as?: string; at?: Corner; parent?: string | null }
	| { op: "variables"; set: Record<string, unknown>; themes?: Record<string, string[]> | null };

/** A pen item as a caller reads it: a card as `{ type: "card", card }`, a link chip as `{ type: "link", to, title }`, everything else as pen has it. */
export function toItem(node: Record<string, unknown>): Record<string, unknown> {
	const link = linkToItem(node);
	if (link) return link;
	const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]).map(toItem) : undefined;
	const path = boardOf(node as unknown as PenNode);
	if (path) {
		const { type: _type, url: _url, metadata: _metadata, name, children: _children, ...rest } = node;
		return { type: "card", ...rest, card: path, ...(typeof name === "string" ? { title: name } : {}), ...(children ? { children } : {}) };
	}
	return { ...node, ...(children ? { children } : {}) };
}

export function canvasVerbs(ctx: VerbContext): Pick<Stage, "canvas"> {
	const { service, agent, notes, needPens, canvasOf, canvasRow } = ctx;
	const measure = serverText.measure;

	/** A canvas, or a frame file when the caller says `frame`; both at once is a mistake worth saying. */
	const targetOf = (options?: On): Target => {
		const frame = options?.frame;
		if (frame === undefined || frame === null) return { canvas: canvasOf(options?.canvas) };
		if (options?.canvas !== undefined && options.canvas !== null) throw new Error("Say a canvas or a frame, not both: { frame } edits the frame file itself, and that shows on every canvas placing it.");
		if (typeof frame !== "string" || !frame.trim()) throw new Error('frame names a frame file, as in { frame: "frames/agent-card" }.');
		// `frames/<name>`: the agent's own canvas's copy when it has one (`CanvasPens.frameOn`), else the deck's.
		let home: string | undefined;
		try {
			home = canvasOf(undefined);
		} catch {
			/* no canvas of its own: the deck's frames/ */
		}
		return { frame: needPens().files.framePen(needPens().files.frameOn(frame, home)).shown };
	};

	/**
	 * What a target holds, read fresh, and how to lay a version of it out as the canvas would: what
	 * `beside` and every answered box are measured on. A frame's refs resolve from its own folder.
	 */
	const surfaceOf = (target: Target): { doc: PenDocument; layout: (doc: PenDocument) => Map<string, Placed> } => {
		const pens = needPens();
		const lay = (doc: PenDocument, imported: PenDocument) => placements(imported, { theme: baseTheme(doc, "light"), measure });
		if (target.frame !== undefined) {
			const frame = pens.files.framePen(target.frame);
			return { doc: frame.doc, layout: (doc) => lay(doc, frame.imported(doc)) };
		}
		const entry = pens.get(target.canvas);
		if (entry.error) throw new Error(`${entry.error}. Fix the file, or replace it whole, before editing it.`);
		return { doc: entry.doc, layout: (doc) => lay(doc, pens.files.withImported(target.canvas, doc)) };
	};

	/** The canvas the ops being turned into pen's are for, if a canvas: a board named from elsewhere is its copy there. */
	let onCanvas: string | undefined;
	/** What an item's document path was taken as (`docs/item-path.ts`): said with the call's notes. */
	const docNotes: string[] = [];
	/** A document item's path as the deck names its file, found or made in the canvas's files; the note says what was done. */
	const documentPath = (given: string): string => {
		const { path, note } = documentItemPath(service.deckPath(), onCanvas, given, { make: true });
		if (note) docNotes.push(note);
		return path;
	};
	/** A board's path as this canvas holds it: its own copy of a board from elsewhere (`CanvasPens.copyOf`). */
	const ownOn = (path: string): string => (onCanvas ? needPens().cards.copyOf(onCanvas, path) : path);

	/** An item's id, or a board's path on this document turned into its item's id. */
	const idIn = (doc: PenDocument, ref: unknown, what = "id"): string => {
		if (typeof ref !== "string" || !ref.trim()) throw new Error(`${what} names an item: its id from decks canvas read, or a board's path.`);
		const own = ownOn(ref);
		for (const node of walk(doc.children)) if (boardOf(node) === ref || boardOf(node) === own) return node.id;
		return ref;
	};

	/** A caller's item as pen's: a board becomes its `browser` item, sized as its file says unless told. */
	/** Whether a deck path is a file already, recorded or not. */
	const existsIn = (path: string): boolean => existsSync(resolveInDeck(service.deckPath(), path) ?? "");
	const fromItem = (raw: unknown, taken: Set<string>, frame?: string): Record<string, unknown> => {
		if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") throw new Error('An item has a type: { type: "note", content: "…" }, or { type: "card", card: "canvases/<canvas>/cards/plan" }.');
		let item = raw as Record<string, unknown>;
		/*
		 * A card from its HTML, `{ type: "card", html, title?, width?, height? }`: written to the canvas's own
		 * `cards/` first, named from its title, then placed by its file like any other.
		 */
		if (item.type === "card" && typeof item.html === "string" && item.card === undefined) {
			if (frame || !onCanvas) throw new Error("A card from HTML is written into a canvas's own cards/: name a canvas, not a frame.");
			const { html, title: given, width, height, ...others } = item as Record<string, unknown> & { html: string };
			const title = typeof given === "string" && given.trim() ? given.trim() : (/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "Card");
			const size = { w: typeof width === "number" ? Math.round(width) : 600, ...(typeof height === "number" ? { h: Math.round(height) } : {}) };
			const base = slug(title, 48) || "card";
			// A folder of its own, `cards/<title>/index.html`, for what the card keeps beside it.
			let path = `${canvasFolder(onCanvas)}/cards/${base}/index.html`;
			for (let n = 2; service.fileBoard(path) || existsIn(path); n++) path = `${canvasFolder(onCanvas)}/cards/${base}-${n}/index.html`;
			const head = [/<title>/i.test(html) ? "" : `<title>${title.replace(/</g, "&lt;")}</title>`, /<meta\s+name=["'](?:card|board)["']/i.test(html) ? "" : `<meta name="card" content='${JSON.stringify(size)}' />`].filter(Boolean).join("\n");
			service.writeCard(path, `${head}${head ? "\n" : ""}${html.trim()}\n`);
			item = { ...others, type: "card", card: path, ...(typeof width === "number" ? { width } : {}), ...(typeof height === "number" ? { height } : {}) };
		}
		/*
		 * An app or a document, by name: `{ type: "app", app: "<name>" }` and `{ type: "document", path }` are
		 * the items that show one (`browser` items tagged `decks.app` and `decks.document`, `@decks/canvas`
		 * `itemKind`), with no file of their own; sized as their boards were.
		 */
		if (item.type === "app" || item.type === "document") {
			if (frame) throw new Error(`${frame} is a frame, and a frame holds drawn items: place the ${item.type} on a canvas, beside the frame.`);
			const { type: kind, app, path, title, width, height, ...others } = item as Record<string, unknown>;
			const named = typeof title === "string" && title.trim() ? title.trim() : undefined;
			if (kind === "app") {
				const name = typeof app === "string" ? app.trim() : "";
				if (!name) throw new Error('An app item names its app: { type: "app", app: "<name>" }. decks apps list names them.');
				if (service.apps && !service.apps.exists(name)) throw new Error(`There is no app called ${JSON.stringify(name)}. decks apps list names them.`);
				const label = named ?? (service.apps ? service.apps.state(name).title : name);
				return { ...others, type: "browser", name: label, width: typeof width === "number" ? width : 1100, height: typeof height === "number" ? height : 760, metadata: { type: "decks.app", name } };
			}
			const file = typeof path === "string" ? documentPath(path.trim()) : "";
			if (!file) throw new Error('A document item names its file as the deck does: { type: "document", path: "canvases/<canvas>/files/notes.md" }.');
			return { ...others, type: "browser", name: named ?? basename(file), width: typeof width === "number" ? width : 1000, height: typeof height === "number" ? height : 1100, metadata: { type: "decks.document", path: file } };
		}
		// A link to something in the deck, `{ type: "link", to }`: the chip the file keeps (`link-item.ts`).
		if (item.type === "link") return linkFromItem(ctx, item as Record<string, unknown>, itemFinder(ctx, () => onCanvas));
		// A document item given as it reads back (`browser`, tagged `decks.document`): its path as the deck names the file, the same way.
		if (item.type === "browser" && (item.metadata as { type?: unknown; path?: unknown } | undefined)?.type === "decks.document" && typeof (item.metadata as { path?: unknown }).path === "string") {
			const meta = item.metadata as { path: string };
			item = { ...item, metadata: { ...meta, path: documentPath(meta.path.trim()) } };
		}
		if (item.type === "board") throw new Error("Boards are from before cards, and a canvas no longer takes one: decks card create makes a card, and decks file read reads an old board's file.");
		// What a read adds and no file keeps (`read.ts`), so an item read and written back is the item.
		const { box: _box, clipped: _clipped, childCount: _childCount, outline: _outline, inside: _inside, children: kids, ...rest } = item;
		const children = Array.isArray(kids) ? kids.map((one) => fromItem(one, taken, frame)) : undefined;
		if (item.type !== "card") return { ...rest, ...(children ? { children } : {}) };
		// A card is placed by its file in a canvas's `cards/`: `{ type: "card", card: "canvases/<canvas>/cards/sales" }`.
		if (frame) throw new Error(`${frame} is a frame, and a frame holds drawn items, not cards: place the card on a canvas, beside the frame.`);
		const { type: _type, card: named, title: _title, ...own } = rest as Record<string, unknown>;
		if (typeof named !== "string" || !named) throw new Error('A card item names its folder: { type: "card", card: "canvases/<canvas>/cards/sales" }.');
		// Its folder or the folder's index.html, either way.
		const card = /\.html$/i.test(named) ? named : `${named.replace(/\/+$/, "")}/index.html`;
		if (!isCardPath(card)) throw new Error(`${named} is not a card: a card is a folder in a canvas's cards/, with its index.html in it.`);
		const file = service.fileBoard(card);
		if (!file) throw new Error(`There is no card ${card} in the deck. decks card create makes one; decks card list lists them.`);
		let id = typeof own.id === "string" && own.id ? own.id : undefined;
		if (!id) {
			const base = slug(pageName(card), 40) || "card";
			id = base;
			for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
		}
		taken.add(id);
		return { ...own, id, type: "browser", name: file.title, url: `../../${card}`, width: own.width ?? file.w, height: own.height ?? file.h, metadata: { type: CARD_ITEM, path: card }, ...(children ? { children } : {}) };
	};

	/** Where an op puts its item: a corner, or beside or below another item on the document as it is now. */
	const placeOf = (doc: PenDocument, placed: Map<string, Placed>, op: { at?: unknown; beside?: string; below?: string }): { x1: number; y1: number } | undefined => {
		const given = [op.at !== undefined && op.at !== null, !!op.beside, !!op.below].filter(Boolean).length;
		if (given > 1) throw new Error("Say one place: at, beside or below.");
		const ref = op.beside ?? op.below;
		if (ref) {
			const id = idIn(doc, ref, op.beside ? "beside" : "below");
			const box = placed.get(id)?.box;
			if (!box) throw new Error(`Nothing called ${ref} is on this canvas to go ${op.beside ? "beside" : "below"}: decks canvas read lists what is.`);
			return placeBy(box, op.beside ? "beside" : "below");
		}
		return cornerOf(op.at);
	};

	/**
	 * Turn the caller's ops into pen's, one at a time against the document as the earlier ones left it,
	 * so a later op can be beside an item an earlier one made. Nothing is written here.
	 */
	const translate = (target: Target, ops: readonly CanvasOpIn[]): { penOps: Op[]; sized: Array<{ path: string; w?: number; h?: number }>; deleted: Set<string>; placedFor: string[]; warned: string[] } => {
		const surface = surfaceOf(target);
		const frame = target.frame;
		onCanvas = target.canvas;
		let doc = surface.doc;
		const theme = baseTheme(doc, "light");
		const penOps: Op[] = [];
		const sized: Array<{ path: string; w?: number; h?: number }> = [];
		const deleted = new Set<string>();
		const placedFor: string[] = [];
		/** What an op asked for that pen has no field for, or that Decks keeps and does not draw: said, never refused. */
		const warned: string[] = [];
		const typeOf = (id: string) => [...walk(doc.children)].find((one) => one.id === id)?.type;
		/** What a top-level item placed on the canvas must keep clear of: every top-level item but arrows (mostly empty canvas) and itself. */
		const inWay = (placed: Map<string, Placed>, except?: string) =>
			doc.children.filter((one) => one.metadata?.type !== ARROW && one.id !== except).flatMap((one) => {
				const box = placed.get(one.id)?.box;
				return box ? [{ id: boardOf(one) ?? one.id, x: box.x, y: box.y, w: box.w, h: box.h }] : [];
			});
		/**
		 * Aim, then step clear (`@decks/deck-kit`, `stepClear`): a top-level item aimed `beside` or
		 * `below` another, or nowhere (beside the newest), goes on the same way past whatever is in the
		 * way; one put at a corner the caller named stays there, and what it covers is said. Its size is
		 * read by placing it at the aim first, so a note or a text is measured as it will be drawn.
		 */
		const land = (pen: Op & { box?: { x1: number; y1: number } }, id: string | undefined, label: string, way: StepWay | undefined, placed: Map<string, Placed>, except?: string): Op => {
			const aim = pen.box;
			if (!aim) return pen;
			const after = apply(doc, [pen], { theme, measure }).doc;
			// An item given no id takes one as it is applied: the top-level item that was not there before.
			const before = new Set(doc.children.map((one) => one.id));
			const which = id ?? after.children.find((one) => !before.has(one.id))?.id;
			const box = which ? surface.layout(after).get(which)?.box : undefined;
			if (!box) return pen;
			if (!id && label === "the new item" && which) label = which;
			const size = { w: box.w, h: box.h };
			const items = inWay(placed, except);
			if (!way) {
				const covers = blockers(items, aim, size, 0);
				if (covers.length) placedFor.push(`Warning: ${label} sits over ${covers.map((one) => one.id).join(", ")}: a corner given with at is kept as given. Leave at out, or use beside or below, to have it land clear.`);
				return pen;
			}
			const spot = stepClear(items, size, aim, way);
			if (!spot.past) return pen;
			placedFor.push(`Warning: ${label} was aimed at x1 ${aim.x1}, y1 ${aim.y1}, which was taken: it went on ${way === "down" ? "down" : "right"} past ${spot.past} item${spot.past === 1 ? "" : "s"}, to x1 ${spot.x1}, y1 ${spot.y1}.`);
			return { ...pen, box: { ...pen.box, x1: spot.x1, y1: spot.y1 } } as Op;
		};
		const warn = (pen: Op) => {
			const said =
				pen.op === "insert" || pen.op === "replace"
					? warnings(pen.node)
					: pen.op === "update"
						? updateWarnings(pen.id.includes("/") ? undefined : typeOf(pen.id), pen.set ?? {})
						: [];
			const where = ops.length > 1 ? `Op ${penOps.length + 1} (${pen.op}): ` : "";
			for (const one of said) warned.push(`${where}${one}`);
		};
		if (!Array.isArray(ops) || ops.length === 0) throw new Error('A batch is a list of ops: [{ op: "insert", item: { type: "note", content: "…" } }].');
		ops.forEach((op, index) => {
			const where = ops.length > 1 ? `Op ${index + 1} (${op?.op ?? "?"}): ` : "";
			try {
				const placed = surface.layout(doc);
				let pen: Op;
				// pen.dev's own form (what the canvas editor sends): taken as it is, with a board's path for an id.
				const raw = op as unknown as Record<string, unknown>;
				if (raw && ("node" in raw || "box" in raw)) {
					const given = { ...raw } as Record<string, unknown>;
					if (typeof given.id === "string") given.id = idIn(doc, given.id);
					if (typeof given.parent === "string") given.parent = idIn(doc, given.parent, "parent");
					if (given.node && ["card", "app", "document", "board"].includes(String((given.node as { type?: unknown }).type))) given.node = fromItem(given.node, ids(doc), frame);
					pen = given as unknown as Op;
					warn(pen);
					doc = apply(doc, [pen], { theme, measure }).doc;
					penOps.push(pen);
					return;
				}
				switch (op?.op) {
					case "insert": {
						const node = fromItem(op.item, ids(doc), frame);
						if (!agent.person && (op.parent === undefined || op.parent === null)) colourDefaults(node);
						const path = boardOf(node as unknown as PenNode);
						if (path) {
							const there = [...walk(doc.children)].find((one) => boardOf(one) === path || boardOf(one) === ownOn(path));
							if (there) throw new Error(`${path} is already on this canvas, as ${there.id}: move it with decks canvas move.`);
						}
						let box = placeOf(doc, placed, op);
						// An arrow with both ends is drawn between them: there is no corner to choose.
						const meta = (node as { metadata?: { type?: unknown; from?: unknown; to?: unknown } }).metadata;
						const joined = meta?.type === ARROW && meta.from !== undefined && meta.to !== undefined;
						const top = op.parent === undefined || op.parent === null;
						const label = path ?? (typeof node.id === "string" ? node.id : "the new item");
						let way: StepWay | undefined = op.beside ? "right" : op.below ? "down" : undefined;
						let newest: PenNode | undefined;
						let unsaid = false;
						if (!box && !joined && top) {
							// Nowhere said: beside the newest thing on the canvas, and the caller is told so.
							newest = [...doc.children].reverse().find((one) => one.metadata?.type !== ARROW && placed.get(one.id));
							box = newest ? placeBy(placed.get(newest.id)!.box, "beside") : { x1: 0, y1: 0 };
							way = "right";
							unsaid = true;
						}
						pen = { op: "insert", node: node as Op extends { node: infer N } ? N : never, ...(op.parent !== undefined ? { parent: op.parent } : {}), ...(op.index !== undefined ? { index: op.index } : {}), ...(box ? { box } : {}) } as Op;
						if (top && !joined) pen = land(pen as Op & { box?: { x1: number; y1: number } }, typeof node.id === "string" ? node.id : undefined, label, way, placed);
						if (unsaid) {
							const at = (pen as { box?: { x1: number; y1: number } }).box!;
							placedFor.push(`Warning: no place was given, so ${label} went ${newest ? `beside ${boardOf(newest) ?? newest.id}` : "at the canvas's corner"}, at x1 ${at.x1}, y1 ${at.y1}: say where with at, beside or below.`);
						}
						break;
					}
					case "update": {
						const id = idIn(doc, op.id);
						const node = [...walk(doc.children)].find((one) => one.id === id);
						const path = node ? boardOf(node) : undefined;
						const set: Record<string, unknown> = { ...(op.set ?? {}) };
						// A card item pointed at another card: `set: { card: <path> }`.
						if (path && typeof set.card === "string") {
							const file = isCardPath(set.card) ? service.fileBoard(set.card) : undefined;
							if (!file) throw new Error(`There is no card ${set.card} in the deck.`);
							set.url = `../../${set.card}`;
							set.metadata = { ...(node?.metadata ?? {}), type: CARD_ITEM, path: set.card };
							set.name = file.title;
							delete set.card;
						}
						if (op.size) {
							// A board is held to the sizes a resize always allowed: a resize is not the place to find a typo.
							const round = (value: unknown, low: number, high: number) => (typeof value === "number" && Number.isFinite(value) ? (path ? Math.min(high, Math.max(low, Math.round(value))) : Math.round(value)) : undefined);
							const w = round(op.size.w, 320, 4000);
							const h = round(op.size.h, 200, 8000);
							if (w === undefined && h === undefined) throw new Error("size is a width, a height or both, as numbers: { w: 1000, h: 700 }.");
							if (w !== undefined) set.width = w;
							if (h !== undefined) set.height = h;
							if (path) sized.push({ path, ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) });
						}
						/*
						 * A board the person resized on the canvas (the app sends its new width and height as the
						 * item's own fields) keeps that size in its file too, as a resize by `size` does.
						 */
						if (path && !op.size && agent.person && (typeof set.width === "number" || typeof set.height === "number")) {
							const clamp = (value: unknown, low: number, high: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : undefined);
							const w = clamp(set.width, 320, 4000);
							const h = clamp(set.height, 200, 8000);
							sized.push({ path, ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) });
						}
						const box = cornerOf(op.at);
						pen = { op: "update", id, set, ...(box ? { box } : {}) };
						break;
					}
					case "replace": {
						const id = idIn(doc, op.id);
						const taken = ids(doc);
						taken.delete(id);
						const node = fromItem({ ...op.item, id }, taken, frame);
						pen = { op: "replace", id, node: node as never };
						break;
					}
					case "delete": {
						const id = idIn(doc, op.id);
						deleted.add(id);
						pen = { op: "delete", id };
						break;
					}
					case "move": {
						const id = idIn(doc, op.id);
						const box = placeOf(doc, placed, op);
						pen = { op: "move", id, ...(op.parent !== undefined ? { parent: op.parent === null ? null : idIn(doc, op.parent, "parent") } : {}), ...(op.index !== undefined ? { index: op.index } : {}), ...(box ? { box } : {}) };
						// Moved beside or below another at the top level: aimed there, then on past what is in the way, as an insert is.
						const moving = doc.children.find((one) => one.id === id);
						if (box && moving && (op.parent === undefined || op.parent === null) && (op.beside || op.below)) pen = land(pen as Op & { box?: { x1: number; y1: number } }, id, boardOf(moving) ?? id, op.beside ? "right" : "down", placed, id);
						break;
					}
					case "copy": {
						const id = idIn(doc, op.id);
						const node = [...walk(doc.children)].find((one) => one.id === id);
						if (node && boardOf(node)) throw new Error(`${op.id} is a board, and a canvas holds a board once: make another board, or copy its file.`);
						const box = cornerOf(op.at);
						pen = { op: "copy", id, ...(op.as !== undefined ? { as: op.as } : {}), ...(op.parent !== undefined ? { parent: op.parent } : {}), ...(box ? { box } : {}) };
						break;
					}
					case "variables": {
						// Short values (`"#hex"`, `16`, `{ light, dark }`) in pen's form, the dark one keyed to the drawing's own light/dark axis.
						const given = op.themes === null ? undefined : (op.themes ?? doc.themes);
						const expanded = expandVariables(op.set ?? {}, given as Record<string, string[]> | undefined);
						const themes = expanded.themes ?? op.themes;
						pen = { op: "variables", set: expanded.set as never, ...(themes !== undefined ? { themes } : {}) };
						break;
					}
					default:
						throw new Error(`there is no op "${(op as { op?: unknown })?.op}": insert, update, replace, delete, move, copy or variables.`);
				}
				warn(pen);
				doc = apply(doc, [pen], { theme, measure }).doc;
				penOps.push(pen);
			} catch (error) {
				throw new Error(`${where}${error instanceof Error ? error.message : String(error)}${ops.length > 1 ? " Nothing was changed." : ""}`);
			}
		});
		return { penOps, sized, deleted, placedFor, warned };
	};

	/**
	 * Apply ops to a canvas or a frame, all or nothing, and answer with each item as it now is.
	 * The canvas first, then a board's file when a board was sized, as a person's resize does. A
	 * frame's file is written once, and every canvas placing it is sent it again (`CanvasPens.editFile`).
	 */
	const change = (target: Target, ops: readonly CanvasOpIn[]): Array<Record<string, unknown>> => {
		const pens = needPens();
		const { penOps, sized, deleted, placedFor, warned } = translate(target, ops);
		let results: ReadonlyArray<{ op: string; id: string; note?: string }>;
		let variables: () => Record<string, unknown>;
		let children: Record<string, unknown>[];
		if (target.frame !== undefined) {
			results = pens.files.editFile(target.frame, penOps).results;
			variables = () => (pens.files.framePen(target.frame).doc.variables ?? {}) as Record<string, unknown>;
			children = pens.files.readFile(target.frame).children as unknown as Record<string, unknown>[];
		} else {
			const name = target.canvas;
			const edited = pens.edit(name, penOps, undefined, agent.person ? { undoable: true } : undefined);
			results = edited.results;
			variables = () => (edited.entry.doc.variables ?? {}) as Record<string, unknown>;
			for (const one of sized) {
				const file = service.fileBoard(one.path);
				if (!file) continue;
				service.resize(one.path, { ...(one.w !== undefined ? { w: one.w } : {}), ...(one.h !== undefined ? { h: one.h } : {}) });
				if (agent.person) service.wrote(one.path, "you");
			}
			children = pens.read(name).children as unknown as Record<string, unknown>[];
		}
		notes.push(...placedFor);
		for (const result of results) if (result.note) notes.push(result.note);
		notes.push(...warned);
		notes.push(...docNotes.splice(0));
		const byId = new Map<string, Record<string, unknown>>();
		const index = (list: readonly Record<string, unknown>[]) => {
			for (const node of list) {
				if (typeof node.id === "string") byId.set(node.id, node);
				if (Array.isArray(node.children)) index(node.children as Record<string, unknown>[]);
			}
		};
		index(children);
		const drawn: string[] = [];
		const boxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
		const answer = results.map((result) => {
			if (result.op === "delete" || deleted.has(result.id)) return { type: "deleted", id: result.id };
			if (result.op === "variables") return { type: "variables", id: result.id, variables: variables() };
			const node = byId.get(result.id);
			if (!node) return { type: "unknown", id: result.id };
			const item = toItem(node);
			const box = node.box as { x1: number; y1: number; x2: number; y2: number } | undefined;
			if (box) {
				drawn.push(result.id);
				boxes.push(box);
			}
			return item;
		});
		// What an agent drew is marked on its canvas; a frame is drawn wherever it is placed, so it is not.
		if (drawn.length && target.canvas !== undefined) agent.drew?.(target.canvas, drawn, boxes);
		return answer;
	};
	const one = (target: Target, op: CanvasOpIn) => change(target, [op])[0]!;

	return {
		canvas: {
			read: async (options?: On & { of?: string; depth?: number; resolve?: ReadMore["resolve"]; theme?: Record<string, string> }) => {
				const { of, depth, resolve, theme, ...on } = options ?? {};
				const target = targetOf(on);
				const pens = needPens();
				onCanvas = target.canvas;
				const more: ReadMore = {
					...(of !== undefined && of !== null ? { of: idIn(target.frame !== undefined ? pens.files.framePen(target.frame).doc : pens.get(target.canvas).doc, of, "of") } : {}),
					...(depth !== undefined && depth !== null ? { depth } : {}),
					...(resolve ? { resolve } : {}),
					...(theme ? { theme } : {}),
				};
				if (target.frame !== undefined) {
					const { file, children, ...rest } = pens.files.readFile(target.frame, more) as { file: string; children: unknown[]; ref?: string; stage?: string; variables?: unknown; themes?: unknown };
					delete rest.ref;
					delete rest.stage;
					return { frame: target.frame, file, ...rest, ...withValues(rest), items: (children as unknown as Record<string, unknown>[]).map(toItem) } as never;
				}
				const name = target.canvas;
				const { stage: _stage, file: _file, children, ...rest } = pens.read(name, more);
				return { canvas: name, title: pens.titleOf(name), rev: pens.get(name).rev, ...rest, ...withValues(rest), items: (children as unknown as Record<string, unknown>[]).map(toItem) } as never;
			},
			space: async (size: { w: number; h: number }, options?: On & { near?: string; around?: { x: number; y: number }; side?: Side; margin?: number }) => {
				const { near, around, side, margin, ...on } = options ?? {};
				const w = size?.w;
				const h = size?.h;
				if (typeof w !== "number" || typeof h !== "number" || !(w > 0) || !(h > 0)) throw new Error("space takes the size of what is to go there, as in decks canvas space '{\"w\":900,\"h\":600}'.");
				if (side !== undefined && !["right", "below", "left", "above"].includes(side)) throw new Error("side is right, below, left or above.");
				if (margin !== undefined && (typeof margin !== "number" || !(margin >= 0))) throw new Error("margin is the room to keep clear round the box, a number of pixels, 160 by default.");
				const target = targetOf(on);
				onCanvas = target.canvas;
				const { doc, layout } = surfaceOf(target);
				const placed = layout(doc);
				// Arrows run between items, and the box round one is mostly empty canvas: they are not in the way.
				const items = doc.children.filter((one) => one.metadata?.type !== ARROW).flatMap((one) => {
					const box = placed.get(one.id)?.box;
					return box ? [box] : [];
				});
				let from;
				if (near !== undefined && near !== null) {
					const id = idIn(doc, near, "near");
					from = placed.get(id)?.box;
					if (!from) throw new Error(`Nothing called ${near} is on this canvas to find room near: decks canvas read lists what is.`);
				}
				if (around !== undefined && around !== null) {
					if (from) throw new Error("Say one: near (an item) or around (a point).");
					if (typeof around.x !== "number" || typeof around.y !== "number" || !Number.isFinite(around.x) || !Number.isFinite(around.y)) throw new Error("around is a point on the canvas, as in around: { x: 1200, y: 400 }.");
					const aim = { x1: Math.round(around.x - w / 2), y1: Math.round(around.y - h / 2) };
					const { x1, y1, past } = stepClear(items, { w, h }, aim, "near", margin ?? GAP);
					if (past) ctx.notes.push(`Warning: a box centred on x ${around.x}, y ${around.y} would touch ${past} item${past === 1 ? "" : "s"}: the nearest clear corner is x1 ${x1}, y1 ${y1}, not where you aimed.`);
					return { x1, y1 } as never;
				}
				const room = roomFor(items, { w, h }, { ...(from ? { near: from } : {}), ...(side ? { side } : {}), margin: margin ?? GAP });
				if (room.past) ctx.notes.push(`Warning: ${side ?? "right"} of ${near} at x1 ${room.aim.x1}, y1 ${room.aim.y1} is taken: the room found is past ${room.past} item${room.past === 1 ? "" : "s"}, at x1 ${room.x1}, y1 ${room.y1}.`);
				return { x1: room.x1, y1: room.y1 } as never;
			},
			export: async (of: string | string[], options?: On & { format?: "html" | "tailwind"; to?: string }) => {
				const { format = "html", to, ...on } = options ?? {};
				if (format !== "html" && format !== "tailwind") throw new Error('format is "html" (inline styles, the default) or "tailwind" (Tailwind classes), as in decks canvas export pricing-card \'{"format":"tailwind"}\'.');
				const asked = Array.isArray(of) ? of : [of];
				if (asked.length === 0 || asked.some((one) => typeof one !== "string" || !one.trim())) throw new Error("export takes what to export: an item's id, or a list of them, from decks canvas read.");
				if (to !== undefined && (typeof to !== "string" || !to.trim())) throw new Error('to is the page\'s deck path, as in "exports/pricing.html".');
				const target = targetOf(on);
				onCanvas = target.canvas;
				const pens = needPens();
				const frame = target.frame !== undefined ? pens.files.framePen(target.frame) : undefined;
				const raw = frame ? frame.doc : pens.get(target.canvas!).doc;
				const doc = frame ? frame.imported(raw) : pens.files.withImported(target.canvas!, raw);
				const itemIds = asked.map((one) => idIn(raw, one, "of"));
				const deck = service.deckPath();
				const page = resolveInDeck(deck, to ?? `exports/${itemIds[0]!.replace(/\//g, "-")}.html`);
				const folder = frame ? dirname(pens.files.penFile(target.frame!).file) : pens.folderOf(target.canvas!);
				const done = await exportPage({ doc, ids: itemIds, format, deck, page, folder, measure, ...(target.canvas ? { title: pens.titleOf(target.canvas) } : {}), boardOf: (node) => boardOf(node) });
				ctx.notes.push(...done.notes);
				return { file: done.file } as never;
			},
			insert: async (item: ItemIn, options?: On & { at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }) => {
				const { canvas, frame, ...place } = options ?? {};
				return one(targetOf({ canvas, frame }), { op: "insert", item, ...place }) as never;
			},
			update: async (id: string, changeOf: { set?: Record<string, unknown>; at?: Corner; size?: { w?: number; h?: number } }, options?: On) =>
				one(targetOf(options), { op: "update", id, ...(changeOf ?? {}) }) as never,
			replace: async (id: string, item: ItemIn, options?: On) => one(targetOf(options), { op: "replace", id, item }) as never,
			delete: async (id: string, options?: On) => {
				one(targetOf(options), { op: "delete", id });
				return { deleted: id };
			},
			move: async (id: string, options?: On & { at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }) => {
				const { canvas, frame, ...place } = options ?? {};
				return one(targetOf({ canvas, frame }), { op: "move", id, ...place }) as never;
			},
			copy: async (id: string, options?: On & { as?: string; at?: Corner; parent?: string | null }) => {
				const { canvas, frame, ...rest } = options ?? {};
				return one(targetOf({ canvas, frame }), { op: "copy", id, ...rest }) as never;
			},
			/** A copy of items held for a paste (`paste.ts`): read off this canvas's drawing now, whatever the clipboard later says. */
			clip: async (itemIds: string[], options?: { canvas?: string; id?: string }) => {
				const name = canvasOf(options?.canvas);
				const pens = needPens();
				onCanvas = name;
				const doc = pens.get(name).doc;
				const wanted = (Array.isArray(itemIds) ? itemIds : []).map((one) => idIn(doc, one));
				return holdClip(options?.id, name, doc, wanted, pens.placedOf(name)) as never;
			},
			/**
			 * A held copy put in here, its files first and its items as one edit of the person's (`paste.ts`):
			 * from a canvas they can read, onto one they can change.
			 */
			paste: async (clip: { id?: unknown; canvas?: unknown }, options?: { canvas?: string; at?: { x: number; y: number } }) => {
				const name = canvasOf(options?.canvas);
				const pens = needPens();
				if (pens.rights.sharing(name)?.role === "view") throw new Error(`${pens.titleOf(name)} was shared with you to view, so nothing can be pasted on it. Make your own copy of it first.`);
				const copy = heldClip(clip?.id);
				if (clip?.canvas !== copy.canvas) throw new Error("That copy was made on another canvas than the clip says: copy the items again.");
				if (!pens.has(copy.canvas)) throw new Error("The canvas those items were copied from is not one you can read any more.");
				const at = options?.at;
				if (at !== undefined && (typeof at?.x !== "number" || typeof at?.y !== "number" || !Number.isFinite(at.x) || !Number.isFinite(at.y))) throw new Error("at is a point on the canvas, { x, y }.");
				const deck = service.deckPath();
				const target = pens.get(name);
				if (target.error) throw new Error(`${target.error}. Fix the file, or replace it whole, before pasting on it.`);
				const { items, notes: said } = pasteItems(
					{
						deck,
						writePage: (path, html) => void service.writeCard(path, html),
					},
					copy,
					name,
					ids(target.doc),
					at,
				);
				notes.push(...said);
				if (!items.length) return [] as never;
				return change({ canvas: name }, items.map((node) => ({ op: "insert", node }) as unknown as CanvasOpIn)) as never;
			},
			variables: async (set: Record<string, unknown>, options?: On & { themes?: Record<string, string[]> | null }) => {
				const target = targetOf(options);
				one(target, { op: "variables", set, ...(options?.themes !== undefined ? { themes: options.themes } : {}) });
				const doc = target.frame !== undefined ? needPens().files.framePen(target.frame).doc : needPens().get(target.canvas).doc;
				return { variables: (doc.variables ?? {}) as Record<string, unknown>, values: shortVariables(doc), ...(doc.themes ? { themes: doc.themes as Record<string, unknown> } : {}) };
			},
			batch: async (ops: readonly unknown[], options?: On) => change(targetOf(options), ops as readonly CanvasOpIn[]) as never,
			/** Undo and redo of the person's own edits (`CanvasPens.step`), as `canvas.step` does them. */
			step: async (direction: "undo" | "redo", options?: { canvas?: string }) => {
				const name = canvasOf(options?.canvas);
				const pens = needPens();
				if (pens.rights.sharing(name)?.role === "view") throw new Error("This canvas was shared with you to view, so there is nothing of yours on it to undo.");
				pens.log.step(name, direction === "redo" ? "redo" : "undo");
				return pens.log.steps(name);
			},
			fit: async (board: string, options?: { canvas?: string; margin?: number }) => {
				// The canvas named; else, for an agent, the one the card's own path names (a card says where it is); the person's fit is where they are looking.
				const name = canvasOf(options?.canvas ?? (!ctx.agent.person && typeof board === "string" ? canvasOfPath(board) : undefined));
				const { board: sized, canvas, said } = await fitOn(ctx, board, name, options?.margin);
				return { card: sized.path, canvas, w: sized.w, h: sized.h, notes: said };
			},
			save: async (id: string, frame: string, options?: { canvas?: string; replace?: boolean }) => {
				const name = canvasOf(options?.canvas);
				const pens = needPens();
				const entry = pens.get(name);
						return pens.files.saveFrame(name, idIn(entry.doc, id), frame, options?.replace !== false);
			},
			screenshot: async (options?: { canvas?: string; of?: ShotOf; scale?: number; format?: ShotFormat; to?: string; scheme?: "light" | "dark"; live?: boolean }) => {
				const { canvas, ...rest } = options ?? {};
				return shootOn(ctx, canvasOf(canvas), rest) as never;
			},
			rename: async (title: string, options?: { canvas?: string }) => {
				if (typeof title !== "string" || !title.trim()) throw new Error('rename takes the canvas\'s new name, as in decks canvas rename "Launch plan".');
				const folder = service.retitle(canvasOf(options?.canvas), title);
				service.stagesChanged();
				return canvasRow(folder);
			},
			file: async (options?: { canvas?: string }) => canvasFile(canvasOf(options?.canvas)),
			list: async () => needPens().names().map(canvasRow),
			/** Your own copy of a friend's canvas (`canvas/copy-shared.ts`): a new canvas of yours, which syncs as yours. */
			copyShared: async (options?: { canvas?: string; title?: string }) => {
				const pens = needPens();
				const from = canvasOf(options?.canvas);
				const name = copySharedCanvas(service.deckPath(), pens, from, options?.title);
				service.stagesChanged();
				notes.push(`${name} is your own copy of ${pens.titleOf(from)}: change it as you like, it syncs as your canvas and never changes theirs. decks view goto ${name} moves you there.`);
				return canvasRow(name);
			},
			create: async (title: string) => {
				if (typeof title !== "string" || !title.trim()) throw new Error('canvas create takes a title, as in decks canvas create "Launch plan".');
				const pens = needPens();
				const name = pens.claim(title.trim());
				service.stagesChanged();
				notes.push(`${name} is made and empty. Nobody is on it yet: decks view goto ${name} moves you there, and the person's screen with you when your chat is on screen.`);
				return canvasRow(name);
			},
		},
	};
}
