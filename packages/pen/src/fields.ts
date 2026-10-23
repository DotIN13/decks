import type { PenNode } from "./types.ts";
import { fillsOf } from "./values.ts";

/**
 * Which fields each item type has in pen's format, and which values Decks keeps but does not draw.
 *
 * An agent writing `padding` on a text, or a `mesh_gradient` fill, gets no error, because the file
 * keeps every field it is given and pen.dev may draw it. But nothing on the canvas changes either,
 * and the only way to learn that was to look. `warnings` says so, one sentence per problem, for the
 * calls to put in their notes; nothing is refused.
 *
 * The table follows the format's interfaces (an entity, its size, its graphics, a layout, a text
 * style) as `PenNode` in `types.ts` lists them; `fields.test.ts` holds the two in step, so a field
 * added there and forgotten here (or the other way round) fails a test. A `ref` takes any field,
 * since its fields override the item it copies, and is not checked.
 */

const ENTITY = ["type", "id", "name", "context", "reusable", "theme", "enabled", "opacity", "flipX", "flipY", "layoutPosition", "metadata", "rotation", "x", "y"] as const;
const SIZE = ["width", "height"] as const;
/** `strokeDash` is ours (dashes or dots); pen.dev carries it and draws the line solid. */
const STROKE = ["stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "strokeAlignment", "strokeDash"] as const;
const EFFECTS = ["effect"] as const;
const GRAPHICS = [...EFFECTS, ...STROKE, "fill"] as const;
const RECTANGLEISH = [...ENTITY, ...SIZE, ...GRAPHICS, "cornerRadius"] as const;
const LAYOUT = ["layout", "gap", "layoutIncludeStroke", "padding", "justifyContent", "alignItems"] as const;
const TEXT_STYLE = ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "fontStyle", "underline", "lineHeight", "textAlign", "textAlignVertical", "strikethrough", "href"] as const;
const WORDS = ["content"] as const;

/** Every field an item of each type has; a type missing here is not one pen.dev defines. */
export const FIELDS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
	Object.entries({
		frame: [...RECTANGLEISH, ...LAYOUT, "children", "clip", "placeholder", "slot"],
		group: [...ENTITY, ...EFFECTS, "children"],
		rectangle: [...RECTANGLEISH],
		ellipse: [...ENTITY, ...SIZE, ...GRAPHICS, "innerRadius", "startAngle", "sweepAngle"],
		polygon: [...ENTITY, ...SIZE, ...GRAPHICS, "polygonCount", "cornerRadius"],
		path: [...ENTITY, ...SIZE, ...GRAPHICS, "fillRule", "geometry", "viewBox"],
		text: [...ENTITY, ...SIZE, ...GRAPHICS, ...TEXT_STYLE, ...WORDS, "textGrowth"],
		note: [...ENTITY, ...SIZE, ...TEXT_STYLE, ...WORDS],
		prompt: [...ENTITY, ...SIZE, ...TEXT_STYLE, ...WORDS, "model"],
		context: [...ENTITY, ...SIZE, ...TEXT_STYLE, ...WORDS],
		icon: [...ENTITY, ...SIZE, ...EFFECTS, "library", "icon", "weight", "fill"],
		/** The older icon, as some files still have it. */
		icon_font: [...ENTITY, ...SIZE, ...EFFECTS, "iconFontFamily", "iconFontName", "weight", "fill"],
		script: [...ENTITY, ...SIZE, "clip", "scriptUri", "inputs"],
		browser: [...ENTITY, ...SIZE, ...EFFECTS, ...STROKE, "url", "deviceId", "zoom", "scrollX", "scrollY", "cornerRadius"],
		/** Its own fields; any other field overrides the item it copies, so a ref is not checked. */
		ref: [...ENTITY, "ref", "descendants"],
	}).map(([type, list]) => [type, new Set(list)]),
);

/** A fill or effect type pen.dev draws and Decks keeps without drawing. */
const UNDRAWN_FILLS = new Set(["shader", "mesh_gradient"]);
const UNDRAWN_EFFECTS = new Set(["blur", "background_blur", "shader"]);

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/**
 * Whether the stage draws an inner shadow on an item of this type with these values: on boxes and
 * whole ellipses, not on paths, polygons, text, icons, or an ellipse cut to an arc or a ring.
 */
