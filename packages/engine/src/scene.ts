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
import { bool, estimateText, isMarkdown, isMarkdownText, MISSING, num, paddingOf, pathBounds, resolve, textStyleOf, withTheme, type MeasureText, type PenDocument, type PenNode, type Placed, type TextStyle, type ThemeState } from "@decks/pen";
import createSceneModule from "../wasm/scene.mjs";
import { textOf } from "./text.ts";

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
	HEAP32: Int32Array;
	_scene_input(count: number): number;
	_scene_reset(): void;
	_scene_add(): number;
	_scene_set(handle: number): void;
	_scene_children(handle: number, count: number): void;
	_scene_words(handle: number): void;
	_scene_fonts(): void;
	_scene_remove(handle: number): void;
	_scene_count(): number;
	_scene_bytes(count: number): number;
	_scene_card(handle: number, count: number, poolLength: number): void;
	_scene_card_geometry(handle: number, width: number): number;
	_scene_text(handle: number, length: number, chainLength: number, size: number, weight: number, italic: number, letterSpacing: number, lineHeight: number, markdown: number): void;
	HEAPU8: Uint8Array;
	GL: { registerContext(context: unknown, attributes: Record<string, unknown>): number; makeContextCurrent(handle: number): boolean; getNewId(table: unknown[]): number; textures: unknown[] };
	_paint_init(): void;
	_paint_record(handle: number, at: number, count: number): void;
	_paint_flags(handle: number, skip: number, hole: number, mute: number): void;
	_paint_scroll(handle: number, index: number, offset: number): void;
	_paint_ops(handle: number, at: number, count: number): void;
	_paint_overlay(at: number, count: number): void;
	_paint_why(): number;
	_paint_image(id: number, texture: number, w: number, h: number): void;
	UTF8ToString(at: number): string;
	_paint_scheme(dark: number): void;
	_paint_tile(x: number, y: number, size: number, pixels: number): number;
	_paint_region(x: number, y: number, w: number, h: number, pw: number, ph: number): number;
	_paint_only(at: number, count: number): void;
	_scene_layout(): number;
	_scene_results(): number;
}

export interface SceneLayout {
	/** Every item's box on the stage, as `layout` in `@decks/pen` gives it. */
	/**
	 * `chain`, when given, has the scene measure plain words itself (`cpp/text.cpp`), with the fonts
	 * handed to `font`, each family followed by those `chain` names; `measure` is then asked only for
	 * a card's markdown. Without it, `measure` is asked for all words, as before.
	 */
	layout(
		doc: PenDocument,
		nodes: readonly PenNode[],
		options: {
			theme: ThemeState;
			measure?: MeasureText;
			measureKey?: string;
			chain?: (family: string) => readonly string[];
			/** With `chain`: a card's markdown, parsed and encoded for the scene (`card-wire.ts` in the app), so it measures cards too. */
			card?: (text: string, style: TextStyle, node: PenNode) => { numbers: Float64Array; pool: Uint8Array };
			/** An item's paint record (`paint-wire.ts` in the app), for the painter (`painter`). */
			paint?: (node: PenNode, theme: ThemeState) => number[];
			/** What else an item draws, as drawing ops, once its box is known (`opsOf` in the app). */
			ops?: (node: PenNode, theme: ThemeState, box: { x: number; y: number; w: number; h: number }) => number[] | undefined;
		},
	): Map<string, Placed>;
	/** A font file for the scene's own measuring, as the page's font provider gets it. */
	font(bytes: ArrayBuffer | Uint8Array, family: string): void;
	/** A card's links and wide tables laid out `width` wide, as `layoutMarkdown` reports them; undefined for an item with no card. */
	cardGeometry(id: string, width: number): { links: Array<{ x: number; y: number; w: number; h: number; href: string; scroller?: number }>; scrollers: Array<{ x: number; y: number; w: number; h: number; content: number }> } | undefined;
	/** How big the engine's memory has grown, in bytes (it never shrinks). */
	heapBytes(): number;
	/**
	 * The C++ painter (`cpp/paint.cpp`), drawing into a WebGL 2 canvas of its own: the items the last
	 * layout placed, with the paint records `paint` gave. Undefined when the canvas has no WebGL 2.
	 */
	painter(canvas: OffscreenCanvas | HTMLCanvasElement): Painter | undefined;
	/** What the last layout sent and measured, and how many items the scene holds. */
	readonly last: { sent: number; measured: number; held: number };
}

