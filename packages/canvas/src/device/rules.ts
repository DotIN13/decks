/**
 * The rules table (`rules.json`) and its column for one device.
 *
 * Every number and choice that differs between a desk, a tablet and a phone, and the ones that do
 * not, are rows of one file. This module reads it and says what a row comes to for a profile; it
 * reads nothing of the page, so the editor's core may import it, and the engine's editor crate reads
 * the same file. Which profile this page is is `profile.ts`'s to say.
 */
import table from "./rules.json" with { type: "json" };
import type { PointerKind } from "../edit/model.ts";

/** A desk is a fine pointer; a tablet and a phone are touch screens, a phone under 600 px on its short side. */
export type Form = "desk" | "tablet" | "phone";
/** The operating system's kind: a mobile one (iOS, iPadOS, Android) gives a page one thread and a hard memory ceiling. */
export type Os = "computer" | "mobile";
/** The engine that draws the page: WebKit (Safari, every iOS browser), Chromium, or another (Firefox). */
export type Engine = "webkit" | "chromium" | "other";
/** How much picture memory the GPU can take. */
export type GpuClass = "big" | "small" | "phone";
export type { PointerKind };

/** Which column of the table applies here. */
export type Profile = { form: Form; os: Os; engine: Engine };

export const FORMS: readonly Form[] = ["desk", "tablet", "phone"];
export const POINTERS: readonly PointerKind[] = ["mouse", "pen", "touch"];

type Axis = "form" | "pointer" | "os" | "engine" | "gpu";
const COLUMNS: Record<Axis, readonly string[]> = { form: FORMS, pointer: POINTERS, os: ["computer", "mobile"], engine: ["webkit", "chromium", "other"], gpu: ["big", "small", "phone"] };

/** One row as the file has it. */
export type Row = { by?: Axis; value?: unknown; says: string; [column: string]: unknown };
export const ROWS = (table as { rules: Record<string, Row> }).rules;

/**
 * What a row is for a profile: its one value, or the profile's column of it. A row that differs by
 * pointer or by GPU class is answered whole, as a record, since one device has all three pointers
 * and its GPU class is learned later (`render/device.ts`).
 */
export function cell(name: string, profile: Profile): unknown {
	const row = ROWS[name];
	if (!row) throw new Error(`no rule "${name}" in device/rules.json`);
	if (!row.by) return row.value;
	if (row.by === "pointer" || row.by === "gpu") return Object.fromEntries(COLUMNS[row.by].map((column) => [column, row[column]]));
	return row[profile[row.by]];
}

export type AwakeBudget = { live: { card: number; app: number; document: number }; kept: number };
export type Layers = { scaling: boolean; sliding: boolean };
export type Moving = "live" | "cover";

/** The whole table, for one profile, under names the code reads. */
export type Rules = {
	slop: Record<PointerKind, number>;
	tapMs: number;
	tapPx: number;
	secondTapMs: number;
	secondTapOnItem: "open-words" | "activate";
	bareSecondTapMs: number;
	bareSecondTapPx: number;
	clickAfterPanMs: number;
	clickAfterMakeMs: number;
	holdMs: number;
	holdOnItem: "none" | "menu";
	holdOnBare: "none" | "marquee";
	hover: boolean;
	pressOnLivePage: "page" | "cover";
	copyWithAlt: Record<PointerKind, boolean>;
	penOnBare: "draw";
	handleSize: number;
	handleShape: "square" | "round";
	handleWhich: "eight" | "corners";
	handleReach: number;
	handleMin: number;
	sizeLabel: boolean;
	arrowAnchors: boolean;
	anchorSize: number;
	anchorOut: number;
	arrowEnd: number;
	arrowBend: number;
	lineReach: number;
	edgeOut: number;
	edgeIn: number;
	snapPx: number;
	snapBy: Record<PointerKind, boolean>;
	readingGap: number;
	joinPx: number;
	sidePx: number;
	slidePx: number;
	nearPx: number;
	glideMs: number;
	selectionFadeMs: number;
	pillPlace: "either" | "below";
	nudge: number;
	nudgeShift: number;
	duplicateOffset: number;
	panBy: "browser";
	coastBy: "os" | "ours";
	coastTauMs: number;
	pinchTravel: number;
	wheelTravel: number;
	liveZoom: number;
	pictureFadeMs: number;
	layers: Layers;
	moving: { card: Moving; app: Moving; document: Moving };
	tools: "column" | "row";
	properties: "panel" | "popover" | "sheet";
	propertiesOpen: "with-selection" | "from-pill";
	zoomBar: boolean;
	conversation: "panel" | "sheet";
	awake: AwakeBudget;
	filesLive: number;
	pictures: Record<GpuClass, { ladder: readonly number[]; budgetMB: number }>;
};

/** Which row each name reads. Every row of the file is named here once, and a test holds the two together. */
export const NAMES: Record<keyof Rules, string> = {
	slop: "press.slop-px",
	tapMs: "tap.ms",
	tapPx: "tap.px",
	secondTapMs: "tap.second-ms",
	secondTapOnItem: "tap.second-on-item",
	bareSecondTapMs: "tap.bare-second-ms",
	bareSecondTapPx: "tap.bare-second-px",
	clickAfterPanMs: "click.after-pan-ms",
	clickAfterMakeMs: "click.after-make-ms",
	holdMs: "hold.ms",
	holdOnItem: "hold.on-item",
	holdOnBare: "hold.on-bare",
	hover: "hover.outline",
	pressOnLivePage: "press.on-live-page",
	copyWithAlt: "drag.copy-with-alt",
	penOnBare: "pen.on-bare",
	handleSize: "handle.size-px",
	handleShape: "handle.shape",
	handleWhich: "handle.which",
	handleReach: "handle.reach-px",
	handleMin: "handle.min-px",
	sizeLabel: "handle.size-label",
	arrowAnchors: "arrow.anchors",
	anchorSize: "arrow.anchor-px",
	anchorOut: "arrow.anchor-out-px",
	arrowEnd: "arrow.end-px",
	arrowBend: "arrow.bend-px",
	lineReach: "line.reach-px",
	edgeOut: "edge.out-px",
	edgeIn: "edge.in-px",
	snapPx: "snap.px",
	snapBy: "snap.by-pointer",
	readingGap: "snap.reading-gap-px",
	joinPx: "arrow.join-px",
	sidePx: "arrow.side-px",
	slidePx: "arrow.slide-px",
	nearPx: "drop.near-px",
	glideMs: "glide.ms",
	selectionFadeMs: "selection.fade-ms",
	pillPlace: "pill.place",
	nudge: "nudge.px",
	nudgeShift: "nudge.shift-px",
	duplicateOffset: "duplicate.offset-px",
	panBy: "pan.by",
	coastBy: "coast.by",
	coastTauMs: "coast.tau-ms",
	pinchTravel: "pinch.travel-px",
	wheelTravel: "wheel.travel-px",
	liveZoom: "live.zoom",
	pictureFadeMs: "picture.fade-ms",
	layers: "layers",
	moving: "moving",
	tools: "tools",
	properties: "properties",
	propertiesOpen: "properties.opens",
	zoomBar: "zoom-bar",
	conversation: "conversation",
	awake: "awake",
	filesLive: "files.live",
	pictures: "pictures",
};

/** The table's column for a profile. */
export function rulesFor(profile: Profile): Rules {
	return Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, cell(name, profile)])) as Rules;
}

/** The desk's column: what the editor's core reads where a rule is the same on every form. */
export const SAME: Rules = rulesFor({ form: "desk", os: "computer", engine: "chromium" });
