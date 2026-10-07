import { arrowEndItem, arrowEndSide, arrowLabel, arrowStyle, indexOf, isArrow, isCard, isMarkdown, isPointEnd, isShape, parseColor, toHex, makeLabel, newId, ids as penIds, SHAPES, shapeKind, shapeLabel, shapeOutline, type ArrowSide, type PenDocument, type PenNode } from "@decks/pen";
import type { LucideIcon } from "lucide-solid";
import AlignCenterHorizontal from "lucide-solid/icons/align-center-horizontal";
import AlignCenterVertical from "lucide-solid/icons/align-center-vertical";
import AlignEndHorizontal from "lucide-solid/icons/align-end-horizontal";
import AlignEndVertical from "lucide-solid/icons/align-end-vertical";
import AlignHorizontalSpaceAround from "lucide-solid/icons/align-horizontal-space-around";
import AlignStartHorizontal from "lucide-solid/icons/align-start-horizontal";
import AlignStartVertical from "lucide-solid/icons/align-start-vertical";
import AlignVerticalSpaceAround from "lucide-solid/icons/align-vertical-space-around";
import ArrowLeftRight from "lucide-solid/icons/arrow-left-right";
import ArrowRight from "lucide-solid/icons/arrow-right";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import Bold from "lucide-solid/icons/bold";
import BringToFront from "lucide-solid/icons/bring-to-front";
import Copy from "lucide-solid/icons/copy";
import CornerDownRight from "lucide-solid/icons/corner-down-right";
import FileDown from "lucide-solid/icons/file-down";
import FlipHorizontal2 from "lucide-solid/icons/flip-horizontal-2";
import FlipVertical2 from "lucide-solid/icons/flip-vertical-2";
import FrameIcon from "lucide-solid/icons/frame";
import ImageDown from "lucide-solid/icons/image-down";
import Italic from "lucide-solid/icons/italic";
import Layers from "lucide-solid/icons/layers";
import Lock from "lucide-solid/icons/lock";
import LockOpen from "lucide-solid/icons/lock-open";
import Minus from "lucide-solid/icons/minus";
import MoveRight from "lucide-solid/icons/move-right";
import SendToBack from "lucide-solid/icons/send-to-back";
import Shapes from "lucide-solid/icons/shapes";
import SmilePlus from "lucide-solid/icons/smile-plus";
import Spline from "lucide-solid/icons/spline";
import Square from "lucide-solid/icons/square";
import StickyNote from "lucide-solid/icons/sticky-note";
import TextAlignCenter from "lucide-solid/icons/text-align-center";
import TextAlignEnd from "lucide-solid/icons/text-align-end";
import TextAlignStart from "lucide-solid/icons/text-align-start";
import Trash2 from "lucide-solid/icons/trash-2";
import Type from "lucide-solid/icons/type";
import X from "lucide-solid/icons/x";
import { obsidianNote } from "./card-frame.ts";
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { isPhone } from "../../camera/camera.ts";
import { penBoxes, penSelection, penTyping, setInsertPanel, setPenLive, setPenSelection } from "../../state/pen-tools.ts";
import { Icon } from "../../ui/icons.tsx";
import { ColorPicker } from "./ColorPicker.tsx";
import { ICON_LIBRARIES } from "./icon-index.ts";

/**
 * The properties panel: everything about what is selected in the drawing, in the board inspector's
 * corner (top right, a sheet along the bottom on a phone).
 *
 * It shows only what the selection has: a shape its kind, fill, line and words; an arrow its route,
 * heads, sides and words; an icon its library, name and weight; words their font. Position, size,
 * turn and opacity, shadow and blur, and the arrange buttons are for everything. With several items
 * picked, a value they do not share reads Mixed, and setting it sets all of them.
 *
 * Every control sends the pen edit an agent would send (`stage.pen.edit`), so what the panel does
 * is what the file says. It is 276 px wide and scrolls only down: every row is built from columns
 * that shrink and sets of buttons that wrap, so a long value wraps rather than pushing the panel
 * sideways.
 */
const SWATCHES = ["#ffffff", "#dbe4f0", "#fde68a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#1f2328"];
const LINES = ["#1f2328", "#57606a", "#8a8f98", "#2563eb", "#16a34a", "#d97706", "#dc2626", "#ffffff"];
const TEXTY = new Set(["text", "note", "prompt", "context"]);
const FONTS = ["Inter", "JetBrains Mono", "Source Serif 4", "Merriweather", "Caveat", "Space Grotesk", "IBM Plex Sans", "Noto Sans SC"];
const WEIGHTS = [300, 400, 500, 600, 700, 800];
const MIXED = "Mixed";

type Kind = "shape" | "arrow" | "text" | "note" | "icon" | "frame" | "rectangle" | "ellipse" | "polygon" | "path" | "group" | "other";
function kindOf(node: PenNode): Kind {
	if (isShape(node)) return "shape";
	if (isArrow(node)) return "arrow";
	if (node.type === "text") return "text";
	if (TEXTY.has(node.type)) return "note";
	if (node.type === "icon" || node.type === "icon_font") return "icon";
	if (["frame", "rectangle", "ellipse", "polygon", "path", "group"].includes(node.type)) return node.type as Kind;
	return "other";
}
const KIND_ICON: Record<Kind, LucideIcon> = { shape: Shapes, arrow: ArrowUpRight, text: Type, note: StickyNote, icon: SmilePlus, frame: FrameIcon, rectangle: Square, ellipse: Square, polygon: Shapes, path: Spline, group: Layers, other: Square };

/** The colour a value names, for the colour input: a hex colour, or undefined for a variable or a gradient. */
export const hexOf = (value: unknown): string | undefined => {
	const first = Array.isArray(value) ? value[0] : value;
	const type = first && typeof first === "object" ? (first as { type?: string }).type : undefined;
	const text = typeof first === "string" ? first : type === "color" || type === "solid" ? (first as { color?: unknown }).color : undefined;
	// Whatever notation it is written in: the swatches and the field speak hex (`@decks/pen`).
	return typeof text === "string" ? toHex(parseColor(text)) : undefined;
};
type FillMode = "none" | "solid" | "linear" | "radial";
const gradientOf = (value: unknown): { type: "gradient"; gradientType?: string; rotation?: unknown; colors?: Array<{ color: string; position: number }> } | undefined => {
	const first = Array.isArray(value) ? value[0] : value;
	return first && typeof first === "object" && (first as { type?: string }).type === "gradient" ? (first as never) : undefined;
};
const fillModeOf = (node: PenNode): FillMode => {
	if (node.fill === undefined || node.fill === null || (Array.isArray(node.fill) && node.fill.length === 0)) return "none";
	const gradient = gradientOf(node.fill);
	if (gradient) return gradient.gradientType === "radial" ? "radial" : "linear";
	return "solid";
};
/** A stroke written in pen's older one-object spelling, which is changed in that spelling. */
const legacyStroke = (node: PenNode) => (node.stroke && typeof node.stroke === "object" && !Array.isArray(node.stroke) && !("type" in node.stroke) ? (node.stroke as Record<string, unknown>) : undefined);
const lineWidthOf = (node: PenNode): number => {
	if (node.stroke === undefined || node.stroke === null) return 0;
	const legacy = legacyStroke(node);
	const width = legacy ? legacy.thickness : node.strokeWidth;
	return typeof width === "number" ? width : 1;
};
const lineColorOf = (node: PenNode): string | undefined => {
	const legacy = legacyStroke(node);
	return hexOf(legacy ? legacy.fill : node.stroke);
};
const numberOf = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
/** One value for every item, or Mixed. */
function shared<T>(list: readonly PenNode[], read: (node: PenNode) => T): T | typeof MIXED | undefined {
	if (list.length === 0) return undefined;
	const first = read(list[0]!);
	return list.every((node) => read(node) === first) ? first : MIXED;
}

