// What the properties panel knows about the selection, and the edits it sends: one creator per
// subject, joined by createPanel into the one object every section is given.
import { baseTheme, DECKS_COLORS, decksColorOf, resolve, arrowEndItem, arrowEndSide, arrowStyle, indexOf, isArrow, isPointEnd, isShape, makeLabel, newId, ids as penIds, shapeLabel, shapeOutline, type ArrowSide, type PenDocument, type PenNode } from "@decks/pen";
import { createMemo, createSignal } from "solid-js";
import { penBoxes, penSelection, setPenLive, setPenSelection } from "../../editor/pen-tools.ts";
import { scheme } from "../../theme.ts";
import { MIXED, type Kind, kindOf, hexOf, colorOf, type FillMode, gradientOf, fillModeOf, legacyStroke, lineWidthOf, lineColorOf, numberOf, shared } from "./model.ts";

export type PanelProps = {
	doc: PenDocument | undefined;
	onEdit: (ops: unknown[]) => void;
	/** Download a picture of these items, taken by the server (the server's shots). */
	onExport: (ids: string[]) => void;
};
type Selection = ReturnType<typeof createSelection>;
type Writing = ReturnType<typeof createWriting>;
/** Everything a section of the panel reads and does. */
export type PanelCtx = ReturnType<typeof createPanel>;

/** The panel's whole state, made once per panel. */
export function createPanel(props: PanelProps) {
	const selection = createSelection(props);
	const writing = createWriting(props);
	const both = { ...selection, ...writing };
	return { props, ...both, ...createPaint(both), ...createWords(both, props), ...createLayout(both), ...createPlacing(both), ...createArranging(both, props), ...createArrowEnds(both) };
}

/** What is selected, and what each kind of control is set on: a shape's outline and words, or the item itself. */
export function createSelection(props: PanelProps) {
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
	const arrows = createMemo(() => selected().filter(isArrow));
	const icons = createMemo(() => selected().filter((node) => kindOf(node) === "icon"));
	const shapes = createMemo(() => selected().filter(isShape));
	/**
	 * Frames of the selection that are frames in their own right, not a shape from the library.
	 *
	 * A frame is the one item that holds others, and the panel showed nothing about how it holds
	 * them: pen gives it a direction, a gap, padding, two alignments, clipping and a size that can
	 * hug its children, and every one of those was unreachable. A library shape is a frame too, and
	 * is left out — its layout is how its own words sit, which it has its own control for.
	 */
	const frames = () => selected().filter((node) => node.type === "frame" && !isShape(node));

	const title = () => {
		const node = single();
		if (!node) return `${selected().length} items`;
		if (typeof node.name === "string" && node.name) return node.name;
		if (isShape(node)) return String(node.metadata?.kind ?? "Shape");
		if (isArrow(node)) return "Arrow";
		if (kindOf(node) === "icon") return String(node.icon ?? "Icon");
		return node.type[0]!.toUpperCase() + node.type.slice(1);
	};
	return { index, selected, single, kinds, has, fillTargets, lineTargets, wordTargets, effectTargets, arrows, icons, shapes, frames, title };
}

/** The edits the panel sends: saved, or drawn and not saved while a hand is still down. */
export function createWriting(props: PanelProps) {
	const edit = (ops: unknown[]) => {
		if (ops.length) props.onEdit(ops);
	};
	/*
	 * What this panel has sent and the drawing does not have back yet, by item. An edit is built from
	 * the item as it will be: two quick clicks, heads then dash, each rewrite an arrow's whole
	 * metadata, and the second built from the item before the first came back undid the first.
	 */
	const sent = new Map<string, { fields: Record<string, unknown>; at: number }>();
	const asSent = (node: PenNode): PenNode => {
		const pending = sent.get(node.id);
		if (!pending) return node;
		const caughtUp = Object.entries(pending.fields).every(([field, value]) => JSON.stringify((node as unknown as Record<string, unknown>)[field] ?? null) === JSON.stringify(value ?? null));
		if (caughtUp || performance.now() - pending.at > 5000) {
			sent.delete(node.id);
			return node;
		}
		return { ...node, ...pending.fields } as PenNode;
	};
	const set = (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) =>
		edit(
			nodes.map((node) => {
				const change = fields(asSent(node));
				sent.set(node.id, { fields: { ...(sent.get(node.id)?.fields ?? {}), ...change }, at: performance.now() });
				return { op: "update", id: node.id, set: change };
			}),
		);
	/**
	 * The same change, drawn on the stage and not saved: what a colour picker sends while the hand is
	 * still down, so the colour follows the pointer and the file takes one edit when it lifts
	 * (`editor/pen-tools.ts`, `penLive`).
	 */
	const show = (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) =>
		setPenLive(nodes.length ? nodes.map((node) => ({ id: node.id, set: fields(node) })) : undefined);
	const writer = (live?: boolean) => (live ? show : set);
	/** A colour control's live drag: each step drawn, nothing saved, and nothing is the drawing itself again. */
	const live = (apply: (color: string) => void) => (color?: string) => (color === undefined ? setPenLive(undefined) : apply(color));

	/** What a colour field's value comes to on the canvas now: a variable resolved in the drawing for the scheme, a hex as it is. */
	const shownOf = (value: string | typeof MIXED | undefined): string | undefined => {
		if (!value || value === MIXED) return undefined;
		if (!value.startsWith("$")) return value;
		const doc = props.doc;
		return (doc ? hexOf(resolve(doc, value, baseTheme(doc, scheme()))) : undefined) ?? DECKS_COLORS[decksColorOf(value) ?? ""]?.[scheme()];
	};
	return { edit, sent, asSent, set, show, writer, live, shownOf };
}

