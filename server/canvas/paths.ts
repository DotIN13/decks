import { posix } from "node:path";
import { walk, type PenDocument, type PenNode } from "@decks/pen";
import { layout } from "../../protocol/index.ts";
import type { Kinds } from "./kinds.ts";

// A scoped caller (a pass) reaches its canvas's folder and what its canvas already places, and names
// nothing new outside it (README rule 9). Each path is read decoded and normalised before any test.

/** Fields that name a place, wherever they are in a node: a page, a document, a file, a picture. */
const PATH_FIELDS = new Set(["card", "path", "file", "url"]);

/** Every place a drawing names, each in one spelling (`keyOf`): what the canvas already places. */
export function placedKeys(doc: PenDocument, canvas: string, kinds: Kinds): Set<string> {
	const keys = new Set<string>();
	const add = (path: string) => {
		keys.add(keyOf(path, canvas).key);
		for (const deck of deckReadings(path, canvas)) keys.add(deck);
	};
	for (const node of walk(doc.children)) pathsIn(node, canvas, kinds).forEach(add);
	namedIn(doc.variables ?? {}).forEach(add);
	return keys;
}

/**
 * The deck paths a reference written without a known prefix may mean: itself from the deck's root (a
 * document at papers/paper.md, an old page kept at the deck's root), and itself from the canvas's folder
 * when it climbs out of it (../../papers/paper.md). Only paths inside the deck, with no hidden part.
 */
export function deckReadings(raw: string, canvas: string): string[] {
	let path: string;
	try {
		path = decodeURIComponent(raw);
	} catch {
		return [];
	}
	if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(path)) return [];
	const out: string[] = [];
	for (const one of [posix.normalize(path), posix.normalize(`${layout.canvasFolder(canvas)}/${path}`)]) {
		if (!one.startsWith("..") && layout.deckPathOk(one) && !out.includes(one)) out.push(one.replace(/\/+$/, ""));
	}
	return out;
}

/** The first path these nodes name that a pass may not, and why; undefined when all may be named. */
export function strayPath(nodes: PenNode[], canvas: string, kinds: Kinds, placed: ReadonlySet<string>): { path: string; why: string } | undefined {
	for (const node of walk(nodes)) {
		const stray = firstStray(pathsIn(node, canvas, kinds), canvas, placed);
		if (stray) return stray;
	}
	return undefined;
}

/** The first path a drawing's variables name that a pass may not: a picture held in a variable. */
export function strayVariable(doc: PenDocument, canvas: string, placed: ReadonlySet<string>): { path: string; why: string } | undefined {
	return firstStray(namedIn(doc.variables ?? {}), canvas, placed);
}

function firstStray(paths: string[], canvas: string, placed: ReadonlySet<string>): { path: string; why: string } | undefined {
	const own = `${layout.canvasFolder(canvas)}/`;
	for (const path of paths) {
		const { key, why } = keyOf(path, canvas);
		if (key.startsWith("web:") || key.startsWith(own) || placed.has(key)) continue;
		return { path, why: why ?? "its canvas places nothing there yet" };
	}
	return undefined;
}

/** The places one node names: its kind's path fields, every place field in it, and an app by its name. */
function pathsIn(node: PenNode, canvas: string, kinds: Kinds): string[] {
	const out: string[] = [];
	if (kinds.of(node)) {
		const item = kinds.toItem(node, canvas) as Record<string, unknown>;
		for (const key of ["card", "path", "file"]) if (typeof item[key] === "string") out.push(item[key] as string);
		if (typeof item.app === "string") out.push(`/app/${item.app}/`);
	}
	const meta = node.metadata as { type?: unknown; name?: unknown } | undefined;
	if (meta?.type === "decks.app" && typeof meta.name === "string") out.push(`/app/${meta.name}/`);
	const { children: _children, ...own } = node;
	out.push(...namedIn(own));
	return out;
}

/** Every place field in a value, at any depth: card, path, file, url and a ref to a frame file as written, app as its page. */
function namedIn(value: unknown): string[] {
	const out: string[] = [];
	const visit = (one: unknown): void => {
		if (Array.isArray(one)) one.forEach(visit);
		else if (one && typeof one === "object") {
			for (const [key, field] of Object.entries(one)) {
				if (typeof field === "string" && PATH_FIELDS.has(key)) out.push(field);
				else if (typeof field === "string" && key === "ref" && field.includes("/")) out.push(field);
				else if (typeof field === "string" && key === "app") out.push(`/app/${field}/`);
				else visit(field);
			}
		}
	};
	visit(value);
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
	// A bare name (a file chip's itinerary.pdf, a markdown embed) has no folder to climb by: it is the canvas's own.
	if (/^[^/\\]+$/.test(path) && path !== "." && path !== ".." && !path.startsWith(".")) return { key: `${layout.canvasFolder(canvas)}/${path}` };
	const resolved = layout.resolveReference(canvas, path);
	return "path" in resolved ? { key: resolved.path } : { key: `ref:${path}`, why: resolved.refused };
}