/**
 * What a paint is told about the stage: light or dark; `skip`, items carried on a picture of their own;
 * `holes`, items shown live under the drawing; `mute`, items whose words are not drawn while someone
 * types over them; `scrolls`, how far each card's wide tables are scrolled, by `id:index`; `overlay`,
 * drawing ops in stage pixels over everything, the ink still under the pen (`inkOps` in the app).
 */
export interface PaintOptions {
	dark: boolean;
	skip?: ReadonlySet<string>;
	holes?: ReadonlySet<string>;
	mute?: ReadonlySet<string>;
	scrolls?: ReadonlyMap<string, number>;
	overlay?: readonly number[];
}

export interface Painter {
	/**
	 * Paint the square at stage (x, y), `size` stage units wide, into the canvas, `pixels` square. False
	 * when something there is beyond the painter yet, and the caller paints it some other way.
	 */
	tile(x: number, y: number, size: number, pixels: number, options: PaintOptions): boolean;
	/**
	 * Paint the rectangle at stage (x, y), `w` by `h`, into the canvas made `pw` by `ph`; with `only`,
	 * just those items, each as if it stood alone (a drag's lifted items). A tile after it puts the
	 * canvas back to the tile's size.
	 */
	region(x: number, y: number, w: number, h: number, pw: number, ph: number, options: PaintOptions & { only?: ReadonlySet<string> }): boolean;
	/** Hand a decoded picture to the painter; answers the id a paint record names it by. */
	image(source: TexImageSource, width: number, height: number): number;
	dropImage(id: number): void;
	/** Why the last tile was not drawn, in words. */
	why?: string;
}