/** Fill, line and colour: what the selection has, and the edits that change it. */
export function createPaint(ctx: Selection & Writing) {
	const { fillTargets, lineTargets, wordTargets, icons, set, writer } = ctx;
	const setTextColor = (color: string, drawOnly?: boolean) => writer(drawOnly)(wordTargets().filter((node) => node.type === "text"), () => ({ fill: color }));
	const setIconColor = (color: string, drawOnly?: boolean) => writer(drawOnly)(icons(), () => ({ fill: color }));
	// --- fill ------------------------------------------------------------------------------------
	const fillMode = () => shared(fillTargets(), fillModeOf);
	const fillHex = () => shared(fillTargets(), (node) => colorOf(node.fill) ?? colorOf(gradientOf(node.fill)?.colors?.[0]?.color));
	const setFillMode = (mode: FillMode) =>
		set(fillTargets(), (node) => {
			const base = colorOf(node.fill) ?? colorOf(gradientOf(node.fill)?.colors?.[0]?.color) ?? "$decks-fill-slate";
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
	const gradientEnd = () => shared(fillTargets(), (node) => colorOf(gradientOf(node.fill)?.colors?.[1]?.color));
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
			return { strokeWidth: width, ...(node.stroke === undefined || node.stroke === null ? { stroke: "$decks-text" } : {}) };
		});
	const dashOf = (node: PenNode): "solid" | "dashed" | "dotted" => (isArrow(node) ? (arrowStyle(node.metadata).dash ? "dashed" : "solid") : node.strokeDash === "dashed" || node.strokeDash === "dotted" ? node.strokeDash : "solid");
	const lineDash = () => shared(lineTargets(), dashOf);
	const setDash = (dash: "solid" | "dashed" | "dotted") =>
		set(lineTargets(), (node) => (isArrow(node) ? { metadata: { ...(node.metadata ?? {}), dash: dash === "solid" ? undefined : true } } : { strokeDash: dash === "solid" ? null : dash }));
	const closedLines = () => lineTargets().filter((node) => !isArrow(node));
	const lineAlign = () => shared(closedLines(), (node) => node.strokeAlignment ?? (node.type === "path" ? "center" : "inner"));
	return { setTextColor, setIconColor, fillMode, fillHex, setFillMode, setFillColor, gradientEnd, gradientTurn, lineColor, lineWidth, setLineColor, setLineWidth, dashOf, lineDash, setDash, closedLines, lineAlign };
}

/** Words: their font, size, alignment and colour, and a shape's words typed in the panel. */
export function createWords(ctx: Selection & Writing, props: PanelProps) {
	const { wordTargets, edit } = ctx;
	// --- words -----------------------------------------------------------------------------------
	const words = () => wordTargets();
	const fontFamily = () => shared(words(), (node) => (typeof node.fontFamily === "string" ? node.fontFamily : "Inter"));
	const fontSize = () => shared(words(), (node) => numberOf(node.fontSize, node.type === "text" ? 14 : 14));
	const fontWeight = () => shared(words(), (node) => Number(node.fontWeight ?? 400));
	const italic = () => shared(words(), (node) => node.fontStyle === "italic");
	const textAlign = () => shared(words(), (node) => node.textAlign ?? "left");
	const textColor = () => shared(words().filter((node) => node.type === "text"), (node) => colorOf(node.fill));
	const lineHeight = () => shared(words(), (node) => numberOf(node.lineHeight, 0));
	const spacing = () => shared(words(), (node) => numberOf(node.letterSpacing, 0));
	/** A shape's words, typed in the panel: its text, or a new one made inside it. */
	const setShapeWords = (shape: PenNode, content: string) => {
		const label = shapeLabel(shape);
		if (label) return edit([content ? { op: "update", id: label.id, set: { content } } : { op: "delete", id: label.id }]);
		if (!content || !props.doc) return;
		edit([{ op: "insert", parent: shape.id, node: makeLabel(newId(penIds(props.doc)), content) }]);
	};
	return { words, fontFamily, fontSize, fontWeight, italic, textAlign, textColor, lineHeight, spacing, setShapeWords };
}

/** How a frame holds what is in it, and where a shape's words sit. */
export function createLayout(ctx: Selection & Writing) {
	const { shapes, frames, set } = ctx;
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
	return { frameFlow, framePad, frameGap, frameAlong, frameAcross, frameClips, frameHugs, setHug, shapeVertical };
}

/** Position and size of the one item selected, with its proportions kept on asking. */
export function createPlacing(ctx: Selection & Writing) {
	const { single, edit } = ctx;
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
	return { keepRatio, setKeepRatio, box, setBox };
}

/** Order, duplicate, delete, align and distribute what is selected. */
export function createArranging(ctx: Selection & Writing, props: PanelProps) {
	const { selected, edit } = ctx;
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
	return { order, duplicate, remove, align, distribute };
}

/** An arrow's route, heads and words, and where its two ends join. */
export function createArrowEnds(ctx: Selection & Writing) {
	const { index, arrows, set } = ctx;
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
	/** A join slid along its side (`at`) put back in the side's middle. */
	const joinToMiddle = (which: "from" | "to") => {
		const end = arrows()[0]?.metadata?.[which];
		const item = arrowEndItem(end);
		const side = arrowEndSide(end);
		if (item && side) arrowSet({ [which]: { item, side } });
	};
	return { arrowSet, style, endName, setSide, joinToMiddle };
}
