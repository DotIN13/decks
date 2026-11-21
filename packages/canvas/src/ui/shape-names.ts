import { m } from "@decks/i18n";

/**
 * The library shapes' names and groups (`@decks/pen`'s `SHAPES`) in the person's language, for the
 * insert menu and the properties panel. The file keeps the English name (`metadata.kind`); only what
 * is shown is translated. A name not listed here is shown as it is.
 */
const SHAPE_NAMES: Record<string, () => string> = {
	Rectangle: m.canvas_shape_rectangle,
	Rounded: m.canvas_shape_rounded,
	Ellipse: m.canvas_shape_ellipse,
	Triangle: m.canvas_shape_triangle,
	Diamond: m.canvas_shape_diamond,
	Pentagon: m.canvas_shape_pentagon,
	Hexagon: m.canvas_shape_hexagon,
	Octagon: m.canvas_shape_octagon,
	Star: m.canvas_shape_star,
	Parallelogram: m.canvas_shape_parallelogram,
	Trapezoid: m.canvas_shape_trapezoid,
	Plus: m.canvas_shape_plus,
	Ring: m.canvas_shape_ring,
	Heart: m.canvas_shape_heart,
	Process: m.canvas_shape_process,
	Decision: m.canvas_shape_decision,
	Terminator: m.canvas_shape_terminator,
	Document: m.canvas_shape_document,
	Data: m.canvas_shape_data,
	Database: m.canvas_shape_database,
	"Manual input": m.canvas_shape_manual_input,
	Predefined: m.canvas_shape_predefined,
	Delay: m.canvas_shape_delay,
	"Off-page": m.canvas_shape_off_page,
	Preparation: m.canvas_shape_preparation,
	Card: m.canvas_shape_card,
	"Arrow right": m.canvas_shape_arrow_right,
	"Arrow both": m.canvas_shape_arrow_both,
	Chevron: m.canvas_shape_chevron,
	Speech: m.canvas_shape_speech,
	Cloud: m.canvas_shape_cloud,
	Brace: m.canvas_shape_brace,
};

const GROUP_NAMES: Record<string, () => string> = {
	Basic: m.canvas_shape_group_basic,
	Flowchart: m.canvas_shape_group_flowchart,
	"Arrows and callouts": m.canvas_shape_group_arrows,
};

/** A library shape's name as the person reads it. */
export const shapeName = (name: string): string => SHAPE_NAMES[name]?.() ?? name;

/** A group of library shapes, as the person reads it. */
export const shapeGroupName = (group: string): string => GROUP_NAMES[group]?.() ?? group;
