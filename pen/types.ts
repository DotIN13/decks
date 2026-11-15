/**
 * The `.pen` document, as pen.dev defines it.
 *
 * A stage is saved as a native `.pen` file so pen.dev opens it as it is, which makes this the
 * one vocabulary: nothing here renames a pen field to one of ours. The types follow pen.dev's
 * published format (docs.pencil.dev, "The .pen format"), and they are deliberately loose in one
 * way — every item keeps fields it does not know. A file written by a newer pen.dev, or by an
 * agent using a field this build has never heard of, is read and written back unchanged.
 *
 * Two spellings of a stroke exist in real files. The format as published today is `stroke`
 * (a fill) with `strokeWidth`, `strokeAlignment`, `strokeLinecap` and `strokeLinejoin`; files
 * saved by older pen.dev builds carry one object, `stroke: { align, thickness, fill, cap, join }`.
 * pen.dev reads both, so both are read here (`values.ts`), and neither is rewritten into the other.
 */

/** A `$name` that binds a property to a document variable. */
export type Variable = string;
/** A number, or a variable holding one. */
export type NumberOrVariable = number | Variable;
/** `#RGB`, `#RRGGBB` or `#RRGGBBAA`, or a variable. */
export type ColorOrVariable = string;

/** `fit_content`, `fill_container`, either with a fallback in brackets, or a number. */
export type SizeValue = NumberOrVariable | string;

export type Fill =
	| ColorOrVariable
	| { type: "color"; color: ColorOrVariable; enabled?: boolean | Variable; blendMode?: string }
	| {
			type: "gradient";
			gradientType?: "linear" | "radial" | "angular";
			opacity?: NumberOrVariable;
			center?: { x?: number; y?: number };
			size?: { width?: NumberOrVariable; height?: NumberOrVariable };
			rotation?: NumberOrVariable;
			colors?: Array<{ color: ColorOrVariable; position: NumberOrVariable }>;
			enabled?: boolean | Variable;
			blendMode?: string;
	  }
	| { type: "image"; url?: string; mode?: "stretch" | "fill" | "fit"; opacity?: NumberOrVariable; enabled?: boolean | Variable; blendMode?: string }
	| { type: string; enabled?: boolean | Variable; [key: string]: unknown };

/** One fill, or a list drawn in order, the first at the back. */
export type Fills = Fill | Fill[];

/** The older single-object stroke. */
export interface LegacyStroke {
	align?: "inside" | "center" | "outside";
	thickness?: NumberOrVariable | { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable };
	fill?: Fills;
	cap?: string;
	join?: string;
}

export type Effect =
	| { type: "blur"; radius?: NumberOrVariable; enabled?: boolean | Variable }
	| { type: "background_blur"; radius?: NumberOrVariable; enabled?: boolean | Variable }
	| {
			type: "shadow";
			shadowType?: "inner" | "outer";
			offset?: { x: NumberOrVariable; y: NumberOrVariable };
			spread?: NumberOrVariable;
			blur?: NumberOrVariable;
			color?: ColorOrVariable;
			enabled?: boolean | Variable;
			blendMode?: string;
	  };

/**
 * One item in a `.pen` document.
 *
 * The item types pen.dev defines are `frame`, `group`, `rectangle`, `ellipse`, `polygon`, `path`,
 * `text`, `note`, `prompt`, `context`, `icon`, `script`, `browser` and `ref`; older files also have
 * `icon_font`. The fields below are the ones this package reads. Anything else is carried.
 */
