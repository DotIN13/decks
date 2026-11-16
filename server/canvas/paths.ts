import { walk, type PenNode } from "@decks/pen";
import { layout } from "../../protocol/index.ts";
import type { Kinds } from "./kinds.ts";

// Every path an item names stays in its canvas: its own folder, or the deck's assets/, docs/ and
// apps/ (README rule 9). Read decoded and normalised before any test, for every caller.

/** The first path in these nodes that leaves the canvas, and why; undefined when all stay. */
export function strayPath(nodes: PenNode[], canvas: string, kinds: Kinds): { path: string; why: string } | undefined {
	for (const node of walk(nodes)) {
		for (const path of pathsIn(node, canvas, kinds)) {
			const why = whyOutside(path, canvas);
			if (why) return { path, why };
		}
	}
	return undefined;
}

/** The fields of a kind's item that name a place in the deck. */
const PATH_FIELDS = ["card", "path", "file"];

/** The paths one node names: its kind's path fields, its metadata's path, and every url in it. */
function pathsIn(node: PenNode, canvas: string, kinds: Kinds): string[] {
	const out: string[] = [];
	if (kinds.of(node)) {
		const item = kinds.toItem(node, canvas) as Record<string, unknown>;
		for (const key of PATH_FIELDS) if (typeof item[key] === "string") out.push(item[key] as string);
	}
	const meta = (node.metadata as { path?: unknown } | undefined)?.path;
	if (typeof meta === "string") out.push(meta);
	const urls = (value: unknown): void => {
		if (Array.isArray(value)) value.forEach(urls);
		else if (value && typeof value === "object") for (const [key, one] of Object.entries(value)) (key === "url" && typeof one === "string" ? out.push(one) : urls(one));
	};
	const { children: _children, ...own } = node;
	urls(own);
	return out;
}

/** Why a path leaves the canvas, or undefined. A web or data address is not a path in the deck. */
export function whyOutside(raw: string, canvas: string): string | undefined {
	if (/^(?:https?:|data:|blob:)/i.test(raw)) return undefined;
	let path: string;
	try {
		path = decodeURIComponent(raw);
	} catch {
		return "it cannot be read";
	}
	if (/^(?:canvases|shared)\//.test(path) || /^(?:assets|docs|apps)\//.test(path)) {
		if (!layout.deckPathOk(path) || path.split("/").includes("..")) return "it climbs, or names a hidden folder";
		const at = layout.canvasOfPath(path);
		if (at && at.name !== canvas) return `it is in another canvas, ${at.name}`;
		return undefined;
	}
	const resolved = layout.resolveReference(canvas, path);
	return "refused" in resolved ? resolved.refused : undefined;
}
