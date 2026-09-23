import { check, clone, ids, indexOf, newId, PenError } from "./doc.ts";
import { layout, type MeasureText, type Placed } from "./layout.ts";
import { expand } from "./refs.ts";
import type { Box, PenDocument, PenNode, PenVariable } from "./types.ts";
import type { ThemeState } from "./values.ts";

/**
 * Edits to a `.pen` document, applied together or not at all.
 *
 * The operations pen.dev's own agent tool has — insert, update, replace, delete, move, copy — plus
 * one for the document's variables, written as JSON so they can be passed through a tool call. Every item is addressed by its
 * id; an item inside an instance by its id path (`"card-1/label"`), and an update there is written
 * into the instance's `descendants`, which is where pen keeps it.
 *
 * **Positions.** The file keeps pen's own numbers: `x` and `y` from the parent's corner, and a
 * `width` and `height`. An operation may give a `box` instead — `{ x1, y1, x2, y2 }` on the stage —
 * and it is turned into those numbers against wherever the parent actually is, so an agent never
 * adds a parent's corner or a width itself. Inside a row or column layout the parent decides the
 * position, so only the size is taken from the box.
 */

export type Op =
	| { op: "insert"; parent?: string | null; index?: number; node: Partial<PenNode> & { type: string }; box?: Partial<Box> }
	| { op: "update"; id: string; set?: Record<string, unknown>; box?: Partial<Box> }
	| { op: "replace"; id: string; node: Partial<PenNode> & { type: string } }
	| { op: "delete"; id: string }
	| { op: "move"; id: string; parent?: string | null; index?: number; box?: Partial<Box> }
	| { op: "copy"; id: string; parent?: string | null; index?: number; box?: Partial<Box>; as?: string }
	| { op: "variables"; set: Record<string, PenVariable | null>; themes?: Record<string, string[]> | null };

export interface OpResult {
	op: Op["op"];
	/** The item the operation made or changed. */
	id: string;
	/** What happened that the caller did not ask for, said as a sentence. */
	note?: string;
}

export interface ApplyOptions {
	theme: ThemeState;
	measure?: MeasureText;
}

/** Apply `ops` to a copy of `doc`; the copy is returned only if every one succeeded. */
export function apply(doc: PenDocument, ops: readonly Op[], options: ApplyOptions): { doc: PenDocument; results: OpResult[] } {
	if (!Array.isArray(ops)) throw new PenError("Edits are a list: [{ op: \"insert\", node: { type: \"note\", content: \"…\" } }].");
	const next = clone(doc);
	const results: OpResult[] = [];
	ops.forEach((op, i) => {
		try {
			results.push(one(next, op, options));
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			throw new PenError(`Edit ${i + 1} (${(op as { op?: string })?.op ?? "?"}) failed, and nothing was saved: ${why}`);
		}
	});
	check(next);
	return { doc: next, results };
}