export interface PenNode {
	/** Which kind of item this is: frame, group, rectangle, ellipse, polygon, path, text, note, prompt, context, icon, script, browser or ref. */
	type: string;
	/** Unique in the document; never contains `/`, which separates the steps of an id path. Left out on insert, it is made from `name`. */
	id: string;
	/** What the item is, in words: shown in the layers panel, and the source of a new item's id. */
	name?: string;
	/** Free words for whoever reads the file next: what this item is for, or where it came from. */
	context?: string;
	/** A component: other items copy it with `{ type: "ref", ref: <its id> }`, and follow its changes. */
	reusable?: boolean;
	/** The theme this item and what is in it use, by axis: `{ mode: "dark" }`. */
	theme?: Record<string, string>;
	/** `false` hides the item and leaves it out of its parent's layout. */
	enabled?: boolean | Variable;
	/** 0 (clear) to 1 (solid), for the item and everything in it. */
	opacity?: NumberOrVariable;
	/** Mirrors the item left to right. */
	flipX?: boolean | Variable;
	/** Mirrors the item top to bottom. */
	flipY?: boolean | Variable;
	/** `absolute` takes the item out of its parent's layout, to sit at its own `x`, `y`. */
	layoutPosition?: "auto" | "absolute";
	/** pen's extension point: anything pen.dev has no field for rides here. */
	metadata?: { type: string; [key: string]: unknown };
	/** Degrees counter-clockwise, about the top-left corner. */
	rotation?: NumberOrVariable;

	/** From the parent's top-left corner, rightwards; ignored inside a flex layout. */
	x?: number;
	/** From the parent's top-left corner, downwards; ignored inside a flex layout. */
	y?: number;
	/** A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). */
	width?: SizeValue;
	/** As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. */
	height?: SizeValue;

	/** What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. */
	fill?: Fills;
	/** The outline's fill: a colour, a gradient, or a list. */
	stroke?: Fills | LegacyStroke;
	/** How thick the outline is, in px; one number, or each side on its own. */
	strokeWidth?: NumberOrVariable | { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable };
	/** How an open line ends. */
	strokeLinecap?: "butt" | "round" | "square";
	/** How a line turns a corner. */
	strokeLinejoin?: "miter" | "bevel" | "round";
	/** Whether the outline sits inside the edge, on it, or outside it. */
	strokeAlignment?: "inner" | "center" | "outer";
	/** Ours, not pen's: a line drawn in dashes or dots. pen.dev carries it and draws the line solid. */
	strokeDash?: "dashed" | "dotted";
	/** Shadows and blurs, one or a list. */
	effect?: Effect | Effect[];
	/** Rounds the corners, in px; one number, or four from the top-left clockwise. */
	cornerRadius?: NumberOrVariable | NumberOrVariable[];

	// Frames.
	/** The items inside, in drawing order: the first is at the back. */
	children?: PenNode[];
	/** How the children are placed: in a row (a frame's default), in a column, or each at its own `x`, `y`. */
	layout?: "none" | "vertical" | "horizontal";
	/** Space between children along the layout, in px. */
	gap?: NumberOrVariable;
	/** Whether a child's stroke counts in the layout. */
	layoutIncludeStroke?: boolean;
	/** Space inside the edge, round every child: one number, [vertical, horizontal], or [top, right, bottom, left]. */
	padding?: NumberOrVariable | NumberOrVariable[];
	/** Where the children sit along the layout, and how spare room is shared. */
	justifyContent?: "start" | "center" | "end" | "space_between" | "space_around";
	/** Where the children sit across the layout. */
	alignItems?: "start" | "center" | "end";
	/** Cuts off whatever reaches outside the frame. */
	clip?: boolean | Variable;
	/** A frame still being made; Decks draws it as unfinished. */
	placeholder?: boolean;
	/** In a component, marks this frame as a place a copy fills with its own children; a list names the components suggested for it. */
	slot?: false | string[];

	// Ellipses and polygons.
	/** A ring: the hole's size, 0 (none) to 1, of the ellipse. */
	innerRadius?: NumberOrVariable;
	/** An arc: where it starts, in degrees. */
	startAngle?: NumberOrVariable;
	/** An arc: how far round it goes from `startAngle`, in degrees, counter-clockwise when positive; 360 is whole. */
	sweepAngle?: NumberOrVariable;
	/** How many sides a polygon has. */
	polygonCount?: NumberOrVariable;

