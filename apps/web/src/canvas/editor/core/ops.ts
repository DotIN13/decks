/**
 * The pen ops an edit of the drawing writes: moving items (into a frame, out of one, along its
 * order), copying them, duplicating, deleting, and making a new one with a tool. Each builder
 * returns the ops `onPenEdit` / `decks.canvas.batch` receives, and the ids of what it made where the
 * selection should follow them; sending them, and selecting, is the page's.
 *
 * Ids come from a generator passed in (`idMaker` over the document's ids on the page, a counter in
 * the tests), so the same call writes the same ops.
 */
import { ARROW, isArrow, isCard, isMarkdownText, makeShape, MARKDOWN, moveArrowEnds, newId, shapeKind, SHAPES, type Box, type Op, type PenNode } from "@decks/pen";
import type { BoardBox, MakingTool, Pt, Rect } from "./model.ts";
import type { SceneQuery } from "./scene.ts";

/** Where a new id comes from: each call one not used before. */
export type NextId = () => string;
/** A board moved to its own new corner, as `onMove` takes it. */
export type BoardMove = { path: string; x: number; y: number };

/** Ids for several new items at once, none the same as another or as any already taken. */
export function idMaker(taken: Iterable<string>): NextId {
	const used = new Set(taken);
	return () => {
		const id = newId(used);
		used.add(id);
		return id;
	};
}

const own = (value: unknown) => (typeof value === "number" ? value : 0);

/**
 * What moving an item by `dx dy` sets. An arrow's point ends are on the stage rather than in its
 * box, so they move with it; its joined ends stay joined (`moveArrowEnds`).
 */
export function movedBy(node: PenNode, dx: number, dy: number): Record<string, unknown> {
	return {
		x: Math.round(own(node.x) + dx),
		y: Math.round(own(node.y) + dy),
		...(isArrow(node) && node.metadata ? { metadata: moveArrowEnds(node.metadata as Record<string, unknown>, dx, dy) } : {}),
	};
}

/**
 * Move items by `dx dy`: a shift of their own `x` and `y`. A shift rather than a new corner,
 * because a group's box starts where its children do, not at its own `x` and `y`.
 *
 * `into` is the parent the drag lets go in (`null` the stage), `undefined` when the parent is not
 * in question (the drag was held with ⌘, a nudge, nothing carried): then it is the plain move.
 * `slot` is where in a frame that stacks its children the first item goes.
 */
export function moveOps(scene: SceneQuery, ids: readonly string[], dx: number, dy: number, into?: string | null, slot?: number): Op[] {
	/*
	 * Where the next item goes in a frame that stacks its children. The op takes the item out of
	 * the tree before putting it back, so an item that was already above its new place lands one
	 * too far down; `was < put` is that correction. A second item of a selection goes after the
	 * first, which is why this counts up.
	 */
	let put = slot;
	return ids.flatMap((id): Op[] => {
		const node = scene.node(id);
		if (!node) return [];
		/*
		 * Into a frame, or out of one onto the stage: a `move` with the parent and the box the
		 * item ends up at **in stage coordinates**, which the server turns into the frame's own
		 * x and y. Writing x and y here instead is what made a frame a trap, since a child's are
		 * measured from its frame's corner.
		 */
		const parent = scene.item(id)?.parent ?? null;
		// A slot means the frame arranges its children, so a drag inside one reorders it: an op even where the parent is unchanged.
		if (into !== undefined && (into !== parent || put !== undefined)) {
			const box = scene.item(id)?.box;
			let index: number | undefined;
			if (put !== undefined) {
				const was = into && into === parent ? (scene.node(into)?.children ?? []).findIndex((child) => child.id === id) : -1;
				index = Math.max(0, put - (was >= 0 && was < put ? 1 : 0));
				put += 1;
			}
			if (box) {
				const move: Op = { op: "move", id, parent: into, ...(index === undefined ? {} : { index }), box: { x1: Math.round(box.x + dx), y1: Math.round(box.y + dy), x2: Math.round(box.x + dx + box.w), y2: Math.round(box.y + dy + box.h) } };
				// Markdown words in a card are as wide as it; out of one, they keep the width they had.
				if (into && isMarkdownText(node) && isCard(scene.node(into))) return [move, { op: "update", id, set: { width: "fill_container", textGrowth: "fixed-width" } }];
				return [move];
			}
			if (index !== undefined) return [{ op: "move", id, parent: into, index }];
		}
		return [{ op: "update", id, set: movedBy(node, dx, dy) }];
	});
}

