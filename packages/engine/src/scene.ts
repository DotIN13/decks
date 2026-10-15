/**
 * The drawing's layout, done by the C++ scene (`cpp/scene.cpp`): the same answer as `layout` in
 * `@decks/pen`, which stays the reference (`test/layout-diff.mjs` checks the two agree).
 *
 * The page resolves what each property means here, variables and themes included, and hands the
 * scene numbers only: one record of `FIELDS` per item. Words are measured by the caller's `measure`,
 * as in the TypeScript, until the scene shapes text itself.
 *
 * The scene keeps the drawing between layouts, so each layout sends only what changed: an item whose
 * record differs, a list of children that differs, the items that went. An item's measured words are
 * kept until its words, style or kind change, or `measureKey` does (a font arrived), so laying out an
 * unchanged drawing measures nothing. `measure` must depend only on those, as the browser's does.
 */
import { bool, estimateText, MISSING, num, paddingOf, pathBounds, resolve, textStyleOf, withTheme, type MeasureText, type PenDocument, type PenNode, type Placed, type TextStyle, type ThemeState } from "@decks/pen";
import createSceneModule from "../wasm/scene.mjs";

/** The record the scene reads for one item, in `cpp/scene.cpp`'s `Field` order. */
const FIELDS = ["parent", "kind", "visible", "visibleInParent", "x", "y", "wKind", "wValue", "wFallback", "hKind", "hValue", "hFallback", "layout", "padT", "padR", "padB", "padL", "gap", "justify", "align", "absolute", "growth", "fallback", "pathW", "pathH"] as const;
const F = Object.fromEntries(FIELDS.map((name, i) => [name, i])) as Record<(typeof FIELDS)[number], number>;

const KIND = { group: 0, frame: 1, text: 2, note: 3, path: 4, other: 5 } as const;
const SIZE = { missing: 0, fixed: 1, hug: 2, fill: 3 } as const;
const LAYOUT = { none: 0, vertical: 1, horizontal: 2 } as const;
const JUSTIFY: Record<string, number> = { center: 1, end: 2, space_between: 3, space_around: 4 };
const ALIGN: Record<string, number> = { center: 1, end: 2 };
const NOTE_LIKE = new Set(["note", "prompt", "context"]);

interface SceneModule {
	HEAPF64: Float64Array;
	_scene_input(count: number): number;
	_scene_reset(): void;
	_scene_add(): number;
	_scene_set(handle: number): void;
	_scene_children(handle: number, count: number): void;
	_scene_words(handle: number): void;
	_scene_fonts(): void;
	_scene_remove(handle: number): void;
	_scene_count(): number;
	_scene_layout(): number;
	_scene_results(): number;
}

export interface SceneLayout {
	/** Every item's box on the stage, as `layout` in `@decks/pen` gives it. */
	layout(doc: PenDocument, nodes: readonly PenNode[], options: { theme: ThemeState; measure?: MeasureText; measureKey?: string }): Map<string, Placed>;
	/** What the last layout sent and measured, and how many items the scene holds. */
	readonly last: { sent: number; measured: number; held: number };
}

/** What the page last told the scene about one item. */
interface Known {
	handle: number;
	record: Float64Array;
	words: string;
	children: number[];
}

const inNode = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string" && typeof (globalThis as { window?: unknown }).window === "undefined";