/** Which sections stay open, for the page's life: a section shut stays shut from one selection to the next. */
const [shut, setShut] = createSignal<ReadonlySet<string>>(new Set(["effects"]));

export function Properties(props: {
	doc: PenDocument | undefined;
	onEdit: (ops: unknown[]) => void;
	/** Download a picture of these items, taken by the server (`server/stage/shots.ts`). */
	onExport: (ids: string[]) => void;
}) {
	const index = createMemo(() => (props.doc ? indexOf(props.doc) : new Map()));
	const selected = createMemo(() => penSelection().flatMap((id) => {
		const found = index().get(id);
		return found ? [found.node as PenNode] : [];
	}));
	const single = () => (selected().length === 1 ? selected()[0] : undefined);
	const kinds = createMemo(() => new Set(selected().map(kindOf)));
	const has = (kind: Kind) => kinds().has(kind);

	/** What a fill, a line, words or an effect is set on: a shape's outline and words, or the item itself. */
	const fillTargets = createMemo(() =>
		selected().flatMap((node) => {
			const kind = kindOf(node);
			if (kind === "shape") return shapeOutline(node) ? [shapeOutline(node)!] : [];
			return ["rectangle", "ellipse", "polygon", "frame", "path", "note"].includes(kind) ? [node] : [];
		}),
	);
	const lineTargets = createMemo(() =>
		selected().flatMap((node) => {
			const kind = kindOf(node);
			if (kind === "shape") return shapeOutline(node) ? [shapeOutline(node)!] : [];
			return ["rectangle", "ellipse", "polygon", "frame", "path", "arrow"].includes(kind) ? [node] : [];
		}),
	);
	const wordTargets = createMemo(() =>
		selected().flatMap((node) => {
			const kind = kindOf(node);
			if (kind === "shape") return shapeLabel(node) ? [shapeLabel(node)!] : [];
			return kind === "text" || kind === "note" ? [node] : [];
		}),
	);
	const effectTargets = createMemo(() =>
		selected().flatMap((node) => {
			const kind = kindOf(node);
			if (kind === "shape") return shapeOutline(node) ? [shapeOutline(node)!] : [];
			return kind === "group" || kind === "arrow" ? [] : [node];
		}),
	);
	const setTextColor = (color: string, drawOnly?: boolean) => writer(drawOnly)(wordTargets().filter((node) => node.type === "text"), () => ({ fill: color }));
	const setIconColor = (color: string, drawOnly?: boolean) => writer(drawOnly)(icons(), () => ({ fill: color }));
	const arrows = createMemo(() => selected().filter(isArrow));
	const icons = createMemo(() => selected().filter((node) => kindOf(node) === "icon"));
	const shapes = createMemo(() => selected().filter(isShape));

	const edit = (ops: unknown[]) => {
		if (ops.length) props.onEdit(ops);
	};
	const set = (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) => edit(nodes.map((node) => ({ op: "update", id: node.id, set: fields(node) })));
	/**
	 * The same change, drawn on the stage and not saved: what a colour picker sends while the hand is
	 * still down, so the colour follows the pointer and the file takes one edit when it lifts
	 * (`state/pen-tools.ts`, `penLive`).
	 */
	const show = (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) =>
		setPenLive(nodes.length ? nodes.map((node) => ({ id: node.id, set: fields(node) })) : undefined);
	const writer = (live?: boolean) => (live ? show : set);
	/** A colour control's live drag: each step drawn, nothing saved, and nothing is the drawing itself again. */
	const live = (apply: (color: string) => void) => (color?: string) => (color === undefined ? setPenLive(undefined) : apply(color));

	// --- fill ------------------------------------------------------------------------------------
	const fillMode = () => shared(fillTargets(), fillModeOf);
	const fillHex = () => shared(fillTargets(), (node) => hexOf(node.fill) ?? hexOf(gradientOf(node.fill)?.colors?.[0]?.color));
	const setFillMode = (mode: FillMode) =>
		set(fillTargets(), (node) => {
			const base = hexOf(node.fill) ?? hexOf(gradientOf(node.fill)?.colors?.[0]?.color) ?? "#dbe4f0";
			if (mode === "none") return { fill: null };
			if (mode === "solid") return { fill: base };
			const end = gradientOf(node.fill)?.colors?.[1]?.color ?? "#ffffff";
			return { fill: { type: "gradient", gradientType: mode, rotation: numberOf(gradientOf(node.fill)?.rotation, 90), colors: [{ color: base, position: 0 }, { color: end, position: 1 }] } };
		});
	const setFillColor = (color: string, stop = 0, drawOnly?: boolean) =>
		writer(drawOnly)(fillTargets(), (node) => {
			const gradient = gradientOf(node.fill);
			if (!gradient) return { fill: color };
			const colors = [...(gradient.colors ?? [{ color, position: 0 }, { color: "#ffffff", position: 1 }])];
			colors[stop] = { color, position: stop === 0 ? 0 : 1 };
			return { fill: { ...gradient, colors } };
		});
	const gradientEnd = () => shared(fillTargets(), (node) => hexOf(gradientOf(node.fill)?.colors?.[1]?.color));
	const gradientTurn = () => shared(fillTargets(), (node) => numberOf(gradientOf(node.fill)?.rotation, 90));

	// --- line ------------------------------------------------------------------------------------
	const lineColor = () => shared(lineTargets(), (node) => lineColorOf(node));
	const lineWidth = () => shared(lineTargets(), lineWidthOf);
	const setLineColor = (color: string, drawOnly?: boolean) =>
		writer(drawOnly)(lineTargets(), (node) => {
			const legacy = legacyStroke(node);
			return legacy ? { stroke: { ...legacy, fill: color } } : { stroke: color, ...(node.strokeWidth === undefined ? { strokeWidth: 1.5 } : {}) };
		});
	const setLineWidth = (width: number) =>
		set(lineTargets(), (node) => {
			const legacy = legacyStroke(node);
			if (legacy) return width === 0 ? { stroke: null } : { stroke: { ...legacy, thickness: width } };
			if (width <= 0) return isArrow(node) ? { strokeWidth: 1 } : { stroke: null, strokeWidth: null };
			return { strokeWidth: width, ...(node.stroke === undefined || node.stroke === null ? { stroke: "#1f2328" } : {}) };
		});
	const dashOf = (node: PenNode): "solid" | "dashed" | "dotted" => (isArrow(node) ? (arrowStyle(node.metadata).dash ? "dashed" : "solid") : node.strokeDash === "dashed" || node.strokeDash === "dotted" ? node.strokeDash : "solid");
	const lineDash = () => shared(lineTargets(), dashOf);
	const setDash = (dash: "solid" | "dashed" | "dotted") =>
		set(lineTargets(), (node) => (isArrow(node) ? { metadata: { ...(node.metadata ?? {}), dash: dash === "solid" ? undefined : true } } : { strokeDash: dash === "solid" ? null : dash }));
	const closedLines = () => lineTargets().filter((node) => !isArrow(node));
	const lineAlign = () => shared(closedLines(), (node) => node.strokeAlignment ?? (node.type === "path" ? "center" : "inner"));

	// --- words -----------------------------------------------------------------------------------
	const words = () => wordTargets();
	const fontFamily = () => shared(words(), (node) => (typeof node.fontFamily === "string" ? node.fontFamily : "Inter"));
	const fontSize = () => shared(words(), (node) => numberOf(node.fontSize, node.type === "text" ? 14 : 14));
	const fontWeight = () => shared(words(), (node) => Number(node.fontWeight ?? 400));
	const italic = () => shared(words(), (node) => node.fontStyle === "italic");
	const textAlign = () => shared(words(), (node) => node.textAlign ?? "left");
	const textColor = () => shared(words().filter((node) => node.type === "text"), (node) => hexOf(node.fill));
	const lineHeight = () => shared(words(), (node) => numberOf(node.lineHeight, 0));
	const spacing = () => shared(words(), (node) => numberOf(node.letterSpacing, 0));
	/** A shape's words, typed in the panel: its text, or a new one made inside it. */
	const setShapeWords = (shape: PenNode, content: string) => {
		const label = shapeLabel(shape);
		if (label) return edit([content ? { op: "update", id: label.id, set: { content } } : { op: "delete", id: label.id }]);
		if (!content || !props.doc) return;
		edit([{ op: "insert", parent: shape.id, node: makeLabel(newId(penIds(props.doc)), content) }]);
	};
	/**
	 * Frames of the selection that are frames in their own right, not a shape from the library.
	 *
	 * A frame is the one item that holds others, and the panel showed nothing about how it holds
	 * them: pen gives it a direction, a gap, padding, two alignments, clipping and a size that can
	 * hug its children, and every one of those was unreachable. A library shape is a frame too, and
	 * is left out — its layout is how its own words sit, which it has its own control for.
	 */
	const frames = () => selected().filter((node) => node.type === "frame" && !isShape(node));
	const frameFlow = () => shared(frames(), (node) => (node.layout === "vertical" ? "vertical" : node.layout === "horizontal" ? "horizontal" : "none"));
	const framePad = () => shared(frames(), (node) => numberOf(Array.isArray(node.padding) ? node.padding[0] : node.padding, 0));
	const frameGap = () => shared(frames(), (node) => numberOf(node.gap, 0));
	const frameAlong = () => shared(frames(), (node) => (node.justifyContent === "end" ? "end" : node.justifyContent === "center" ? "center" : node.justifyContent === "space_between" ? "space_between" : "start"));
	const frameAcross = () => shared(frames(), (node) => (node.alignItems === "end" ? "end" : node.alignItems === "center" ? "center" : "start"));
	const frameClips = () => shared(frames(), (node) => node.clip !== false);
	/** Whether a frame's size follows its children. pen's own word for it is `fit_content`. */
	const frameHugs = (field: "width" | "height") => shared(frames(), (node) => typeof node[field] === "string" && /^(fit|hug)/.test(String(node[field])));
	/*
	 * Turning hugging off needs a number, and the number is the size the frame is right now, which
	 * the panel already keeps for every selected item (`penBoxes`). Without that a frame would snap
	 * to pen's own fallback the moment it was pinned.
	 */
	const setHug = (field: "width" | "height", hug: boolean) =>
		set(frames(), (node) => {
			/*
			 * `fit_content(120)` is pen's own hug with a fallback, which the layout pass uses when the
			 * frame has no children: a floor, so a frame that follows its children does not collapse to
			 * nothing the moment it is emptied and leave nothing to drop into.
			 */
			if (hug) return { [field]: field === "height" ? "fit_content(120)" : "fit_content" };
			const box = penBoxes().get(node.id);
			const now = field === "width" ? box?.w : box?.h;
			return { [field]: Math.max(1, Math.round(now ?? 100)) };
		});

	/** Where a shape's words sit, top to bottom: its frame's layout. */
	const shapeVertical = () => shared(shapes(), (node) => (node.justifyContent === "start" ? "top" : node.justifyContent === "end" ? "bottom" : "middle"));

	// --- position --------------------------------------------------------------------------------
	const [keepRatio, setKeepRatio] = createSignal(false);
	const box = () => {
		const node = single();
		return node ? penBoxes().get(node.id) : undefined;
	};
	const setBox = (patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
		const node = single();
		const was = box();
		if (!node || !was) return;
		let { x, y, w, h } = { ...was, ...patch };
		if (keepRatio() && was.w > 0 && was.h > 0) {
			if (patch.w !== undefined && patch.h === undefined) h = Math.round((patch.w * was.h) / was.w);
			if (patch.h !== undefined && patch.w === undefined) w = Math.round((patch.h * was.w) / was.h);
		}
		w = Math.max(1, w);
		h = Math.max(1, h);
		// Words that grow with what they say are given their width only; their height is their words'.
		const sized = node.type === "text" && (node.textGrowth ?? "auto") !== "fixed-width-height" ? { x1: x, y1: y, x2: x + w } : { x1: x, y1: y, x2: x + w, y2: y + h };
		edit([{ op: "update", id: node.id, box: sized }]);
	};

	// --- arrange ---------------------------------------------------------------------------------
	const order = (where: "front" | "back") => edit(selected().map((node) => ({ op: "move", id: node.id, index: where === "front" ? 1e9 : 0 })));
	const duplicate = () => {
		const taken = props.doc ? penIds(props.doc) : new Set<string>();
		const made: string[] = [];
		edit(
			selected().flatMap((node) => {
				const as = newId(taken);
				taken.add(as);
				made.push(as);
				const beside = typeof node.x === "number" && typeof node.y === "number" ? [{ op: "update", id: as, set: { x: node.x + 24, y: node.y + 24 } }] : [];
				return [{ op: "copy", id: node.id, as }, ...beside];
			}),
		);
		setPenSelection(made);
	};
	const remove = () => {
		edit(selected().map((node) => ({ op: "delete", id: node.id })));
		setPenSelection([]);
	};
	/** Line the picked items up on one edge or middle of the box round them all. */
	const align = (how: "l" | "c" | "r" | "t" | "m" | "b") => {
		const items = selected().filter((node) => !isArrow(node)).flatMap((node) => {
			const at = penBoxes().get(node.id);
			return at ? [{ node, at }] : [];
		});
		if (items.length < 2) return;
		const x1 = Math.min(...items.map(({ at }) => at.x));
		const x2 = Math.max(...items.map(({ at }) => at.x + at.w));
		const y1 = Math.min(...items.map(({ at }) => at.y));
		const y2 = Math.max(...items.map(({ at }) => at.y + at.h));
		edit(
			items.map(({ node, at }) => {
				const x = how === "l" ? x1 : how === "r" ? x2 - at.w : how === "c" ? Math.round((x1 + x2) / 2 - at.w / 2) : at.x;
				const y = how === "t" ? y1 : how === "b" ? y2 - at.h : how === "m" ? Math.round((y1 + y2) / 2 - at.h / 2) : at.y;
				return { op: "update", id: node.id, box: { x1: x, y1: y } };
			}),
		);
	};
	/** Equal gaps between the picked items, across or down, the first and last staying where they are. */
	const distribute = (across: boolean) => {
		const items = selected().filter((node) => !isArrow(node)).flatMap((node) => {
			const at = penBoxes().get(node.id);
			return at ? [{ node, at }] : [];
		});
		if (items.length < 3) return;
		items.sort((a, b) => (across ? a.at.x - b.at.x : a.at.y - b.at.y));
		const first = items[0]!.at;
		const last = items[items.length - 1]!.at;
		const span = across ? last.x + last.w - first.x : last.y + last.h - first.y;
		const used = items.reduce((sum, { at }) => sum + (across ? at.w : at.h), 0);
		const gap = (span - used) / (items.length - 1);
		let cursor = across ? first.x : first.y;
		edit(
			items.map(({ node, at }) => {
				const op = { op: "update", id: node.id, box: across ? { x1: Math.round(cursor), y1: at.y } : { x1: at.x, y1: Math.round(cursor) } };
				cursor += (across ? at.w : at.h) + gap;
				return op;
			}),
		);
	};

	// --- arrows ----------------------------------------------------------------------------------
	const arrowSet = (patch: Record<string, unknown>) => set(arrows(), (node) => ({ metadata: { ...(node.metadata ?? {}), ...patch } }));
	const style = () => arrowStyle(arrows()[0]?.metadata);
	const endName = (end: unknown): string => {
		if (isPointEnd(end)) return "a point";
		const item = arrowEndItem(end);
		if (!item) return "nothing";
		const node = index().get(item)?.node as PenNode | undefined;
		return node ? (typeof node.name === "string" && node.name ? node.name : (shapeLabel(node)?.content as string | undefined) ?? node.type) : item.replace(/^.*\//, "");
	};
	const setSide = (which: "from" | "to", side: ArrowSide | "auto") => {
		const node = arrows()[0];
		const end = node?.metadata?.[which];
		const item = arrowEndItem(end);
		if (!node || !item) return;
		arrowSet({ [which]: side === "auto" ? item : { item, side } });
	};

	const title = () => {
		const node = single();
		if (!node) return `${selected().length} items`;
		if (typeof node.name === "string" && node.name) return node.name;
		if (isShape(node)) return String(node.metadata?.kind ?? "Shape");
		if (isArrow(node)) return "Arrow";
		if (kindOf(node) === "icon") return String(node.icon ?? "Icon");
		return node.type[0]!.toUpperCase() + node.type.slice(1);
	};

	const toggle = (key: string, open: boolean) =>
		setShut((was) => {
			const next = new Set(was);
			if (open) next.delete(key);
			else next.add(key);
			return next;
		});
	/** A card downloaded as an Obsidian note (`card-frame.ts`, `obsidianNote`), named for the card. */
	const exportNote = (node: PenNode) => {
		const name = (String(node.name ?? "") || "Card").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Card";
		const url = URL.createObjectURL(new Blob([obsidianNote(node)], { type: "text/markdown;charset=utf-8" }));
		const link = Object.assign(document.createElement("a"), { href: url, download: `${name}.md` });
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
	const Section = (p: { key: string; title: string; children: JSX.Element }) => (
		<details class="props-sec" open={!shut().has(p.key)} onToggle={(event) => toggle(p.key, event.currentTarget.open)} data-section={p.key}>
			<summary>{p.title}</summary>
			<div class="props-sec-body">{p.children}</div>
		</details>
	);

	// On a phone the sheet would cover the words being typed: it stands aside until the typing ends.
	return (
		<Show when={selected().length > 0 && !(isPhone() && penTyping())}>
			<aside class="panel-float props-panel" data-sheet={isPhone() ? "true" : undefined} aria-label="Properties" data-props>
				<header class="props-head">
					<span class="props-kind" aria-hidden="true">
						<Icon of={single() ? KIND_ICON[kindOf(single()!)] : Layers} size={14} />
					</span>
					<Show when={single()} fallback={<span class="props-title">{title()}</span>}>
						{(node) => (
							<input
								class="props-title"
								aria-label="Name"
								ref={(el) => held(el, title)}
								onChange={(event) => {
									const name = event.currentTarget.value.trim();
									set([node()], () => ({ name: name || null }));
								}}
								on:keydown={(event: KeyboardEvent) => {
									event.stopPropagation();
									if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
								}}
							/>
						)}
					</Show>
					<button type="button" class="close" aria-label="Close" title="Let go of the selection" onClick={() => setPenSelection([])}>
						<Icon of={X} size={13} />
					</button>
				</header>
				<div class="props-body">
					<Show when={shapes().length > 0}>
						<Section key="shape" title="Shape">
							<div class="props-row">
								<span class="props-label">Kind</span>
								<select
									class="props-select"
									aria-label="Kind of shape"
									value={String(shared(shapes(), (node) => String(node.metadata?.kind ?? "")) ?? "")}
									onChange={(event) => {
										const kind = shapeKind(event.currentTarget.value);
										if (!kind) return;
										edit(
											shapes().flatMap((node) => {
												const outline = shapeOutline(node);
												const renamed = !node.name || node.name === node.metadata?.kind;
												return [
													{ op: "update", id: node.id, set: { metadata: { ...(node.metadata ?? {}), kind: kind.name }, ...(renamed ? { name: kind.name } : {}) } },
													...(outline ? [{ op: "update", id: outline.id, set: { geometry: kind.geometry, fillRule: kind.fillRule ?? null, ...(kind.line ? { fill: null } : outline.fill === undefined ? { fill: "#ffffff" } : {}) } }] : []),
												];
											}),
										);
									}}
								>
									<Show when={shared(shapes(), (node) => node.metadata?.kind) === MIXED}>
										<option value={MIXED}>Mixed</option>
									</Show>
									<For each={SHAPES}>{(kind) => <option value={kind.name}>{kind.name}</option>}</For>
								</select>
							</div>
							<Show when={single() && isShape(single())}>
								<div class="props-row">
									<span class="props-label">Words</span>
									<input
										class="field props-text"
										placeholder="Double-click the shape, or type here"
										ref={(el) => held(el, () => String(shapeLabel(single()!)?.content ?? ""))}
										onChange={(event) => setShapeWords(single()!, event.currentTarget.value)}
									/>
								</div>
							</Show>
						</Section>
					</Show>

					{/*
					 * How a frame holds what is in it. Every control here writes one of pen's own
					 * fields, which the layout pass already reads; none of them was reachable before.
					 *
					 * Direction first, because it decides what the rest mean: with no direction a
					 * child sits where it was put and only padding and clipping do anything, so the
					 * gap and the two alignments are shown only once there is a direction to have
					 * them along.
					 */}
					<Show when={frames().length > 0}>
						<Section key="layout" title="Layout">
							{/*
							 * Named in CSS, not in our own words: pen's layout pass is flexbox, and every field
							 * here has a CSS property that means exactly it. Someone who knows flexbox needs no
							 * translation, and `fit-content` and `overflow` are the words they would search for.
							 */}
							<span class="props-prop">flex-direction</span>
							<div class="seg-set" role="group" aria-label="flex-direction">
								<For each={[["none", "none"], ["vertical", "column"], ["horizontal", "row"]] as const}>
									{([value, label]) => (
										<button type="button" data-on={frameFlow() === value ? "true" : undefined} aria-pressed={frameFlow() === value} onClick={() => set(frames(), () => ({ layout: value }))}>
											{label}
										</button>
									)}
								</For>
							</div>
							<div class="props-row">
								<NumField label="padding" value={framePad()} min={0} onCommit={(v) => set(frames(), () => ({ padding: v <= 0 ? null : v }))} />
								<Show when={frameFlow() !== "none"}>
									<NumField label="gap" value={frameGap()} min={0} onCommit={(v) => set(frames(), () => ({ gap: v <= 0 ? null : v }))} />
								</Show>
							</div>
							<Show when={frameFlow() !== "none"}>
								<span class="props-prop">justify-content</span>
								{/* Four values do not fit one row at 276 px, so this set wraps; the other sets do not. */}
								<div class="seg-set wrap" role="group" aria-label="justify-content">
									<For each={[["start", "start"], ["center", "center"], ["end", "end"], ["space_between", "space-between"]] as const}>
										{([value, label]) => (
											<button type="button" data-on={frameAlong() === value ? "true" : undefined} aria-pressed={frameAlong() === value} onClick={() => set(frames(), () => ({ justifyContent: value }))}>
												{label}
											</button>
										)}
									</For>
								</div>
								<span class="props-prop">align-items</span>
								<div class="seg-set" role="group" aria-label="align-items">
									<For each={["start", "center", "end"] as const}>
										{(value) => (
											<button type="button" data-on={frameAcross() === value ? "true" : undefined} aria-pressed={frameAcross() === value} onClick={() => set(frames(), () => ({ alignItems: value }))}>
												{value}
											</button>
										)}
									</For>
								</div>
							</Show>
							{/*
							 * `fit-content` is what makes dropping something into a frame visible: a frame that
							 * follows its children grows round what you put in it, where a fixed one just
							 * swallows it. One row per side, because a column that fits its height and keeps its
							 * width is the common shape. The other value is a length, so the button says px.
							 */}
							<For each={["width", "height"] as const}>
								{(field) => (
									<>
										<span class="props-prop">{field}</span>
										<div class="seg-set" role="group" aria-label={field}>
											<button type="button" data-on={frameHugs(field) === true ? "true" : undefined} aria-pressed={frameHugs(field) === true} onClick={() => setHug(field, true)}>fit-content</button>
											<button type="button" data-on={frameHugs(field) === false ? "true" : undefined} aria-pressed={frameHugs(field) === false} onClick={() => setHug(field, false)}>px</button>
										</div>
									</>
								)}
							</For>
							<span class="props-prop">overflow</span>
							<div class="seg-set" role="group" aria-label="overflow">
								<button type="button" data-on={frameClips() === true ? "true" : undefined} aria-pressed={frameClips() === true} onClick={() => set(frames(), () => ({ clip: true }))}>hidden</button>
								<button type="button" data-on={frameClips() === false ? "true" : undefined} aria-pressed={frameClips() === false} onClick={() => set(frames(), () => ({ clip: false }))}>visible</button>
							</div>
						</Section>
					</Show>

					<Show when={selected().some((node) => (node.type === "rectangle" || node.type === "frame" || node.type === "polygon") && !isShape(node))}>
						<Section key="corners" title={selected().some((node) => node.type === "polygon") ? "Sides and corners" : "Corners"}>
							<div class="props-row">
								<Show when={selected().some((node) => node.type === "polygon")}>
									<NumField label="sides" value={shared(selected().filter((node) => node.type === "polygon"), (node) => numberOf(node.polygonCount, 3))} min={3} onCommit={(v) => set(selected().filter((node) => node.type === "polygon"), () => ({ polygonCount: Math.max(3, Math.round(v)) }))} />
								</Show>
								<NumField
									label="radius"
									value={shared(selected().filter((node) => ["rectangle", "frame", "polygon"].includes(node.type) && !isShape(node)), (node) => numberOf(node.cornerRadius, 0))}
									min={0}
									onCommit={(v) => set(selected().filter((node) => ["rectangle", "frame", "polygon"].includes(node.type) && !isShape(node)), () => ({ cornerRadius: v <= 0 ? null : v }))}
								/>
							</div>
						</Section>
					</Show>

					<Show when={fillTargets().length > 0}>
						<Section key="fill" title={has("note") && fillTargets().every((node) => TEXTY.has(node.type)) ? "Paper" : "Fill"}>
							<div class="seg-set" role="group" aria-label="Fill">
								<For each={["none", "solid", "linear", "radial"] as const}>
									{(mode) => (
										<button type="button" data-on={fillMode() === mode ? "true" : undefined} aria-pressed={fillMode() === mode} onClick={() => setFillMode(mode)}>
											{mode === "none" ? "None" : mode === "solid" ? "Solid" : mode === "linear" ? "Linear" : "Radial"}
										</button>
									)}
								</For>
							</div>
							<Show when={fillMode() !== "none"}>
								<Swatches colors={SWATCHES} value={fillHex()} onPick={(color) => setFillColor(color)} label="Fill" />
								<div class="props-row">
									<span class="props-label">{fillMode() === "linear" || fillMode() === "radial" ? "From" : "Colour"}</span>
									<ColorField value={fillHex()} onCommit={(color) => setFillColor(color)} onLive={live((color) => setFillColor(color, 0, true))} label="Fill colour" />
								</div>
								<Show when={fillMode() === "linear" || fillMode() === "radial"}>
									<div class="props-row">
										<span class="props-label">To</span>
										<ColorField value={gradientEnd()} onCommit={(color) => setFillColor(color, 1)} onLive={live((color) => setFillColor(color, 1, true))} label="Second colour" />
									</div>
									<Show when={fillMode() === "linear"}>
										<div class="props-row">
											<span class="props-label">Angle</span>
											<NumField label="°" value={gradientTurn()} onCommit={(v) => set(fillTargets(), (node) => ({ fill: { ...gradientOf(node.fill), rotation: Math.round(v) % 360 } }))} />
										</div>
									</Show>
								</Show>
							</Show>
						</Section>
					</Show>

					<Show when={lineTargets().length > 0}>
						<Section key="line" title="Line">
							<Swatches colors={LINES} value={lineColor()} onPick={setLineColor} label="Line" />
							<div class="props-row">
								<span class="props-label">Colour</span>
								<ColorField value={lineColor()} onCommit={setLineColor} onLive={live((color) => setLineColor(color, true))} label="Line colour" />
							</div>
							<div class="props-row">
								<span class="props-label">Width</span>
								<NumField label="px" value={lineWidth()} min={0} step={0.5} onCommit={setLineWidth} />
								<div class="props-buttons" role="group" aria-label="Dashes">
									<IconToggle attr={{ "data-dash": "solid" }} on={lineDash() === "solid"} title="Solid" onClick={() => setDash("solid")}>
										<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M3 12h18" /></svg>
									</IconToggle>
									<IconToggle attr={{ "data-dash": "dashed" }} on={lineDash() === "dashed"} title="Dashed" onClick={() => setDash("dashed")}>
										<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M3 12h4M10 12h4M17 12h4" /></svg>
									</IconToggle>
									<Show when={arrows().length === 0}>
										<IconToggle attr={{ "data-dash": "dotted" }} on={lineDash() === "dotted"} title="Dotted" onClick={() => setDash("dotted")}>
											<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M4 12h.01M9 12h.01M14 12h.01M19 12h.01" /></svg>
										</IconToggle>
									</Show>
								</div>
							</div>
							<Show when={closedLines().length > 0}>
								<div class="seg-set" role="group" aria-label="Where the line sits">
									<For each={[["inner", "Inside"], ["center", "Centre"], ["outer", "Outside"]] as const}>
										{([value, label]) => (
											<button type="button" data-on={lineAlign() === value ? "true" : undefined} aria-pressed={lineAlign() === value} onClick={() => set(closedLines(), () => ({ strokeAlignment: value }))}>
												{label}
											</button>
										)}
									</For>
								</div>
							</Show>
						</Section>
					</Show>

					<Show when={arrows().length > 0}>
						<Section key="arrow" title="Arrow">
							<div class="seg-set" role="group" aria-label="Route">
								<For each={[["straight", "Straight", MoveRight], ["curved", "Curved", Spline], ["elbow", "Elbow", CornerDownRight]] as const}>
									{([route, label]) => (
										<button type="button" data-route={route} data-on={style().route === route ? "true" : undefined} aria-pressed={style().route === route} onClick={() => arrowSet({ route: route === "straight" ? undefined : route })}>
											{label}
										</button>
									)}
								</For>
							</div>
							<div class="props-row">
								<span class="props-label">Heads</span>
								<div class="props-buttons" role="group" aria-label="Heads">
									<IconToggle attr={{ "data-heads": "end" }} on={style().heads === "end"} title="A head at the end" onClick={() => arrowSet({ heads: undefined })}>
										<Icon of={ArrowRight} size={14} />
									</IconToggle>
									<IconToggle attr={{ "data-heads": "both" }} on={style().heads === "both"} title="A head at both ends" onClick={() => arrowSet({ heads: "both" })}>
										<Icon of={ArrowLeftRight} size={14} />
									</IconToggle>
									<IconToggle attr={{ "data-heads": "none" }} on={style().heads === "none"} title="No head" onClick={() => arrowSet({ heads: "none" })}>
										<Icon of={Minus} size={14} />
									</IconToggle>
								</div>
							</div>
							<div class="props-row">
								<span class="props-label">Words</span>
								<input
									class="field props-text"
									placeholder="On the middle of the line"
									ref={(el) => held(el, () => String(shared(arrows(), (node) => arrowLabel(node.metadata) ?? "") ?? ""))}
									onChange={(event) => arrowSet({ label: event.currentTarget.value.trim() || undefined })}
								/>
							</div>
							<Show when={arrows().length === 1}>
								<For each={["from", "to"] as const}>
									{(which) => {
										const end = () => arrows()[0]?.metadata?.[which];
										return (
											<div class="props-row props-end">
												<span class="props-label">{which === "from" ? "From" : "To"}</span>
												<span class="props-endname" title={endName(end())}>{endName(end())}</span>
												<Show when={arrowEndItem(end())}>
													<select class="props-select props-side" aria-label={`${which === "from" ? "Start" : "End"} side`} value={arrowEndSide(end()) ?? "auto"} onChange={(event) => setSide(which, event.currentTarget.value as ArrowSide | "auto")}>
														<option value="auto">Nearest side</option>
														<option value="top">Top</option>
														<option value="right">Right</option>
														<option value="bottom">Bottom</option>
														<option value="left">Left</option>
													</select>
												</Show>
											</div>
										);
									}}
								</For>
							</Show>
						</Section>
					</Show>

					<Show when={words().length > 0 || (shapes().length > 0 && shapes().every((node) => shapeLabel(node)))}>
						<Section key="words" title={shapes().length > 0 && words().length > 0 && selected().every(isShape) ? "Words in the shape" : "Text"}>
							<div class="props-row">
								<select class="props-select" aria-label="Font" value={String(fontFamily() ?? "Inter")} onChange={(event) => set(words(), () => ({ fontFamily: event.currentTarget.value === "Inter" ? null : event.currentTarget.value }))}>
									<Show when={fontFamily() === MIXED}>
										<option value={MIXED}>Mixed</option>
									</Show>
									<Show when={typeof fontFamily() === "string" && fontFamily() !== MIXED && !FONTS.includes(fontFamily() as string)}>
										<option value={String(fontFamily())}>{String(fontFamily())}</option>
									</Show>
									<For each={FONTS}>{(font) => <option value={font}>{font}</option>}</For>
								</select>
								<input
									class="field props-font"
									placeholder="Any Google font"
									aria-label="Any Google font"
									title="Any family on Google Fonts, by its name"
									on:keydown={(event: KeyboardEvent) => {
										event.stopPropagation();
										if (event.key !== "Enter") return;
										const name = (event.currentTarget as HTMLInputElement).value.trim();
										if (name) set(words(), () => ({ fontFamily: name }));
										(event.currentTarget as HTMLInputElement).value = "";
									}}
								/>
							</div>
							<div class="props-nums two">
								<NumField label="size" value={fontSize()} min={4} onCommit={(v) => set(words(), () => ({ fontSize: Math.max(4, v) }))} />
								<label class="field props-num">
									<b>w</b>
									<select aria-label="Weight" value={String(fontWeight() ?? 400)} onChange={(event) => set(words(), () => ({ fontWeight: Number(event.currentTarget.value) }))}>
										<Show when={fontWeight() === MIXED}>
											<option value={MIXED}>Mixed</option>
										</Show>
										<For each={WEIGHTS}>{(weight) => <option value={String(weight)}>{weight}</option>}</For>
									</select>
								</label>
							</div>
							<div class="props-row">
								<div class="props-buttons" role="group" aria-label="Alignment">
									<IconToggle on={textAlign() === "left"} title="Left" onClick={() => set(words(), () => ({ textAlign: "left" }))}>
										<Icon of={TextAlignStart} size={14} />
									</IconToggle>
									<IconToggle on={textAlign() === "center"} title="Centre" onClick={() => set(words(), () => ({ textAlign: "center" }))}>
										<Icon of={TextAlignCenter} size={14} />
									</IconToggle>
									<IconToggle on={textAlign() === "right"} title="Right" onClick={() => set(words(), () => ({ textAlign: "right" }))}>
										<Icon of={TextAlignEnd} size={14} />
									</IconToggle>
								</div>
								<Show when={shapes().length > 0}>
									<div class="props-buttons" role="group" aria-label="Up and down">
										<IconToggle on={shapeVertical() === "top"} title="At the top" onClick={() => set(shapes(), () => ({ justifyContent: "start" }))}>
											<Icon of={AlignStartHorizontal} size={14} />
										</IconToggle>
										<IconToggle on={shapeVertical() === "middle"} title="In the middle" onClick={() => set(shapes(), () => ({ justifyContent: "center" }))}>
											<Icon of={AlignCenterHorizontal} size={14} />
										</IconToggle>
										<IconToggle on={shapeVertical() === "bottom"} title="At the bottom" onClick={() => set(shapes(), () => ({ justifyContent: "end" }))}>
											<Icon of={AlignEndHorizontal} size={14} />
										</IconToggle>
									</div>
								</Show>
								<div class="props-buttons" role="group" aria-label="Style">
									<IconToggle on={fontWeight() !== MIXED && Number(fontWeight()) >= 600} title="Bold" onClick={() => set(words(), (node) => ({ fontWeight: Number(node.fontWeight ?? 400) >= 600 ? 400 : 700 }))}>
										<Icon of={Bold} size={14} />
									</IconToggle>
									<IconToggle on={italic() === true} title="Italic" onClick={() => set(words(), (node) => ({ fontStyle: node.fontStyle === "italic" ? null : "italic" }))}>
										<Icon of={Italic} size={14} />
									</IconToggle>
								</div>
							</div>
							<div class="props-nums two">
								<NumField label="line" value={lineHeight()} min={0} step={0.1} placeholder="auto" onCommit={(v) => set(words(), () => ({ lineHeight: v <= 0 ? null : v }))} />
								<NumField label="space" value={spacing()} step={0.1} onCommit={(v) => set(words(), () => ({ letterSpacing: v === 0 ? null : v }))} />
							</div>
							<Show when={words().some((node) => node.type === "text")}>
								<Swatches colors={LINES} value={textColor()} onPick={(color) => setTextColor(color)} label="Text colour" />
								<div class="props-row">
									<span class="props-label">Colour</span>
									<ColorField value={textColor()} onCommit={(color) => setTextColor(color)} onLive={live((color) => setTextColor(color, true))} label="Text colour" />
								</div>
							</Show>
						</Section>
					</Show>

					<Show when={icons().length > 0}>
						<Section key="icon" title="Icon">
							<div class="props-row">
								<span class="props-label">Library</span>
								<select class="props-select" aria-label="Library" value={String(shared(icons(), (node) => String(node.library ?? "lucide")) ?? "")} onChange={(event) => set(icons(), () => ({ library: event.currentTarget.value }))}>
									<For each={ICON_LIBRARIES}>{(lib) => <option value={lib.id}>{lib.label}</option>}</For>
								</select>
							</div>
							<Show when={icons().length === 1}>
								<div class="props-row">
									<span class="props-label">Icon</span>
									<input class="field props-text" aria-label="Icon name" ref={(el) => held(el, () => String(icons()[0]?.icon ?? ""))} onChange={(event) => set(icons(), () => ({ icon: event.currentTarget.value.trim(), name: event.currentTarget.value.trim() }))} />
									<button type="button" class="btn props-btn" title="Pick another from the icons" onClick={() => setInsertPanel({ tab: "icons", replace: icons()[0]!.id })}>
										Pick…
									</button>
								</div>
							</Show>
							<div class="props-row">
								<span class="props-label">Weight</span>
								<input
									type="range"
									class="props-range"
									min="100"
									max="700"
									step="100"
									aria-label="Weight"
									value={Number(shared(icons(), (node) => numberOf(node.weight, 400)) === MIXED ? 400 : shared(icons(), (node) => numberOf(node.weight, 400)))}
									onChange={(event) => set(icons(), () => ({ weight: Number(event.currentTarget.value) }))}
								/>
							</div>
							<Swatches colors={LINES} value={shared(icons(), (node) => hexOf(node.fill))} onPick={(color) => setIconColor(color)} label="Icon colour" />
							<div class="props-row">
								<span class="props-label">Colour</span>
								<ColorField value={shared(icons(), (node) => hexOf(node.fill))} onCommit={(color) => setIconColor(color)} onLive={live((color) => setIconColor(color, true))} label="Icon colour" />
							</div>
						</Section>
					</Show>

					<Show when={single() && !isArrow(single()!) && box()}>
						<Section key="place" title="Position and size">
							{/*
							 * A markdown card starts as tall as its words and stays that way until a top or
							 * bottom handle pins a height on it. This is the way back: the same two words the
							 * frame's own height uses, so one control means one thing across the panel.
							 */}
							<Show when={isMarkdown(single()!) || isCard(single()!)}>
								<span class="props-prop">height</span>
								<div class="seg-set" role="group" aria-label="height">
									<button type="button" data-on={typeof single()!.height !== "number" ? "true" : undefined} aria-pressed={typeof single()!.height !== "number"} onClick={() => set([single()!], () => ({ height: null }))}>fit-content</button>
									<button type="button" data-on={typeof single()!.height === "number" ? "true" : undefined} aria-pressed={typeof single()!.height === "number"} onClick={() => set([single()!], () => ({ height: Math.max(1, Math.round(box()!.h)) }))}>px</button>
								</div>
							</Show>
							<div class="props-nums">
								<NumField field="x" label="x" value={box()!.x} onCommit={(v) => setBox({ x: Math.round(v) })} />
								<NumField field="y" label="y" value={box()!.y} onCommit={(v) => setBox({ y: Math.round(v) })} />
								<NumField field="w" label="w" value={box()!.w} min={1} onCommit={(v) => setBox({ w: Math.round(v) })} />
								<NumField field="h" label="h" value={box()!.h} min={1} onCommit={(v) => setBox({ h: Math.round(v) })} />
							</div>
							<div class="props-row">
								<NumField label="°" value={numberOf(single()!.rotation, 0)} onCommit={(v) => set([single()!], () => ({ rotation: Math.round(v) % 360 === 0 ? null : Math.round(v) % 360 }))} title="Turn, in degrees" />
								<NumField label="%" value={Math.round(numberOf(single()!.opacity, 1) * 100)} min={0} max={100} onCommit={(v) => set([single()!], () => ({ opacity: v >= 100 ? null : Math.max(0, v) / 100 }))} title="Opacity" />
								<div class="props-buttons">
									<IconToggle on={keepRatio()} title={keepRatio() ? "Keeping the proportions" : "Keep the proportions"} onClick={() => setKeepRatio(!keepRatio())}>
										<Icon of={keepRatio() ? Lock : LockOpen} size={14} />
									</IconToggle>
									<IconToggle on={single()!.flipX === true} title="Flip across" onClick={() => set([single()!], (node) => ({ flipX: node.flipX === true ? null : true }))}>
										<Icon of={FlipHorizontal2} size={14} />
									</IconToggle>
									<IconToggle on={single()!.flipY === true} title="Flip up and down" onClick={() => set([single()!], (node) => ({ flipY: node.flipY === true ? null : true }))}>
										<Icon of={FlipVertical2} size={14} />
									</IconToggle>
								</div>
							</div>
						</Section>
					</Show>

					<Show when={effectTargets().length > 0}>
						<Section key="effects" title="Shadow and blur">
							<Effects targets={effectTargets()} set={set} show={show} onLive={live} />
						</Section>
					</Show>

					<Section key="arrange" title="Arrange">
						<Show when={selected().filter((node) => !isArrow(node)).length >= 2}>
							<div class="props-buttons wide" role="group" aria-label="Align">
								<IconToggle title="Align left edges" onClick={() => align("l")}><Icon of={AlignStartVertical} size={14} /></IconToggle>
								<IconToggle title="Align centres" onClick={() => align("c")}><Icon of={AlignCenterVertical} size={14} /></IconToggle>
								<IconToggle title="Align right edges" onClick={() => align("r")}><Icon of={AlignEndVertical} size={14} /></IconToggle>
								<IconToggle title="Align tops" onClick={() => align("t")}><Icon of={AlignStartHorizontal} size={14} /></IconToggle>
								<IconToggle title="Align middles" onClick={() => align("m")}><Icon of={AlignCenterHorizontal} size={14} /></IconToggle>
								<IconToggle title="Align bottoms" onClick={() => align("b")}><Icon of={AlignEndHorizontal} size={14} /></IconToggle>
								<Show when={selected().filter((node) => !isArrow(node)).length >= 3}>
									<IconToggle title="Equal gaps across" onClick={() => distribute(true)}><Icon of={AlignHorizontalSpaceAround} size={14} /></IconToggle>
									<IconToggle title="Equal gaps down" onClick={() => distribute(false)}><Icon of={AlignVerticalSpaceAround} size={14} /></IconToggle>
								</Show>
							</div>
						</Show>
						<div class="props-buttons wide" role="group" aria-label="Order and actions">
							<IconToggle title="Bring to the front" onClick={() => order("front")}><Icon of={BringToFront} size={14} /></IconToggle>
							<IconToggle title="Send to the back" onClick={() => order("back")}><Icon of={SendToBack} size={14} /></IconToggle>
							<IconToggle title="Duplicate (⌘D)" onClick={duplicate}><Icon of={Copy} size={14} /></IconToggle>
							<IconToggle title="Export as a picture (PNG)" onClick={() => props.onExport(selected().map((node) => node.id))}><Icon of={ImageDown} size={14} /></IconToggle>
							<Show when={single() && (isCard(single()!) || isMarkdown(single()!))}>
								<IconToggle title="Export to Obsidian (.md)" onClick={() => exportNote(single()!)}><Icon of={FileDown} size={14} /></IconToggle>
							</Show>
							<IconToggle title="Delete (Delete)" danger onClick={remove}><Icon of={Trash2} size={14} /></IconToggle>
						</div>
					</Section>
				</div>
			</aside>
		</Show>
	);
}

/** Shadow and blur: pen's `effect`, a drop shadow and a layer blur. */
function Effects(props: {
	targets: readonly PenNode[];
	set: (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) => void;
	/** The same change, drawn and not saved: the shadow's colour while it is being dragged. */
	show: (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) => void;
	onLive: (apply: (color: string) => void) => (color?: string) => void;
}) {
	type Shadow = { type: "shadow"; shadowType?: string; offset?: { x: number; y: number }; blur?: number; spread?: number; color?: string };
	const effects = (node: PenNode) => (node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect]) as Array<Record<string, unknown>>;
	const shadowOf = (node: PenNode) => effects(node).find((effect) => effect.type === "shadow") as Shadow | undefined;
	const blurOf = (node: PenNode) => numberOf(effects(node).find((effect) => effect.type === "blur")?.radius, 0);
	const first = () => props.targets[0]!;
	const shadow = () => shadowOf(first());
	const write = (node: PenNode, next: { shadow?: Shadow | null; blur?: number }) => {
		const kept = effects(node).filter((effect) => effect.type !== "shadow" && effect.type !== "blur");
		const s = next.shadow === undefined ? shadowOf(node) : next.shadow ?? undefined;
		const b = next.blur === undefined ? blurOf(node) : next.blur;
		const all = [...kept, ...(s ? [s] : []), ...(b > 0 ? [{ type: "blur", radius: b }] : [])];
		return { effect: all.length === 0 ? null : all.length === 1 ? all[0] : all };
	};
	const setShadow = (patch: Partial<Shadow> | null, drawOnly?: boolean) =>
		(drawOnly ? props.show : props.set)(props.targets, (node) => write(node, { shadow: patch === null ? null : { type: "shadow", shadowType: "outer", offset: { x: 0, y: 4 }, blur: 12, spread: 0, color: "#00000033", ...(shadowOf(node) ?? {}), ...patch } }));
	/** A shadow colour keeps the alpha it already had, written as the last two digits of the hex. */
	const shadowColor = (color: string) => `${color}${(shadow()?.color ?? "#00000033").slice(7) || "33"}`;
	return (
		<>
			<div class="props-row">
				<span class="props-label">Shadow</span>
				<input type="checkbox" class="props-check" aria-label="Shadow" checked={!!shadow()} onChange={(event) => setShadow(event.currentTarget.checked ? {} : null)} />
			</div>
			<Show when={shadow()}>
				{(s) => (
					<>
						<div class="props-nums">
							<NumField label="x" value={numberOf(s().offset?.x, 0)} onCommit={(v) => setShadow({ offset: { x: v, y: numberOf(s().offset?.y, 4) } })} />
							<NumField label="y" value={numberOf(s().offset?.y, 4)} onCommit={(v) => setShadow({ offset: { x: numberOf(s().offset?.x, 0), y: v } })} />
							<NumField label="blur" value={numberOf(s().blur, 12)} min={0} onCommit={(v) => setShadow({ blur: Math.max(0, v) })} />
							<NumField label="sprd" value={numberOf(s().spread, 0)} onCommit={(v) => setShadow({ spread: v })} />
						</div>
						<div class="props-row">
							<span class="props-label">Colour</span>
							<ColorField value={hexOf(s().color)} onCommit={(color) => setShadow({ color: shadowColor(color) })} onLive={props.onLive((color) => setShadow({ color: shadowColor(color) }, true))} label="Shadow colour" />
						</div>
					</>
				)}
			</Show>
			<div class="props-row">
				<span class="props-label">Blur</span>
				<input type="range" class="props-range" min="0" max="24" step="1" aria-label="Blur" value={blurOf(first())} onChange={(event) => props.set(props.targets, (node) => write(node, { blur: Number(event.currentTarget.value) }))} />
			</div>
		</>
	);
}

/**
 * A field's value from the drawing, except while it has the focus: a redraw that arrives while
 * something is being typed (the answer to another edit, or an agent's) would otherwise put the old
 * value back over what was typed before Enter.
 */
function held(el: HTMLInputElement, value: () => string): void {
	createEffect(() => {
		const next = value();
		if (document.activeElement !== el) el.value = next;
	});
}

/** A number, typed or stepped with the arrow keys (Shift for ten), sent on Enter or on leaving the field. */
function NumField(props: { label: string; value: number | typeof MIXED | undefined; onCommit: (value: number) => void; min?: number; max?: number; step?: number; placeholder?: string; title?: string; field?: string }) {
	const shown = () => (props.value === MIXED || props.value === undefined ? "" : String(Math.round(props.value * 100) / 100));
	const commit = (el: HTMLInputElement) => {
		const text = el.value.trim();
		if (text === "" || text === shown()) return;
		let value = Number(text);
		if (!Number.isFinite(value)) return void (el.value = shown());
		if (props.min !== undefined) value = Math.max(props.min, value);
		if (props.max !== undefined) value = Math.min(props.max, value);
		props.onCommit(value);
	};
	/*
	 * The wheel over a field steps it, as the arrow keys do: up for more, Shift for ten at a time. A
	 * trackpad sends many small turns, so they are added up and a step is taken for every 50 pixels,
	 * one at most per event; what a burst of turns comes to is sent once it stops.
	 */
	let turned = 0;
	let settle: ReturnType<typeof setTimeout> | undefined;
	const wheel = (event: WheelEvent) => {
		event.preventDefault();
		const el = event.currentTarget as HTMLInputElement;
		turned += event.deltaMode === 0 ? event.deltaY : event.deltaY * 50;
		if (Math.abs(turned) < 50) return;
		const up = turned < 0;
		turned = 0;
		const step = (props.step ?? 1) * (event.shiftKey ? 10 : 1);
		let next = Math.round((Number(el.value || 0) + (up ? step : -step)) * 100) / 100;
		if (props.min !== undefined) next = Math.max(props.min, next);
		if (props.max !== undefined) next = Math.min(props.max, next);
		el.value = String(next);
		clearTimeout(settle);
		settle = setTimeout(() => commit(el), 250);
	};
	onCleanup(() => clearTimeout(settle));
	return (
		<label class="field props-num" title={props.title} data-field={props.field}>
			<b>{props.label}</b>
			<input
				inputmode="decimal"
				ref={(el) => held(el, shown)}
				placeholder={props.value === MIXED ? "Mixed" : (props.placeholder ?? "")}
				on:keydown={(event: KeyboardEvent) => {
					event.stopPropagation();
					const el = event.currentTarget as HTMLInputElement;
					if (event.key === "Enter") return commit(el);
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					const step = (props.step ?? 1) * (event.shiftKey ? 10 : 1);
					const now = Number(el.value || 0);
					el.value = String(Math.round((now + (event.key === "ArrowUp" ? step : -step)) * 100) / 100);
					commit(el);
				}}
				onBlur={(event) => commit(event.currentTarget)}
				on:wheel={wheel}
			/>
		</label>
	);
}

/** A hex colour: typed, or picked in the colour picker that its swatch opens (`ColorPicker.tsx`). */
function ColorField(props: {
	value: string | typeof MIXED | undefined;
	onCommit: (color: string) => void;
	/** Every step of a drag in the picker, drawn and not saved; nothing puts the drawing back (`ColorPicker`). */
	onLive?: (color?: string) => void;
	label: string;
}) {
	const hex = () => (props.value && props.value !== MIXED ? props.value : "");
	const [picking, setPicking] = createSignal(false);
	let swatch: HTMLButtonElement | undefined;
	const commit = (text: string) => {
		const clean = text.trim().replace(/^#?/, "#").toLowerCase();
		if (/^#[0-9a-f]{6}$/.test(clean) && clean !== hex()) props.onCommit(clean);
		else if (/^#[0-9a-f]{3}$/.test(clean)) props.onCommit(`#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`);
	};
	return (
		<span class="props-color">
			<button
				ref={swatch}
				type="button"
				class="props-swatch props-picker"
				data-on={picking() ? "true" : undefined}
				aria-haspopup="dialog"
				aria-expanded={picking()}
				title={`Pick any ${props.label.toLowerCase()}`}
				aria-label={`Pick any ${props.label.toLowerCase()}`}
				style={{ "--swatch": hex() || "transparent" }}
				onClick={() => setPicking(!picking())}
			/>
			<Show when={picking() && swatch}>
				<ColorPicker value={hex() || undefined} anchor={swatch!} label={props.label} onCommit={props.onCommit} {...(props.onLive ? { onLive: props.onLive } : {})} onClose={() => setPicking(false)} />
			</Show>
			<label class="field props-num props-hex">
				<input
					aria-label={props.label}
					ref={(el) => held(el, hex)}
					placeholder={props.value === MIXED ? "Mixed" : "#"}
					on:keydown={(event: KeyboardEvent) => {
						event.stopPropagation();
						if (event.key === "Enter") commit((event.currentTarget as HTMLInputElement).value);
					}}
					onBlur={(event) => commit(event.currentTarget.value)}
				/>
			</label>
		</span>
	);
}

function Swatches(props: { colors: readonly string[]; value: string | typeof MIXED | undefined; onPick: (color: string) => void; label: string }) {
	return (
		<div class="props-swatches" role="group" aria-label={props.label}>
			<For each={props.colors}>
				{(color) => (
					<button
						type="button"
						class="props-swatch"
						style={{ "--swatch": color }}
						data-on={props.value === color ? "true" : undefined}
						aria-pressed={props.value === color}
						title={`${props.label} ${color}`}
						aria-label={`${props.label} ${color}`}
						onClick={() => props.onPick(color)}
					/>
				)}
			</For>
		</div>
	);
}

function IconToggle(props: { on?: boolean; title: string; danger?: boolean; attr?: Record<string, string>; onClick: () => void; children: JSX.Element }) {
	return (
		<button {...(props.attr ?? {})} type="button" class="icon-button" data-on={props.on ? "soft" : undefined} data-danger={props.danger ? "true" : undefined} aria-pressed={props.on === undefined ? undefined : props.on} title={props.title} aria-label={props.title} onClick={() => props.onClick()}>
			{props.children}
		</button>
	);
}
