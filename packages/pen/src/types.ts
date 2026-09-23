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
	type: string;
	/** Unique in the document; never contains `/`, which separates the steps of an id path. */
	id: string;
	name?: string;
	context?: string;
	reusable?: boolean;
	theme?: Record<string, string>;
	enabled?: boolean | Variable;
	opacity?: NumberOrVariable;
	flipX?: boolean | Variable;
	flipY?: boolean | Variable;
	/** `absolute` takes the item out of its parent's layout. */
	layoutPosition?: "auto" | "absolute";
	/** pen's extension point: anything pen.dev has no field for rides here. */
	metadata?: { type: string; [key: string]: unknown };
	/** Degrees counter-clockwise, about the top-left corner. */
	rotation?: NumberOrVariable;

	/** From the parent's top-left corner; ignored inside a flex layout. */
	x?: number;
	y?: number;
	width?: SizeValue;
	height?: SizeValue;

	fill?: Fills;
	stroke?: Fills | LegacyStroke;
	strokeWidth?: NumberOrVariable | { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable };
	strokeLinecap?: "butt" | "round" | "square";
	strokeLinejoin?: "miter" | "bevel" | "round";
	strokeAlignment?: "inner" | "center" | "outer";
	effect?: Effect | Effect[];
	cornerRadius?: NumberOrVariable | NumberOrVariable[];

	/** Frames. `layout` defaults to horizontal on a frame, and to none on anything else. */
	children?: PenNode[];
	layout?: "none" | "vertical" | "horizontal";
	gap?: NumberOrVariable;
	padding?: NumberOrVariable | NumberOrVariable[];
	justifyContent?: "start" | "center" | "end" | "space_between" | "space_around";
	alignItems?: "start" | "center" | "end";
	clip?: boolean | Variable;
	slot?: false | string[];

	/** Ellipses and polygons. */
	innerRadius?: NumberOrVariable;
	startAngle?: NumberOrVariable;
	sweepAngle?: NumberOrVariable;
	polygonCount?: NumberOrVariable;

	/** Paths. */
	geometry?: string;
	viewBox?: [number, number, number, number];
	fillRule?: "nonzero" | "evenodd";

	/** Text, notes, prompts and contexts. */
	content?: string;
	textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
	fontFamily?: string;
	fontSize?: NumberOrVariable;
	fontWeight?: string | number;
	fontStyle?: string;
	letterSpacing?: NumberOrVariable;
	lineHeight?: NumberOrVariable;
	textAlign?: "left" | "center" | "right" | "justify";
	textAlignVertical?: "top" | "middle" | "bottom";
	underline?: boolean | Variable;
	strikethrough?: boolean | Variable;
	href?: string;

	/** Browsers: a live page. */
	url?: string;
	zoom?: number;
	scrollX?: number;
	scrollY?: number;

	/** Icons. */
	library?: string;
	icon?: string;

	/** Refs: an instance of a reusable item, with overrides by id path. */
	ref?: string;
	descendants?: Record<string, Record<string, unknown>>;

	[key: string]: unknown;
}

export type VariableValue = string | number | boolean;

export interface PenVariable {
	type: "boolean" | "color" | "number" | "string";
	value: VariableValue | Array<{ value: VariableValue; theme?: Record<string, string> }>;
}

export interface PenDocument {
	version: string;
	themes?: Record<string, string[]>;
	imports?: Record<string, string>;
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