function drawsInnerShadow(type: string | undefined, values: Record<string, unknown>): boolean {
	if (type === "frame" || type === "rectangle") return true;
	if (type !== "ellipse") return false;
	const inner = typeof values.innerRadius === "number" ? values.innerRadius : 0;
	const sweep = typeof values.sweepAngle === "number" ? values.sweepAngle : 360;
	return inner <= 0 && Math.abs(sweep) >= 360;
}

/** What is kept and not drawn among an item's own values (its fills, strokes and effects), each as a phrase. */
function undrawn(values: Record<string, unknown>, type: string | undefined): string[] {
	const out: string[] = [];
	for (const field of ["fill", "stroke"] as const) {
		let value = values[field];
		// The older one-object stroke holds its fill inside.
		if (field === "stroke" && value && typeof value === "object" && !Array.isArray(value) && !("type" in value) && "fill" in value) value = (value as { fill: unknown }).fill;
		if (!value || typeof value === "string") continue;
		for (const one of fillsOf(value as never)) {
			const kind = one && typeof one === "object" ? (one as { type?: unknown }).type : undefined;
			if (typeof kind === "string" && UNDRAWN_FILLS.has(kind)) out.push(`${article(kind)} ${kind} ${field}`);
		}
	}
	const effects = values.effect;
	for (const one of Array.isArray(effects) ? effects : effects ? [effects] : []) {
		const kind = one && typeof one === "object" ? (one as { type?: unknown }).type : undefined;
		if (typeof kind !== "string") continue;
		if (UNDRAWN_EFFECTS.has(kind)) out.push(`${article(kind)} ${kind} effect`);
		else if (kind === "shadow" && (one as { shadowType?: unknown }).shadowType === "inner" && !drawsInnerShadow(type, values)) out.push("an inner shadow");
	}
	return out;
}

/**
 * The problems with an item and everything in it, as sentences: fields its type does not have, and
 * values Decks keeps but does not draw. An item below the first is named by its id or its name.
 */
export function warnings(node: Partial<PenNode> & { type?: unknown }): string[] {
	const out: string[] = [];
	const visit = (item: Record<string, unknown>, root: boolean) => {
		const type = typeof item.type === "string" ? item.type : "";
		const label = typeof item.id === "string" && item.id ? item.id : typeof item.name === "string" && item.name ? item.name : undefined;
		const on = root || !label ? `${article(type)} ${type}` : `${article(type)} ${type} (${label})`;
		const allowed = FIELDS[type];
		if (type && !allowed) out.push(`"${type}" is not an item type pen.dev has, so ${label ?? "it"} is kept and draws nothing: frame, group, rectangle, ellipse, polygon, path, text, note, prompt, context, icon, script, browser or ref.`);
		if (allowed && type !== "ref") for (const key of Object.keys(item)) if (!allowed.has(key)) out.push(`"${key}" does nothing on ${on}.`);
		if (type === "script") out.push(`${root || !label ? "A script" : `The script ${label}`} is kept, but Decks does not run scripts, so it draws nothing there.`);
		for (const what of undrawn(item, type)) out.push(`${what[0]!.toUpperCase()}${what.slice(1)} on ${on} is kept for pen.dev, but Decks does not draw it.`);
		if (Array.isArray(item.children)) for (const child of item.children) if (child && typeof child === "object") visit(child as Record<string, unknown>, false);
	};
	visit(node as Record<string, unknown>, true);
	return out;
}

/** The problems with an update: fields `set` gives that the item's type does not have, and undrawn values. */
export function updateWarnings(type: string | undefined, set: Record<string, unknown>): string[] {
	const out: string[] = [];
	const kind = typeof set.type === "string" ? set.type : type;
	const allowed = kind ? FIELDS[kind] : undefined;
	const on = kind ? `${article(kind)} ${kind}` : "this item";
	// A null removes a field, which is never a problem.
	if (allowed && kind !== "ref") for (const [key, value] of Object.entries(set)) if (value !== null && !allowed.has(key)) out.push(`"${key}" does nothing on ${on}.`);
	if (kind === "script" && set.type === "script") out.push("A script is kept, but Decks does not run scripts, so it draws nothing there.");
	for (const what of undrawn(set, kind)) out.push(`${what[0]!.toUpperCase()}${what.slice(1)} on ${on} is kept for pen.dev, but Decks does not draw it.`);
	return out;
}
