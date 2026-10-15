/**
 * Picking on the page by the C++ scene (`cpp/pick.cpp`): what a press at a stage point reaches, and
 * what a marquee holds. Fed with the items the worker laid out and what each covers, and sent only
 * what changed since the last time, so a press never waits on more than the search itself.
 *
 * What it does not know, the page still decides: which of the items a press reaches it wants (a
 * gesture may pass over arrows), and whether a press on an item inside a group picks the group.
 */
import { isShape, pathBounds, type Frame, type Placed } from "@decks/pen";
import createSceneModule from "../wasm/scene.mjs";

interface PickModule {
	HEAPF64: Float64Array;
	HEAP32: Int32Array;
	HEAPU8: Uint8Array;
	_pick_io(count: number): number;
	_pick_add(): number;
	_pick_remove(handle: number): void;
	_pick_set(handle: number): void;
	_pick_geometry(handle: number, length: number): void;
	_pick_point(x: number, y: number, band: number): number;
	_pick_within(x: number, y: number, w: number, h: number): number;
	_pick_found(): number;
	_snap_in(count: number): number;
	_snap_out(): number;
	_snap_move(x: number, y: number, w: number, h: number, count: number, threshold: number): number;
	_snap_edges(x1: number, y1: number, x2: number, y2: number, count: number, edges: number, threshold: number): number;
}

/** A line to draw where a snap landed: an alignment, or one measured gap (`snap.ts` in the app). */
export interface Guide {
	kind: "line" | "gap";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}
type Edge = "x1" | "x2" | "y1" | "y2";
const EDGE: Record<Edge, number> = { x1: 0, x2: 1, y1: 2, y2: 3 };

const SKIP_PRESS = 1;
const SKIP_MARQUEE = 2;
const IN_SHAPE = 4;
const FILLED = 8;
const FIELDS = 16;

export interface Picker {
	/** Bring the copy up to date with a layout: every placed item, and what each covers. */
	sync(placed: ReadonlyMap<string, Placed>, bounds: ReadonlyMap<string, Frame>): void;
	/** The ids a press at a stage point reaches, topmost first. `band` is a line's full width of reach, in stage units. */
	point(x: number, y: number, band: number): string[];
	/** The ids wholly inside a stage rectangle, leaving out any whose parent is in it too. */
	within(r: Frame): string[];
	/** Snap a moved box: the correction to add to the move, and the guides to draw (`snapMove` in the app's `snap.ts`). */
	snapMove(moving: Frame, targets: readonly Frame[], threshold: number): { dx: number; dy: number; guides: Guide[] };
	/** Snap the edges a resize moves (`snapEdges` in the app's `snap.ts`). */
	snapEdges(box: { x1: number; y1: number; x2: number; y2: number }, edges: readonly Edge[], targets: readonly Frame[], threshold: number): { box: { x1: number; y1: number; x2: number; y2: number }; guides: Guide[] };
	/** Records sent by the last `sync`, for the diagnostics and the tests. */
	readonly sent: number;
}

const inNode = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string" && typeof (globalThis as { window?: unknown }).window === "undefined";
const encoder = new TextEncoder();

