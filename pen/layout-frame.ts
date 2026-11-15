import type { PenNode } from "./types.ts";
import { defaultSizing, layoutOf, sizing, visible, type Frame, type LayoutRun } from "./layout-sizing.ts";
import { num, paddingOf, type ThemeState, withTheme } from "./values.ts";

type Content = { w: number; h: number; count: number; locals: Map<string, Frame> };
type Axis = { row: boolean; pt: number; pr: number; pb: number; pl: number; gap: number; innerMain?: number; innerCross?: number };

/**
 * The content box a frame's children need, and where each goes, relative to the frame. `w` and `h`
 * are the frame's own size when known (fixed or forced), undefined when it hugs; the answer's `w`
 * and `h` are the size it would hug to.
 */
export function frameContent(run: LayoutRun, node: PenNode, t: ThemeState, w: number | undefined, h: number | undefined): Content {
	const kids = (node.children ?? []).filter((child) => visible(run.doc, child, withTheme(t, child)));
	const mode = layoutOf(node);
	if (mode === "none") return looseContent(run, kids, t);
	const [pt, pr, pb, pl] = paddingOf(run.doc, node, t);
	const row = mode === "horizontal";
	const axis: Axis = {
		row, pt, pr, pb, pl, gap: num(run.doc, node.gap, t, 0),
		innerMain: row ? (w === undefined ? undefined : w - pl - pr) : h === undefined ? undefined : h - pt - pb,
		innerCross: row ? (h === undefined ? undefined : h - pt - pb) : w === undefined ? undefined : w - pl - pr,
	};
	const flow = kids.filter((child) => child.layoutPosition !== "absolute");
	const sizes = flowSizes(run, flow, t, axis);
	const locals = new Map<string, Frame>();
	const content = flowPlaces(node, flow, sizes, axis, locals);
	for (const child of kids.filter((one) => one.layoutPosition === "absolute")) {
		const size = run.size(child, t);
		locals.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, w: size.w, h: size.h });
	}
	const hugW = row ? content.main + pl + pr : content.cross + pl + pr;
	const hugH = row ? content.cross + pt + pb : content.main + pt + pb;
	return { w: hugW, h: hugH, count: flow.length, locals };
}

/** A frame with no layout: each child at its own x and y, the content the box round them. */
function looseContent(run: LayoutRun, kids: PenNode[], t: ThemeState): Content {
	const locals = new Map<string, Frame>();
	let right = 0;
	let bottom = 0;
	for (const child of kids) {
		const size = run.size(child, t);
		const box = { x: child.x ?? 0, y: child.y ?? 0, w: size.w, h: size.h };
		locals.set(child.id, box);
		right = Math.max(right, box.x + box.w);
		bottom = Math.max(bottom, box.y + box.h);
	}
	return { w: right, h: bottom, count: kids.length, locals };
}

/** The sizes of the children in the flow: each that does not fill at its own size, then the fillers share what is left. */
function flowSizes(run: LayoutRun, flow: PenNode[], t: ThemeState, axis: Axis): Map<string, { w: number; h: number }> {
	const { row, innerMain, innerCross, gap } = axis;
	const mainOf = (child: PenNode) => sizing(run.doc, row ? child.width : child.height, withTheme(t, child), defaultSizing(child));
	const crossOf = (child: PenNode) => sizing(run.doc, row ? child.height : child.width, withTheme(t, child), defaultSizing(child));
	const forcedCrossOf = (child: PenNode) => (crossOf(child).kind === "fill" && innerCross !== undefined ? Math.max(0, innerCross) : undefined);
	const sizes = new Map<string, { w: number; h: number }>();
	let used = 0;
	const fillers: PenNode[] = [];
	for (const child of flow) {
		if (mainOf(child).kind === "fill" && innerMain !== undefined) {
			fillers.push(child);
			continue;
		}
		const forcedCross = forcedCrossOf(child);
		const size = row ? run.size(child, t, undefined, forcedCross) : run.size(child, t, forcedCross, undefined);
		sizes.set(child.id, size);
		used += row ? size.w : size.h;
	}
	if (fillers.length > 0 && innerMain !== undefined) {
		const share = Math.max(0, (innerMain - used - Math.max(0, flow.length - 1) * gap) / fillers.length);
		for (const child of fillers) {
			const forcedCross = forcedCrossOf(child);
			sizes.set(child.id, row ? run.size(child, t, share, forcedCross) : run.size(child, t, forcedCross, share));
		}
	}
	return sizes;
}

/** Where each child in the flow goes along the main axis, then the cross; answers the content's two lengths. */
function flowPlaces(node: PenNode, flow: PenNode[], sizes: Map<string, { w: number; h: number }>, axis: Axis, locals: Map<string, Frame>): { main: number; cross: number } {
	const { row, gap, pt, pl } = axis;
	const lengthOf = (child: PenNode) => (row ? sizes.get(child.id)!.w : sizes.get(child.id)!.h);
	const used = flow.reduce((sum, child) => sum + lengthOf(child), 0);
	const contentMain = used + Math.max(0, flow.length - 1) * gap;
	const contentCross = Math.max(0, ...flow.map((child) => (row ? sizes.get(child.id)!.h : sizes.get(child.id)!.w)));
	const mainBox = axis.innerMain ?? contentMain;
	const crossBox = axis.innerCross ?? contentCross;
	const free = Math.max(0, mainBox - contentMain);
	const justify = node.justifyContent ?? "start";
	let cursor = 0;
	let between = gap;
	if (justify === "center") cursor = free / 2;
	else if (justify === "end") cursor = free;
	else if (justify === "space_between" && flow.length > 1) between = gap + free / (flow.length - 1);
	else if (justify === "space_around" && flow.length > 0) {
		cursor = free / flow.length / 2;
		between = gap + free / flow.length;
	}
	const align = node.alignItems ?? "start";
	for (const child of flow) {
		const size = sizes.get(child.id)!;
		const childCross = row ? size.h : size.w;
		const crossAt = align === "center" ? (crossBox - childCross) / 2 : align === "end" ? crossBox - childCross : 0;
		locals.set(child.id, row ? { x: pl + cursor, y: pt + crossAt, w: size.w, h: size.h } : { x: pl + crossAt, y: pt + cursor, w: size.w, h: size.h });
		cursor += lengthOf(child) + between;
	}
	return { main: contentMain, cross: contentCross };
}