/** Load the scene. In a browser the bundler serves the wasm beside this file; Node reads it from disk. */
export async function loadScene(): Promise<SceneLayout> {
	let measureNow: (handle: number, maxWidth: number, withNode: number) => { w: number; h: number } = () => ({ w: 0, h: 0 });
	const options: Record<string, unknown> = { measure: (handle: number, maxWidth: number, withNode: number) => measureNow(handle, maxWidth, withNode) };
	if (!inNode) {
		const wasmUrl = new URL("../wasm/scene.wasm", import.meta.url).href;
		options.locateFile = (path: string) => (path.endsWith(".wasm") ? wasmUrl : path);
	}
	const module = (await createSceneModule(options)) as unknown as SceneModule;
	const known = new Map<string, Known>();
	let roots: number[] = [];
	let items: Array<{ node: PenNode; theme: ThemeState; style: TextStyle | undefined; content: string; parent: string | undefined }> = [];
	let lastMeasure: MeasureText | undefined;
	let lastKey: string | undefined;
	const last = { sent: 0, measured: 0, held: 0 };
	const record = new Float64Array(FIELDS.length);
	const sameRecord = (a: Float64Array, b: Float64Array) => {
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return false;
		return true;
	};
	const sendList = (handle: number, list: number[]) => {
		const at = module._scene_input(list.length) >> 3;
		module.HEAPF64.set(list, at);
		module._scene_children(handle, list.length);
	};
	return {
		last,
		layout(doc, nodes, { theme, measure, measureKey }) {
			const measureText = measure ?? estimateText;
			if (measureText !== lastMeasure || measureKey !== lastKey) {
				module._scene_fonts();
				lastMeasure = measureText;
				lastKey = measureKey;
			}
			const seen = new Set<string>();
			let sent = 0;
			const send = (node: PenNode, parentTheme: ThemeState, parentId: string | undefined, groupTheme: ThemeState | undefined): number => {
				// An id met twice gets a key of its own, so two items never share a record.
				let key = node.id;
				for (let n = 1; seen.has(key); n++) key = `${node.id}\u0000${n}`;
				seen.add(key);
				let entry = known.get(key);
				if (!entry) {
					entry = { handle: module._scene_add(), record: new Float64Array(FIELDS.length).fill(NaN), words: "\u0000", children: [] };
					entry.record[0] = Infinity;
					known.set(key, entry);
				}
				const t = withTheme(parentTheme, node);
				const texty = node.type === "text" || NOTE_LIKE.has(node.type);
				const style = texty ? textStyleOf(doc, node, t) : undefined;
				const content = texty ? String(resolve(doc, node.content, t) ?? "") : "";
				items[entry.handle] = { node, theme: t, style, content, parent: parentId };
				recordOf(record, doc, node, t, groupTheme);
				if (!sameRecord(record, entry.record)) {
					module.HEAPF64.set(record, module._scene_input(FIELDS.length) >> 3);
					module._scene_set(entry.handle);
					entry.record.set(record);
					sent++;
				}
				const words = texty ? JSON.stringify([node.type, content, style, node.metadata?.type, node.textAlign]) : node.type;
				if (words !== entry.words) {
					module._scene_words(entry.handle);
					entry.words = words;
				}
				const children = (node.children ?? []).map((child) => send(child, t, node.id, node.type === "group" ? t : undefined));
				if (children.length !== entry.children.length || children.some((handle, i) => handle !== entry!.children[i])) {
					sendList(entry.handle, children);
					entry.children = children;
				}
				return entry.handle;
			};
			const top = nodes.map((node) => send(node, theme, undefined, undefined));
			if (top.length !== roots.length || top.some((handle, i) => handle !== roots[i])) {
				sendList(-1, top);
				roots = top;
			}
			for (const [key, entry] of known)
				if (!seen.has(key)) {
					module._scene_remove(entry.handle);
					known.delete(key);
					items[entry.handle] = undefined!;
				}
			let measured = 0;
			measureNow = (handle, maxWidth, withNode) => {
				measured++;
				const item = items[handle]!;
				return measureText(item.content, item.style!, Number.isNaN(maxWidth) ? undefined : maxWidth, withNode ? item.node : undefined);
			};
			const count = module._scene_layout();
			const out = module.HEAPF64.subarray(module._scene_results() >> 3, (module._scene_results() >> 3) + count * 7);
			const placed = new Map<string, Placed>();
			for (let i = 0; i < count; i++) {
				const item = items[out[i * 7]!]!;
				placed.set(item.node.id, { node: item.node, box: { x: out[i * 7 + 1]!, y: out[i * 7 + 2]!, w: out[i * 7 + 3]!, h: out[i * 7 + 4]! }, parent: item.parent, theme: item.theme, order: out[i * 7 + 6]! });
			}
			last.sent = sent;
			last.measured = measured;
			last.held = module._scene_count();
			return placed;
		},
	};
}