export async function loadPicker(): Promise<Picker> {
	const options: Record<string, unknown> = { measure: () => ({ w: 0, h: 0 }) };
	if (!inNode) {
		const wasmUrl = new URL("../wasm/scene.wasm", import.meta.url).href;
		options.locateFile = (path: string) => (path.endsWith(".wasm") ? wasmUrl : path);
	}
	const module = (await createSceneModule(options)) as unknown as PickModule;
	const known = new Map<string, { handle: number; record: Float64Array; geometry: string }>();
	let ids: string[] = [];
	let sent = 0;
	const record = new Float64Array(FIELDS);
	const answer = (count: number) => {
		const at = module._pick_found() >> 2;
		const out: string[] = [];
		for (let i = 0; i < count; i++) out.push(ids[module.HEAP32[at + i]!]!);
		return out;
	};
	const targetsIn = (targets: readonly Frame[], extra: number) => {
		const at = module._snap_in(targets.length * 4 + extra) >> 3;
		const heap = module.HEAPF64;
		targets.forEach((t, i) => {
			heap[at + i * 4] = t.x;
			heap[at + i * 4 + 1] = t.y;
			heap[at + i * 4 + 2] = t.w;
			heap[at + i * 4 + 3] = t.h;
		});
		return at + targets.length * 4;
	};
	const guidesOut = (from: number, count: number): Guide[] => {
		const at = (module._snap_out() >> 3) + from;
		const heap = module.HEAPF64;
		return Array.from({ length: count }, (_, i) => ({ kind: heap[at + i * 5] ? "gap" : "line", x1: heap[at + i * 5 + 1]!, y1: heap[at + i * 5 + 2]!, x2: heap[at + i * 5 + 3]!, y2: heap[at + i * 5 + 4]! }));
	};
	return {
		snapMove(moving, targets, threshold) {
			targetsIn(targets, 0);
			const count = module._snap_move(moving.x, moving.y, moving.w, moving.h, targets.length, threshold);
			const at = module._snap_out() >> 3;
			return { dx: module.HEAPF64[at]!, dy: module.HEAPF64[at + 1]!, guides: guidesOut(2, count) };
		},
		snapEdges(box, edges, targets, threshold) {
			const after = targetsIn(targets, edges.length);
			edges.forEach((edge, i) => (module.HEAPF64[after + i] = EDGE[edge]));
			const count = module._snap_edges(box.x1, box.y1, box.x2, box.y2, targets.length, edges.length, threshold);
			const at = module._snap_out() >> 3;
			const heap = module.HEAPF64;
			return { box: { x1: heap[at]!, y1: heap[at + 1]!, x2: heap[at + 2]!, y2: heap[at + 3]! }, guides: guidesOut(4, count) };
		},
		get sent() {
			return sent;
		},
		sync(placed, bounds) {
			sent = 0;
			const seen = new Set<string>();
			// First pass: a handle for every item, so a parent's handle is known when its child is sent.
			for (const id of placed.keys()) {
				seen.add(id);
				if (!known.has(id)) {
					const handle = module._pick_add();
					known.set(id, { handle, record: new Float64Array(FIELDS).fill(NaN), geometry: "\u0000" });
					ids[handle] = id;
				}
			}
			for (const [id, entry] of known)
				if (!seen.has(id)) {
					module._pick_remove(entry.handle);
					known.delete(id);
					ids[entry.handle] = undefined!;
				}
			for (const [id, item] of placed) {
				const entry = known.get(id)!;
				const { node, box } = item;
				const covers = bounds.get(id) ?? box;
				const board = node.type === "browser" && node.metadata?.type === "decks.board";
				const inside = id.includes("/");
				const parent = item.parent ? placed.get(item.parent) : undefined;
				let flags = 0;
				if (inside || board || node.type === "group") flags |= SKIP_PRESS;
				if (inside || board) flags |= SKIP_MARQUEE;
				if (parent && isShape(parent.node)) flags |= IN_SHAPE;
				const geometry = node.type === "path" && typeof node.geometry === "string" ? node.geometry : "";
				if (geometry && node.fill !== undefined && node.fill !== null) flags |= FILLED;
				const vb = geometry ? (node.viewBox ?? (() => {
					const b = pathBounds(geometry);
					return b ? ([b.x, b.y, b.w, b.h] as const) : undefined;
				})()) : undefined;
				record[0] = covers.x;
				record[1] = covers.y;
				record[2] = covers.w;
				record[3] = covers.h;
				record[4] = box.x;
				record[5] = box.y;
				record[6] = box.w;
				record[7] = box.h;
				record[8] = item.order;
				record[9] = item.parent ? (known.get(item.parent)?.handle ?? -1) : -1;
				record[10] = flags;
				record[11] = vb?.[0] ?? 0;
				record[12] = vb?.[1] ?? 0;
				record[13] = vb?.[2] ?? 0;
				record[14] = vb?.[3] ?? 0;
				record[15] = typeof node.strokeWidth === "number" ? node.strokeWidth : 0;
				let same = true;
				for (let i = 0; i < FIELDS; i++) if (record[i] !== entry.record[i]) same = false;
				if (!same) {
					module.HEAPF64.set(record, module._pick_io(FIELDS) >> 3);
					module._pick_set(entry.handle);
					entry.record.set(record);
					sent++;
				}
				if (geometry !== entry.geometry) {
					const bytes = encoder.encode(geometry);
					const at = module._pick_io(Math.ceil(bytes.length / 8) + 1);
					module.HEAPU8.set(bytes, at);
					module._pick_geometry(entry.handle, bytes.length);
					entry.geometry = geometry;
				}
			}
		},
		point(x, y, band) {
			return answer(module._pick_point(x, y, band));
		},
		within(r) {
			return answer(module._pick_within(r.x, r.y, r.w, r.h));
		},
	};
}