/** Copies of items, `dx dy` from where they are, and the ids they are made as: an Alt-drag lets go of copies and leaves the originals. */
export function copyOps(scene: SceneQuery, ids: readonly string[], dx: number, dy: number, nextId: NextId): { ops: Op[]; made: string[] } {
	const made: string[] = [];
	const ops = ids.flatMap((id): Op[] => {
		const node = scene.node(id);
		if (!node) return [];
		const as = nextId();
		made.push(as);
		return [{ op: "copy", id, as }, { op: "update", id: as, set: movedBy(node, dx, dy) }];
	});
	return { ops, made };
}

/** How far down and right a duplicate (⌘D, the pill's Duplicate) is put from what it copies. */
export const DUPLICATE_OFFSET = 24;

/** A copy of each item, `DUPLICATE_OFFSET` down and right of it. */
export function duplicateOps(scene: SceneQuery, ids: readonly string[], nextId: NextId): { ops: Op[]; made: string[] } {
	return copyOps(scene, ids, DUPLICATE_OFFSET, DUPLICATE_OFFSET, nextId);
}

/** Take items off the canvas. */
export function deleteOps(ids: readonly string[]): Op[] {
	return ids.map((id) => ({ op: "delete", id }));
}

/** Boards moved by `dx dy`, each to its own new corner, rounded; a path not on the stage is left out. */
export function boardMoves(boards: readonly BoardBox[], paths: readonly string[], dx: number, dy: number): BoardMove[] {
	return paths.flatMap((path) => {
		const board = boards.find((candidate) => candidate.path === path);
		return board ? [{ path, x: Math.round(board.x + dx), y: Math.round(board.y + dy) }] : [];
	});
}

/*
 * What a frame starts with. The padding is what makes a frame readable as a container rather
 * than an outline round its contents, and the radius is that padding plus a card's own corner:
 * nested corners look right when the gap between the two curves is the same all the way round,
 * so a card dropped into a frame sits concentric with it instead of inside a tighter arc.
 */
export const FRAME_PAD = 18;
/** A note's and a card's corner (`pen/look.ts` `NOTE_RADIUS`, held equal by `editor/ops-constants.test.ts`). */
export const NOTE_CORNER = 12;
export const FRAME_RADIUS = NOTE_CORNER + FRAME_PAD;

/** What each tool makes, before its box: pen's own items, with nothing of ours in them. */
export const MADE: Record<Exclude<MakingTool, "shape" | "icon">, { node: Partial<PenNode> & { type: string }; w: number; h: number }> = {
	rectangle: { node: { type: "rectangle", fill: "#dbe4f0", cornerRadius: 8 }, w: 160, h: 100 },
	ellipse: { node: { type: "ellipse", fill: "#c7ddf7" }, w: 120, h: 120 },
	/*
	 * A frame made by hand is a column, because that is what a frame is for: things in an order,
	 * arranged for you. It hugs what it holds, and the height it is drawn at is its floor
	 * (`fit_content(h)`, written by the insert in `@decks/pen`'s `ops.ts`): an empty one is still
	 * something to drop into, and it grows as things go in.
	 */
	frame: { node: { type: "frame", name: "Frame", layout: "vertical", gap: 12, padding: FRAME_PAD, fill: "#ffffff", stroke: "#d0d7de", strokeWidth: 1, cornerRadius: FRAME_RADIUS, clip: true }, w: 400, h: 120 },
	// A text's words are markdown, as a card's blocks are, typed into with the card's toolbar.
	text: { node: { type: "text", content: "", fontSize: 24, textGrowth: "fixed-width", metadata: { type: MARKDOWN } }, w: 320, h: 32 },
	/*
	 * A card is pen's own frame, a column, whose blocks are markdown texts and pictures (`madeNode`,
	 * `pen/card-frame.ts`), so pen.dev opens it as a column and the frame's drop places things in it.
	 */
	card: { node: { type: "frame", name: "Card" }, w: 320, h: 48 },
	note: { node: { type: "note", content: "" }, w: 240, h: 80 },
};

/** Shapes that are as tall as they are wide when made with a click: a circle, a star, a ring. */
export const SQUARE_SHAPES = new Set(["Ellipse", "Ring", "Star", "Octagon", "Pentagon", "Hexagon", "Plus", "Heart", "Triangle"]);

/**
 * What a tool makes depends on more than the tool: the shape and the icon picked in the insert
 * panel, ids for the items inside it, and a card's first block (`pen/card-frame.ts` `newCard`,
 * passed in because it is markdown's and not core's).
 */