/** What the page last told the scene about one item. */
interface Known {
	handle: number;
	record: Float64Array;
	words: string;
	children: number[];
	paint?: string;
	ops?: string;
	/** A card's strings as encoded, for reading its links' addresses back (`cardGeometry`). */
	cardPool?: Uint8Array;
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
	let items: Array<{ node: PenNode; theme: ThemeState; style: TextStyle | undefined; content: string; parent: string | undefined; entry: Known }> = [];
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
	const text = textOf(module);
	const encoder = new TextEncoder();
	const roundWeight = (weight: number) => Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
	return {
		last,
		font: (bytes, family) => text.font(bytes, family),
		cardGeometry(id, width) {
			const entry = known.get(id);
			if (!entry?.cardPool) return undefined;
			const at = module._scene_card_geometry(entry.handle, width) >> 3;
			const v = module.HEAPF64;
			const pool = entry.cardPool;
			const decoder = new TextDecoder();
			let k = at;
			const links: Array<{ x: number; y: number; w: number; h: number; href: string; scroller?: number }> = [];
			for (let n = v[k++]!; n > 0; n--) {
				const [x, y, w, h, hrefAt, hrefLength, scroller] = [v[k++]!, v[k++]!, v[k++]!, v[k++]!, v[k++]!, v[k++]!, v[k++]!];
				links.push({ x, y, w, h, href: decoder.decode(pool.subarray(hrefAt, hrefAt + hrefLength)), ...(scroller >= 0 ? { scroller } : {}) });
			}
			const scrollers: Array<{ x: number; y: number; w: number; h: number; content: number }> = [];
			for (let n = v[k++]!; n > 0; n--) scrollers.push({ x: v[k++]!, y: v[k++]!, w: v[k++]!, h: v[k++]!, content: v[k++]! });
			return { links, scrollers };
		},
		heapBytes: () => module.HEAPU8.length,
		painter(canvas) {
			const gl = (canvas as OffscreenCanvas).getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
			if (!gl) return undefined;
			const handle = module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, alpha: true, premultipliedAlpha: true, antialias: false });
			module.GL.makeContextCurrent(handle);
			module._paint_init();
			let flagged: number[] = [];
			const textures = new Map<number, { texture: WebGLTexture; name: number }>();
			const paint = (x: number, y: number, w: number, h: number, pw: number, ph: number, { dark, skip, holes, mute, scrolls, overlay }: PaintOptions): boolean => {
				module.GL.makeContextCurrent(handle);
				const ink = overlay ?? [];
				const inkAt = module._scene_input(Math.max(1, ink.length));
				module.HEAPF64.set(ink, inkAt >> 3);
				module._paint_overlay(inkAt, ink.length);
				module._paint_scheme(dark ? 1 : 0);
				module._paint_scroll(-1, 0, 0);
				for (const [key, offset] of scrolls ?? []) {
					const cut = key.lastIndexOf(":");
					const entry = known.get(key.slice(0, cut));
					if (entry && offset) module._paint_scroll(entry.handle, Number(key.slice(cut + 1)), offset);
				}
				for (const h of flagged) module._paint_flags(h, 0, 0, 0);
				flagged = [];
				const flags = new Map<number, [number, number, number]>();
				for (const [set, which] of [[skip, 0], [holes, 1], [mute, 2]] as const)
					for (const id of set ?? []) {
						const entry = known.get(id);
						if (!entry) continue;
						const f = flags.get(entry.handle) ?? [0, 0, 0];
						f[which] = 1;
						flags.set(entry.handle, f);
					}
				for (const [h, f] of flags) {
					module._paint_flags(h, f[0], f[1], f[2]);
					flagged.push(h);
				}
				const drawn = module._paint_region(x, y, w, h, pw, ph) === 1;
				painter.why = drawn ? "" : module.UTF8ToString(module._paint_why());
				return drawn;
			};
			let nextPicture = 1;
			const painter: Painter = {
				image(source, width, height) {
					module.GL.makeContextCurrent(handle);
					const texture = gl.createTexture()!;
					gl.bindTexture(gl.TEXTURE_2D, texture);
					gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
					gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
					gl.generateMipmap(gl.TEXTURE_2D);
					gl.bindTexture(gl.TEXTURE_2D, null);
					// Named in Emscripten's table, so the C++ binds it as any texture of its own.
					const name = module.GL.getNewId(module.GL.textures);
					(texture as { name?: number }).name = name;
					module.GL.textures[name] = texture;
					const id = nextPicture++;
					textures.set(id, { texture, name });
					module._paint_image(id, name, width, height);
					return id;
				},
				dropImage(id) {
					const known = textures.get(id);
					if (!known) return;
					module.GL.makeContextCurrent(handle);
					module._paint_image(id, 0, 0, 0);
					gl.deleteTexture(known.texture);
					module.GL.textures[known.name] = null;
					textures.delete(id);
				},
				tile(x, y, size, pixels, options) {
					if ((canvas as OffscreenCanvas).width !== pixels || (canvas as OffscreenCanvas).height !== pixels) {
						(canvas as OffscreenCanvas).width = pixels;
						(canvas as OffscreenCanvas).height = pixels;
					}
					return paint(x, y, size, size, pixels, pixels, options);
				},
				region(x, y, w, h, pw, ph, options) {
					// The painter's own canvas, made the region's size: a tile after it puts it back.
					if ((canvas as OffscreenCanvas).width !== pw || (canvas as OffscreenCanvas).height !== ph) {
						(canvas as OffscreenCanvas).width = pw;
						(canvas as OffscreenCanvas).height = ph;
					}
					const only = [...(options.only ?? [])].flatMap((id) => {
						const entry = known.get(id);
						return entry ? [entry.handle] : [];
					});
					const at = module._scene_input(Math.max(1, only.length));
					module.HEAP32.set(only, at >> 2);
					module._paint_only(at, only.length);
					const drawn = paint(x, y, w, h, pw, ph, options);
					module._paint_only(at, 0);
					return drawn;
				},
			};
			return painter;
		},
		layout(doc, nodes, { theme, measure, measureKey, chain, card, paint, ops }) {
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
				items[entry.handle] = { node, theme: t, style, content, parent: parentId, entry };
				recordOf(record, doc, node, t, groupTheme);
				if (!sameRecord(record, entry.record)) {
					module.HEAPF64.set(record, module._scene_input(FIELDS.length) >> 3);
					module._scene_set(entry.handle);
					entry.record.set(record);
					sent++;
				}
				const markdown = isMarkdown(node) || isMarkdownText(node);
				// A card is encoded again when a font or a picture arrives, since a picture's size is part of it.
				const words = texty ? JSON.stringify([node.type, content, style, node.metadata?.type, node.textAlign, !!chain, !!card, markdown && card ? measureKey : 0]) : node.type;
				if (words !== entry.words) {
					module._scene_words(entry.handle);
					entry.words = words;
					// The words themselves, for the scene to measure: all but a card's markdown, which the page lays out.
					if (texty && chain && style) {
						const bytes = encoder.encode(content);
						const names = encoder.encode(chain(style.fontFamily).join("\n"));
						const at = module._scene_bytes(bytes.length + names.length);
						module.HEAPU8.set(bytes, at);
						module.HEAPU8.set(names, at + bytes.length);
						module._scene_text(entry.handle, bytes.length, names.length, style.fontSize, roundWeight(style.fontWeight), style.fontStyle === "italic" ? 1 : 0, style.letterSpacing, style.lineHeight ?? NaN, markdown ? 1 : 0);
						if (markdown && card) {
							const wire = card(content, style, node);
							module.HEAPF64.set(wire.numbers, module._scene_input(wire.numbers.length) >> 3);
							module.HEAPU8.set(wire.pool, module._scene_bytes(wire.pool.length));
							module._scene_card(entry.handle, wire.numbers.length, wire.pool.length);
							entry.cardPool = wire.pool;
						}
					}
				}
				if (paint) {
					const numbers = paint(node, t);
					const key = numbers.join(",");
					if (key !== entry.paint) {
						const at = module._scene_input(numbers.length);
						module.HEAPF64.set(numbers, at >> 3);
						module._paint_record(entry.handle, at, numbers.length);
						entry.paint = key;
					}
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
			// Copied, not viewed: the loop below calls into the scene, which can grow its memory and so
			// detach a view of the old one, leaving every later read undefined.
			const out = module.HEAPF64.slice(module._scene_results() >> 3, (module._scene_results() >> 3) + count * 7);
			const placed = new Map<string, Placed>();
			for (let i = 0; i < count; i++) {
				const item = items[out[i * 7]!]!;
				placed.set(item.node.id, { node: item.node, box: { x: out[i * 7 + 1]!, y: out[i * 7 + 2]!, w: out[i * 7 + 3]!, h: out[i * 7 + 4]! }, parent: item.parent, theme: item.theme, order: out[i * 7 + 6]! });
				if (ops) {
					const numbers = ops(item.node, item.theme, { x: out[i * 7 + 1]!, y: out[i * 7 + 2]!, w: out[i * 7 + 3]!, h: out[i * 7 + 4]! }) ?? [];
					const key = numbers.join(",");
					const entry = item.entry;
					if (entry && key !== entry.ops) {
						const at = module._scene_input(Math.max(1, numbers.length));
						module.HEAPF64.set(numbers, at >> 3);
						module._paint_ops(entry.handle, at, numbers.length);
						entry.ops = key;
					}
				}
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