function one(doc: PenDocument, op: Op, options: ApplyOptions): OpResult {
	if (!op || typeof op !== "object" || typeof (op as { op?: unknown }).op !== "string") throw new PenError('each edit is an object with an "op": insert, update, replace, delete, move, copy or variables.');
	switch (op.op) {
		case "insert": {
			if (!op.node || typeof op.node !== "object" || typeof op.node.type !== "string") throw new PenError('insert needs a node with a type, as in { op: "insert", node: { type: "note", content: "…" } }.');
			const node = withIds(clone(op.node) as PenNode, ids(doc));
			const siblings = childrenOf(doc, op.parent);
			const at = clampIndex(op.index, siblings.length);
			siblings.splice(at, 0, node);
			const note = op.box ? placeBox(doc, node.id, op.box, options) : undefined;
			return { op: "insert", id: node.id, ...(note ? { note } : {}) };
		}
		case "update": {
			if (typeof op.id === "string" && op.id.includes("/")) return updateInside(doc, op.id, op.set ?? {}, op.box);
			const found = located(doc, op.id);
			for (const [key, value] of Object.entries(op.set ?? {})) {
				if (key === "id") throw new PenError(`an id is how the item is found; to rename ${op.id}, replace it.`);
				if (key === "children") throw new PenError("children are changed with insert, move and delete, not update.");
				if (value === null) delete found.node[key];
				else found.node[key] = clone(value);
			}
			const note = op.box ? placeBox(doc, op.id, op.box, options) : undefined;
			return { op: "update", id: op.id, ...(note ? { note } : {}) };
		}
		case "replace": {
			if (!op.node || typeof op.node.type !== "string") throw new PenError("replace needs a node with a type.");
			const found = located(doc, op.id);
			const taken = ids(doc);
			taken.delete(op.id);
			const node = clone(op.node) as PenNode;
			node.id = typeof node.id === "string" && node.id ? node.id : op.id;
			found.siblings[found.index] = withIds(node, taken);
			return { op: "replace", id: node.id };
		}
		case "delete": {
			const found = located(doc, op.id);
			found.siblings.splice(found.index, 1);
			return { op: "delete", id: op.id };
		}
		case "move": {
			const found = located(doc, op.id);
			if (op.parent !== undefined) {
				if (op.parent === op.id || (op.parent && isInside(found.node, op.parent))) throw new PenError(`${op.id} cannot go inside itself.`);
				found.siblings.splice(found.index, 1);
				const siblings = childrenOf(doc, op.parent);
				siblings.splice(clampIndex(op.index, siblings.length), 0, found.node);
			} else if (op.index !== undefined) {
				found.siblings.splice(found.index, 1);
				found.siblings.splice(clampIndex(op.index, found.siblings.length), 0, found.node);
			}
			const note = op.box ? placeBox(doc, op.id, op.box, options) : undefined;
			return { op: "move", id: op.id, ...(note ? { note } : {}) };
		}
		case "copy": {
			const found = located(doc, op.id);
			const taken = ids(doc);
			if (op.as !== undefined && (typeof op.as !== "string" || !op.as || op.as.includes("/") || taken.has(op.as))) throw new PenError(`"${String(op.as)}" cannot be the copy's id: it is taken, empty or contains "/".`);
			const copy = freshIds(clone(found.node), taken, op.as);
			const siblings = op.parent === undefined ? found.siblings : childrenOf(doc, op.parent);
			const at = op.index === undefined ? (op.parent === undefined ? found.index + 1 : siblings.length) : clampIndex(op.index, siblings.length);
			siblings.splice(at, 0, copy);
			const note = op.box ? placeBox(doc, copy.id, op.box, options) : undefined;
			return { op: "copy", id: copy.id, ...(note ? { note } : {}) };
		}
		case "variables": {
			/*
			 * The document's variables and theme axes, which no item holds: `$name` in a field reads
			 * them, and a value can differ by theme — `{ value: "#1c1c1e", theme: { Mode: "Dark" } }`.
			 */
			if (!op.set || typeof op.set !== "object") throw new PenError('variables needs set: { "name": { type: "color", value: "#…" } }, or null to remove one.');
			const vars = (doc.variables ??= {});
			for (const [name, def] of Object.entries(op.set)) {
				if (name.includes(":") || name.startsWith("$")) throw new PenError(`"${name}" cannot be a variable name: no colon, and no leading $ (that is how a field refers to it).`);
				if (def === null) delete vars[name];
				else {
					if (!def || !["boolean", "color", "number", "string"].includes((def as PenVariable).type)) throw new PenError(`${name} needs a type: boolean, color, number or string.`);
					vars[name] = clone(def);
				}
			}
			if (op.themes === null) delete doc.themes;
			else if (op.themes) doc.themes = clone(op.themes);
			return { op: "variables", id: Object.keys(op.set).join(",") };
		}
		default:
			throw new PenError(`"${(op as { op: string }).op}" is not an edit: use insert, update, replace, delete, move, copy or variables.`);
	}
}

function located(doc: PenDocument, id: string) {
	if (typeof id !== "string" || !id) throw new PenError("an edit names its item by id.");
	const found = indexOf(doc).get(id);
	if (!found) throw new PenError(`no item "${id}".`);
	return found;
}

function childrenOf(doc: PenDocument, parent: string | null | undefined): PenNode[] {
	if (parent === undefined || parent === null || parent === "") return doc.children;
	const found = located(doc, parent);
	if (found.node.type !== "frame" && found.node.type !== "group") throw new PenError(`${parent} is a ${found.node.type}; only a frame or a group holds items.`);
	if (!Array.isArray(found.node.children)) found.node.children = [];
	return found.node.children;
}

function clampIndex(index: number | undefined, length: number): number {
	if (index === undefined || !Number.isFinite(index)) return length;
	return Math.max(0, Math.min(length, Math.round(index)));
}

function isInside(node: PenNode, id: string): boolean {
	for (const child of node.children ?? []) if (child.id === id || isInside(child, id)) return true;
	return false;
}

/** Give an inserted item, and everything in it, an id if it has none; refuse ones already taken. */
function withIds(node: PenNode, taken: Set<string>): PenNode {
	const visit = (item: PenNode) => {
		if (typeof item.id !== "string" || !item.id) item.id = newId(taken);
		else if (item.id.includes("/")) throw new PenError(`the id "${item.id}" contains "/".`);
		else if (taken.has(item.id)) throw new PenError(`the id "${item.id}" is already used.`);
		taken.add(item.id);
		for (const child of item.children ?? []) visit(child);
	};
	visit(node);
	return node;
}

