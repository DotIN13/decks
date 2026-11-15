/**
 * A packed R-tree over boxes: which of a stage's boards or drawn items touch a rectangle.
 *
 * Built once per change of the things indexed — a board moved, the drawing laid out again — and
 * asked every frame, so building is `O(n log n)` and asking is `O(log n + found)`. Packed the way
 * Flatbush packs one (sort-tile-recursive): the items sorted into vertical slices by their middles,
 * each slice by height, cut into nodes of `NODE` boxes, and the same again one level up until one
 * node holds everything. Static on purpose: the stage never needs to move one item and ask again in
 * the same frame, and a static tree is a few flat arrays with nothing to balance.
 *
 * What it answers is indices into the array it was built from, in ascending order, so a caller that
 * cares about order — the boards are drawn in the order the stage lists them — keeps it for free.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

const NODE = 16;

export class BoxIndex {
	/** Per node, its box as minX minY maxX maxY; the leaves first, the root last. */
	private readonly boxes: Float64Array;
	/** Per node, where its children start: an item index for a leaf, a node index above it. */
	private readonly first: Int32Array;
	private readonly count: Int32Array;
	private readonly leaf: Uint8Array;
	private readonly root: number;
	readonly size: number;

	constructor(rects: ArrayLike<Rect>) {
		const n = rects.length;
		this.size = n;
		const order = Array.from({ length: n }, (_, i) => i);
		const midX = (i: number) => rects[i]!.x + rects[i]!.w / 2;
		const midY = (i: number) => rects[i]!.y + rects[i]!.h / 2;
		// Sort-tile-recursive: vertical slices by the middle's x, then each slice by the middle's y.
		order.sort((a, b) => midX(a) - midX(b));
		const leaves = Math.max(1, Math.ceil(n / NODE));
		const slices = Math.ceil(Math.sqrt(leaves));
		const perSlice = slices * NODE;
		for (let at = 0; at < n; at += perSlice) {
			const part = order.slice(at, at + perSlice).sort((a, b) => midY(a) - midY(b));
			for (let k = 0; k < part.length; k++) order[at + k] = part[k]!;
		}
		this.items = Int32Array.from(order);
		this.itemBoxes = new Float64Array(n * 4);
		order.forEach((item, k) => {
			const r = rects[item]!;
			this.itemBoxes.set([r.x, r.y, r.x + r.w, r.y + r.h], k * 4);
		});

		const nodes: Array<{ box: [number, number, number, number]; first: number; count: number; leaf: boolean }> = [];
		let level: number[] = [];
		for (let at = 0; at < n; at += NODE) {
			const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
			const end = Math.min(n, at + NODE);
			for (let k = at; k < end; k++) {
				const r = rects[order[k]!]!;
				box[0] = Math.min(box[0], r.x);
				box[1] = Math.min(box[1], r.y);
				box[2] = Math.max(box[2], r.x + r.w);
				box[3] = Math.max(box[3], r.y + r.h);
			}
			level.push(nodes.length);
			nodes.push({ box, first: at, count: end - at, leaf: true });
		}
		// Up a level at a time: the nodes of this level are already in the order they were made, which
		// is slice by slice, so grouping neighbours keeps them near each other on the stage.
		while (level.length > 1) {
			const next: number[] = [];
			for (let at = 0; at < level.length; at += NODE) {
				const end = Math.min(level.length, at + NODE);
				const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
				for (let k = at; k < end; k++) {
					const child = nodes[level[k]!]!.box;
					box[0] = Math.min(box[0], child[0]);
					box[1] = Math.min(box[1], child[1]);
					box[2] = Math.max(box[2], child[2]);
					box[3] = Math.max(box[3], child[3]);
				}
				next.push(nodes.length);
				nodes.push({ box, first: level[at]!, count: end - at, leaf: false });
			}
			level = next;
		}
		const m = nodes.length;
		this.boxes = new Float64Array(m * 4);
		this.first = new Int32Array(m);
		this.count = new Int32Array(m);
		this.leaf = new Uint8Array(m);
		nodes.forEach((node, i) => {
			this.boxes.set(node.box, i * 4);
			this.first[i] = node.first;
			this.count[i] = node.count;
			this.leaf[i] = node.leaf ? 1 : 0;
		});
		this.root = level[0] ?? -1;
	}

	private readonly items: Int32Array;
	/** Each item's box, in the leaves' order, so a leaf that touches the rectangle is tested item by item. */
	private readonly itemBoxes: Float64Array;

	/** Every item whose box touches `r`, edges included, as indices in ascending order. */
	search(r: Rect): number[] {
		const found: number[] = [];
		if (this.root < 0 || this.size === 0) return found;
		const x1 = r.x;
		const y1 = r.y;
		const x2 = r.x + r.w;
		const y2 = r.y + r.h;
		const stack = [this.root];
		while (stack.length) {
			const node = stack.pop()!;
			const b = node * 4;
			if (this.boxes[b]! > x2 || this.boxes[b + 1]! > y2 || this.boxes[b + 2]! < x1 || this.boxes[b + 3]! < y1) continue;
			const first = this.first[node]!;
			const count = this.count[node]!;
			if (this.leaf[node]) {
				for (let k = first; k < first + count; k++) {
					const i = k * 4;
					if (this.itemBoxes[i]! > x2 || this.itemBoxes[i + 1]! > y2 || this.itemBoxes[i + 2]! < x1 || this.itemBoxes[i + 3]! < y1) continue;
					found.push(this.items[k]!);
				}
			} else {
				// Children of a level were made one after another, so they are a run of node indices.
				for (let k = 0; k < count; k++) stack.push(first + k);
			}
		}
		return found.sort((a, b) => a - b);
	}
}