export type MakeOptions = {
	shape: string;
	icon: { library: string; name: string };
	/** Ids for what the item holds (a shape's outline, a card's first block): never the item's own. */
	nextId: NextId;
	card: (id: string, child: string) => PenNode;
};

/** The size a click makes, for every tool: a shape's by its kind, an icon's 48 square. */
export function madeSize(tool: MakingTool, shape: string): { w: number; h: number } {
	if (tool === "shape") return SQUARE_SHAPES.has(shape) ? { w: 120, h: 120 } : shape === "Decision" ? { w: 160, h: 120 } : { w: 160, h: 100 };
	if (tool === "icon") return { w: 48, h: 48 };
	return { w: MADE[tool].w, h: MADE[tool].h };
}

/** The item a tool makes, with its id: a shape from the library (`@decks/pen`, `makeShape`), the icon picked, or the tool's own. */
export function madeNode(tool: MakingTool, id: string, size: { w: number; h: number }, options: MakeOptions): PenNode {
	if (tool === "shape") return makeShape(shapeKind(options.shape) ?? SHAPES[0]!, { frame: id, outline: options.nextId() }, size);
	if (tool === "icon") return { type: "icon", id, name: options.icon.name, library: options.icon.library, icon: options.icon.name, fill: "#1f2328", weight: 400 } as PenNode;
	// A card is a column frame of blocks (`pen/card-frame.ts`), starting with one empty one.
	if (tool === "card") return options.card(id, options.nextId());
	return { ...MADE[tool].node, id } as PenNode;
}

/** A made item: the insert op, its node, and the box it is drawn at (a card's opens 80 tall for typing). */
export type InsertOp = Extract<Op, { op: "insert" }>;
export type Made = { op: InsertOp; node: PenNode; box: Rect };

const insertOp = (node: PenNode, box: Partial<Box>, parent: string | undefined): InsertOp => ({ op: "insert", ...(parent ? { parent } : {}), node, box });
const typingBox = (tool: MakingTool, x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h: tool === "card" ? 80 : h });

/**
 * One item of a tool, at its own size, at a stage point: a click with a tool armed, and a pick
 * from the canvas menu. From the insert panel (`centred`) the item is put with its middle there; from a click, its corner.
 * A note's height and a text's height are its words', so their box leaves them out.
 */
export function makeAtOp(tool: MakingTool, id: string, at: Pt, options: MakeOptions & { centred?: boolean; parent?: string }): Made {
	const made = madeSize(tool, options.shape);
	const x1 = Math.round(options.centred ? at.x - made.w / 2 : at.x);
	const y1 = Math.round(options.centred ? at.y - made.h / 2 : at.y);
	const box = tool === "note" ? { x1, y1 } : tool === "text" ? { x1, y1, x2: x1 + made.w } : { x1, y1, x2: x1 + made.w, y2: y1 + made.h };
	const node = madeNode(tool, id, made, options);
	return { op: insertOp(node, box, options.parent), node, box: typingBox(tool, x1, y1, made.w, made.h) };
}

/**
 * One item of a tool, drawn by a drag from `at` to `end`: the box between them, at least 8 each way.
 * A text grows with its words unless a width was drawn for it; its height is always its words'.
 * A card or a frame is as tall as its words, and the height drawn is the least it is.
 */
export function drawnOp(tool: MakingTool, id: string, at: Pt, end: Pt, options: MakeOptions & { parent?: string }): Made {
	const x1 = Math.round(Math.min(at.x, end.x));
	const y1 = Math.round(Math.min(at.y, end.y));
	const w = Math.max(8, Math.round(Math.abs(end.x - at.x)));
	const h = Math.max(8, Math.round(Math.abs(end.y - at.y)));
	const box = tool === "text" ? { x1, y1, x2: x1 + w } : { x1, y1, x2: x1 + w, y2: y1 + h };
	const node = madeNode(tool, id, { w, h }, options);
	return { op: insertOp(node, box, options.parent), node, box: typingBox(tool, x1, y1, w, h) };
}

/** A new arrow between two ends (`newArrowEnds` in `arrows.ts`), curved, in the drawing's grey. */
export function arrowInsertOp(id: string, from: unknown, to: unknown): InsertOp {
	return { op: "insert", node: { type: "path", id, stroke: "#8a8f98", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", metadata: { type: ARROW, from, to, route: "curved" } } as Partial<PenNode> & { type: string } };
}
