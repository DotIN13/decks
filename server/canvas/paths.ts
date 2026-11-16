import { walk, type PenNode } from "@decks/pen";
import { layout } from "../../protocol/index.ts";
import type { Kinds } from "./kinds.ts";

// A scoped caller (a pass) reaches its canvas's folder and what its canvas already places, and names
// nothing new outside it (README rule 9). Each path is read decoded and normalised before any test.

/** The fields of a kind's item that name a place in the deck. */
const PATH_FIELDS = ["card", "path", "file"];

/** Every place these nodes name, each in one spelling (`keyOf`): what the canvas already places. */
export function placedKeys(nodes: PenNode[], canvas: string, kinds: Kinds): Set<string> {
	const keys = new Set<string>();
	for (const node of walk(nodes)) for (const path of pathsIn(node, canvas, kinds)) keys.add(keyOf(path, canvas).key);
	return keys;
}

/** The first path in these nodes a pass may not name, and why; undefined when all may be named. */
export function strayPath(nodes: PenNode[], canvas: string, kinds: Kinds, placed: ReadonlySet<string>): { path: string; why: string } | undefined {
	const own = `${layout.canvasFolder(canvas)}/`;
	for (const node of walk(nodes)) {
		for (const path of pathsIn(node, canvas, kinds)) {
			const { key, why } = keyOf(path, canvas);
			if (key.startsWith("web:") || key.startsWith(own) || placed.has(key)) continue;
			return { path, why: why ?? "its canvas places nothing there yet" };
		}
	}
	return undefined;
}

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

/**
 * A path in one spelling: a deck path (decoded, normalised, from the deck's root), `apps/<name>` for an
 * app's page at /app/<name>/, `web:` for an address outside the deck, or `ref:` and the words as written
 * for a reference that names no place today (an old page kept as it was), with why.
 */
export function keyOf(raw: string, canvas: string): { key: string; why?: string } {
	if (/^(?:https?:|data:|blob:)/i.test(raw)) return { key: `web:${raw}` };
	let path: string;
	try {
		path = decodeURIComponent(raw);
	} catch {
		return { key: `ref:${raw}`, why: "it cannot be read" };
	}
	const app = /^\/app\/([A-Za-z0-9][\w.-]*)(?:\/|$)/.exec(path);
	if (app && !path.split("/").includes("..")) return { key: `apps/${app[1]}` };
	if (/^(?:canvases|shared|assets|docs|apps)\//.test(path)) {
		if (!layout.deckPathOk(path) || path.split("/").includes("..")) return { key: `ref:${path}`, why: "it climbs, or names a hidden folder" };
		return { key: path.replace(/\/+$/, "") };
	}
	const resolved = layout.resolveReference(canvas, path);
	return "path" in resolved ? { key: resolved.path } : { key: `ref:${path}`, why: resolved.refused };
}