	// Paths.
	/** The outline, as an SVG path's `d`. */
	geometry?: string;
	/** The part of the path's coordinates that is stretched to the item's box: [x, y, width, height]. */
	viewBox?: [number, number, number, number];
	/** Which parts of a path that crosses itself are filled. */
	fillRule?: "nonzero" | "evenodd";

	// Text, notes, prompts and contexts.
	/** The words. One starting with `$` is a variable. */
	content?: string;
	/** `auto`: one line as long as the words, ignoring width; `fixed-width`: wraps at the width and grows down; `fixed-width-height`: the box given, words may overflow. */
	textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
	/** Any Google font, by name: "Inter". */
	fontFamily?: string;
	/** In px. */
	fontSize?: NumberOrVariable;
	/** "400" regular to "700" bold, or 100 to 900. */
	fontWeight?: string | number;
	/** "normal" or "italic". */
	fontStyle?: string;
	/** Extra space between letters, in px. */
	letterSpacing?: NumberOrVariable;
	/** Lines apart, as a multiple of the font size: 1.4 for reading, 1.1 for big titles. */
	lineHeight?: NumberOrVariable;
	/** Where lines sit in the box; seen when the box is wider than the words. */
	textAlign?: "left" | "center" | "right" | "justify";
	/** Where the words sit in a `fixed-width-height` box. */
	textAlignVertical?: "top" | "middle" | "bottom";
	/** Underlines the words. */
	underline?: boolean | Variable;
	/** Strikes the words through. */
	strikethrough?: boolean | Variable;
	/** Makes the words a link to this address. */
	href?: string;

	// Browsers: a live page.
	/** The page's address. */
	url?: string;
	/** A device preset to show the page as; left out, the page fits the box. */
	deviceId?: string;
	/** How large the page is drawn, 1 being its own size. */
	zoom?: number;
	/** How far the page is scrolled across, in px. */
	scrollX?: number;
	/** How far the page is scrolled down, in px. */
	scrollY?: number;

	// Prompts.
	/** The model the prompt is for. */
	model?: string;

	// Icons.
	/** The icon set: "lucide", "feather", "phosphor", or "Material Symbols Outlined", "Rounded" or "Sharp". */
	library?: string;
	/** The icon's name in its set: "rocket". */
	icon?: string;
	/** A variable font's weight, 100 to 700, for the libraries that have one. */
	weight?: NumberOrVariable;
	/** The older `icon_font` item's library. */
	iconFontFamily?: string;
	/** The older `icon_font` item's icon. */
	iconFontName?: string;

	// Scripts.
	/** The JavaScript file that makes the item's children, relative to the .pen file. */
	scriptUri?: string;
	/** The script's inputs, by name. */
	inputs?: Record<string, string | number | boolean>;

	// Refs: an instance of a reusable item.
	/** The id of the item copied; `"name:id"` for one from an imported file. */
	ref?: string;
	/** Changes inside the copy, by the id path of what they change: `{ "label": { content: "Buy" } }`. With a `type`, that child is replaced whole. */
	descendants?: Record<string, Record<string, unknown>>;

	[key: string]: unknown;
}

export type VariableValue = string | number | boolean;

export interface PenVariable {
	type: "boolean" | "color" | "number" | "string";
	value: VariableValue | Array<{ value: VariableValue; theme?: Record<string, string> }>;
}

/**
 * The documents a file `imports`, by the short name it gives each, read by the server and handed
 * over beside the document (`withImported`); never saved. A ref says `"name:id"` to use an item
 * from one, and its variables resolve from that file's.
 */
export const IMPORTED = "decks.imported";

export interface PenDocument {
	version: string;
	themes?: Record<string, string[]>;
	imports?: Record<string, string>;
	[IMPORTED]?: Record<string, PenDocument>;
	variables?: Record<string, PenVariable>;
	children: PenNode[];
	[key: string]: unknown;
}

/** A box on the stage, both corners, so a reader never adds a width to find an edge. */
export interface Box {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}