/** A copy's ids: all fresh, the root's `as` when given. */
function freshIds(node: PenNode, taken: Set<string>, rootId: string | undefined): PenNode {
	const visit = (item: PenNode, root: boolean) => {
		item.id = root && rootId ? rootId : newId(taken);
		taken.add(item.id);
		for (const child of item.children ?? []) visit(child, false);
	};
	visit(node, true);
	return node;
}

/**
 * An update to an item inside an instance: written to the instance's `descendants`.
 *
 * `"card-1/label"` is the ref `card-1` and the path `label` inside it; a deeper path such as
 * `"card-1/ok-button/label"` is still one key under `card-1`, because pen keys overrides by the
 * whole path from the instance.
 */
function updateInside(doc: PenDocument, path: string, set: Record<string, unknown>, box: Partial<Box> | undefined): OpResult {
	const slash = path.indexOf("/");
	const refId = path.slice(0, slash);
	const inner = path.slice(slash + 1);
	const found = located(doc, refId);
	if (found.node.type !== "ref") throw new PenError(`${refId} is not an instance, so "${path}" names nothing; nested items are addressed by their own ids.`);
	if (box) throw new PenError("an item inside an instance is placed by the instance; give the box to the instance instead.");
	const descendants = (found.node.descendants ??= {});
	const override = (descendants[inner] ??= {});
	for (const [key, value] of Object.entries(set)) {
		if (value === null) delete override[key];
		else override[key] = clone(value);
	}
	if (Object.keys(override).length === 0) delete descendants[inner];
	return { op: "update", id: path };
}

/** Turn a stage box into pen's own numbers for this item, against where its parent really is. */
function placeBox(doc: PenDocument, id: string, box: Partial<Box>, options: ApplyOptions): string | undefined {
	const found = located(doc, id);
	const node = found.node;
	const hasX = typeof box.x1 === "number";
	const hasY = typeof box.y1 === "number";
	const placed: Map<string, Placed> = layout(doc, expand(doc), options);
	const parent = found.parent ? placed.get(found.parent.id) : undefined;
	const origin = parent ? { x: parent.box.x, y: parent.box.y } : { x: 0, y: 0 };
	/*
	 * Where the item's box is now, so a move is a shift of its own x and y by the difference. That
	 * is the same as "box corner minus parent corner" for every item whose box starts at its x, y,
	 * and it is also right for a group, whose box starts wherever its children do.
	 */
	const now = placed.get(id)?.box;
	const inFlow = !!found.parent && found.parent.type === "frame" && (found.parent.layout ?? "horizontal") !== "none" && node.layoutPosition !== "absolute";
	const notes: string[] = [];
	if (inFlow && (hasX || hasY)) notes.push(`${found.parent!.id} lays out its children, so it decides where ${id} goes; only the size was taken from the box`);
	else {
		const own = (value: unknown) => (typeof value === "number" ? value : 0);
		if (hasX) node.x = round(now ? own(node.x) + box.x1! - now.x : box.x1! - origin.x);
		if (hasY) node.y = round(now ? own(node.y) + box.y1! - now.y : box.y1! - origin.y);
	}
	if (node.type === "group" && (typeof box.x2 === "number" || typeof box.y2 === "number")) {
		notes.push(`a group is as big as what is in it, so ${id} was moved but not resized; resize its children`);
		return notes.join("; ");
	}
	const width = typeof box.x2 === "number" && hasX ? box.x2 - box.x1! : undefined;
	const height = typeof box.y2 === "number" && hasY ? box.y2 - box.y1! : undefined;
	if (width !== undefined) {
		if (width < 0) throw new PenError("x2 is left of x1.");
		node.width = round(width);
		if (node.type === "text" && (node.textGrowth ?? "auto") === "auto") {
			node.textGrowth = "fixed-width";
			notes.push(`${id} now wraps at its width (textGrowth "fixed-width")`);
		}
	}
	if (height !== undefined) {
		if (height < 0) throw new PenError("y2 is above y1.");
		if (node.type === "text" && node.textGrowth !== "fixed-width-height") notes.push(`a text's height follows its words; y2 was not kept (set textGrowth "fixed-width-height" to fix both)`);
		else node.height = round(height);
	}
	return notes.length ? notes.join("; ") : undefined;
}

const round = (value: number) => Math.round(value * 100) / 100;