/** One item's record, as `cpp/scene.cpp` reads it. */
function recordOf(record: Float64Array, doc: PenDocument, node: PenNode, t: ThemeState, groupTheme: ThemeState | undefined): void {
	record.fill(0);
	record[F.parent] = -1;
	record[F.kind] = node.type === "group" ? KIND.group : node.type === "frame" ? KIND.frame : node.type === "text" ? KIND.text : NOTE_LIKE.has(node.type) ? KIND.note : node.type === "path" ? KIND.path : KIND.other;
	record[F.visible] = bool(doc, node.enabled, t, true) ? 1 : 0;
	record[F.visibleInParent] = groupTheme ? (bool(doc, node.enabled, groupTheme, true) ? 1 : 0) : record[F.visible]!;
	record[F.x] = node.x ?? 0;
	record[F.y] = node.y ?? 0;
	writeSize(record, F.wKind, doc, node.width, t);
	writeSize(record, F.hKind, doc, node.height, t);
	const mode = node.layout === "vertical" || node.layout === "horizontal" || node.layout === "none" ? node.layout : node.type === "frame" ? "horizontal" : "none";
	record[F.layout] = LAYOUT[mode];
	if (mode !== "none") {
		const [pt, pr, pb, pl] = paddingOf(doc, node, t);
		record[F.padT] = pt;
		record[F.padR] = pr;
		record[F.padB] = pb;
		record[F.padL] = pl;
		record[F.gap] = num(doc, node.gap, t, 0);
	}
	record[F.justify] = JUSTIFY[String(node.justifyContent ?? "start")] ?? 0;
	record[F.align] = ALIGN[String(node.alignItems ?? "start")] ?? 0;
	record[F.absolute] = node.layoutPosition === "absolute" ? 1 : 0;
	const growth = node.textGrowth ?? "auto";
	record[F.growth] = growth === "fixed-width-height" ? 2 : growth === "fixed-width" ? 1 : 0;
	record[F.fallback] = node.type === MISSING ? 120 : node.type === "icon" || node.type === "icon_font" ? 24 : 100;
	record[F.pathW] = NaN;
	record[F.pathH] = NaN;
	if (node.type === "path") {
		const bounds = node.viewBox ? { w: node.viewBox[2], h: node.viewBox[3] } : pathBounds(node.geometry);
		record[F.pathW] = bounds ? bounds.w : NaN;
		record[F.pathH] = bounds ? bounds.h : NaN;
	}
}

/** A size as written: absent, a number, `fit_content`/`fill_container` with an optional fallback, or a variable. */
function writeSize(record: Float64Array, at: number, doc: PenDocument, value: unknown, theme: ThemeState): void {
	record[at + 2] = NaN;
	if (value === undefined || value === null) {
		record[at] = SIZE.missing;
		return;
	}
	if (typeof value === "number") {
		record[at] = SIZE.fixed;
		record[at + 1] = value;
		return;
	}
	const text = String(value).trim();
	const behaviour = /^(fit_content|hug_content|fill_container)(?:\(\s*(-?[\d.]+)\s*\))?$/.exec(text);
	if (behaviour) {
		record[at] = behaviour[1] === "fill_container" ? SIZE.fill : SIZE.hug;
		if (behaviour[2] !== undefined) record[at + 2] = Number(behaviour[2]);
		return;
	}
	record[at] = SIZE.fixed;
	record[at + 1] = num(doc, text, theme, 0);
}

