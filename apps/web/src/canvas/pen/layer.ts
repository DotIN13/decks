import { indexOf, isShape, NOTE_PAD, pathBounds, type Frame, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { BoxIndex, type Rect } from "../spatial.ts";
import { applyTurn, cornersOf, invertTurn, isUnturned, matrixOf, type Matrix } from "./turn.ts";
import { StageScene, type CardGeometry, type LiveInk, type PenPreview, type SceneBoard, type SceneInput, type SceneOutput } from "./scene.ts";

export type { PenPreview, SceneBoard } from "./scene.ts";

/** What a press found in the drawing: the item, and where it is on the stage. */
export interface PenHit {
	id: string;
	node: PenNode;
	box: Frame;
}

/**
 * Parts switched off for a debugging run on a phone, development builds only: `rec_off` is the crash
 * recorder's cookie (`assets/_tools/crash-recorder.mjs` in the deck), a comma list. `sheet` stops the
 * sheet drawing anything, `pictures` draws no board pictures, `gpu` never uses CanvasKit, `small`
 * decodes pictures no wider than 192px, `serial` fetches and decodes one at a time.
 */
export const debugOff: ReadonlySet<string> = new Set(
	typeof document !== "undefined" && (import.meta.env?.DEV || /(?:^|; )rec_off=/.test(document.cookie)) ? decodeURIComponent((/(?:^|; )rec_off=([^;]*)/.exec(document.cookie) ?? [])[1] ?? "").split(",").filter(Boolean) : [],
);
/** What the scene last reported, for the recorder to read (`debugOff`). */
type SheetStats = Record<string, unknown> & { shown?: number; workerError?: string };
const sheetStats = (): SheetStats => ((globalThis as { __decksSheet?: SheetStats }).__decksSheet ??= { shown: 0 });

/** How far past the window the sheet is drawn, as a share of its size on each side (`present`). */
const OVERSCAN = 0.12;
/** The sheet's pixel density at most. A phone at three is nine times a plain screen's pixels for a picture nobody reads closely. */
const MAX_DPR = 2;
const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/**
 * Board pictures decoded at once, in pixels (4 bytes each), on every device: 32M is 128 MB, about a
 * tenth of what iOS lets a Safari tab have before it kills it. A phone's was 6M after the crashes,
 * whose causes were live pages and the closed panel's pictures, both fixed.
 */
const PICTURE_BUDGET = 32_000_000;
/** The widest a board's picture is decoded: a phone's screen never needs 2048 for one board. */
const PICTURE_WIDEST = coarse ? 1024 : 2048;

/**
 * The stage's drawing, as the page sees it: one `<canvas>` among the boards, and a layer of
 * invisible shapes that catches clicks on what is drawn over a board.
 *
 * **Painted somewhere else.** The drawing and the boards' pictures are laid out and painted by
 * `StageScene` (`scene.ts`), in a worker (`scene.worker.ts`) wherever the browser can paint in
 * one. This class sends it what changed — the document, the boards, the camera, a drag — and gets
 * back two things: a finished bitmap per frame, and after each change the layout, which it keeps
 * so that a press can be answered at once, on this thread (`hitTest`, `linkAt`, `within`).
 *
 * **Placed with the camera it was drawn for** (`present`). The sheet is among the boards, inside
 * their transform, so each bitmap is set with the inverse of the camera it was painted under, in
 * the same task that shows it. Between two bitmaps it moves and scales with the boards exactly, as
 * a picture on the stage; what can lag is only its edge, which is why it is drawn a little larger
 * than the window (`OVERSCAN`). A worker a frame behind is a sheet a frame blurrier during a pinch,
 * never a drawing that slides against the boards.
 *
 * **Clicks go to what you see** (`hits`). The sheet lets every click through; above it is an SVG
 * of invisible shapes, one per drawn item with its outline, which the browser tests each click
 * against. A click on a shape is the drawing's; a click beside it reaches the board underneath.
 */
export class PenLayer {
	private sheet: HTMLCanvasElement | undefined;
	private bitmaps: ImageBitmapRenderingContext | null = null;
	private hits: SVGSVGElement | undefined;
	private doc: PenDocument | undefined;
	private base = "";
	private scheme: "light" | "dark" = "light";
	private boardKey = "";
	private moving = false;
	private camera: Camera = { x: 0, y: 0, zoom: 1 };
	private seq = 0;
	/** The documents sent and not yet laid out, by their number, so `drawnDoc` is the object the caller gave. */
	private readonly docs = new Map<number, PenDocument | undefined>();
	private cards: CardGeometry[] = [];
	private disposed = false;
	private port: { post(message: SceneInput): void; close(): void };
	/** The last of each kind of message, to hand to the page's own scene if the worker fails. */
	private readonly state = new Map<string, SceneInput>();
	/** The layout last drawn, by id, for whoever needs to know where an item is. */
	placed: ReadonlyMap<string, Placed> = new Map();
	/** The same items as a list, and filed by what each covers, so a press or a marquee asks only the ones near it. */
	private placedList: Placed[] = [];
	private placedIndex: BoxIndex = new BoxIndex([]);
	/** For each item somebody turned, the matrix that carries a stage point back to its upright box (`turn.ts`). */
	private turns = new Map<string, Matrix>();
	/** The stage rectangle the click shapes are written for: the window and one window round it. */
	private hitWindow: Rect | undefined;
	/**
	 * The boards, filed by where they are. A click shape is only needed where a drawn item lies over a
	 * board, to take the press from the board's page; on bare canvas the stage has the press already and
	 * `hitTest` answers it. 3,192 shapes on a stage of 3,000 items cost a pan 191 ms a step at 4×.
	 */
	private boardIndex: BoxIndex = new BoxIndex([]);
	private boardBoxes = "";
	private view = { width: 0, height: 0 };
	/** Called after every new layout, so the stage can redraw a selection around what moved. */
	drawn: (() => void) | undefined;
	/** Called after every frame is on the sheet: the picture page waits for it (`shot.ts`). */
	presented: (() => void) | undefined;
	/** Called with the boards the sheet is showing a picture of, when that changes. */
	/** The boards whose pictures are on screen, told as each frame is shown. */
	pictured: ((paths: ReadonlySet<string>) => void) | undefined;
	private picturedNext: ReadonlySet<string> = new Set();
	/**
	 * What a drag carries, shown over the sheet and slid by the drag's offset (`carry`, `preview`):
	 * drawn once when the drag picks things up, and moved by this thread on every pointer move, so it
	 * stays under the pointer with no frame from the worker in between.
	 */
	private carriedEl: HTMLCanvasElement | undefined;
	private carriedBitmaps: ImageBitmapRenderingContext | null = null;
	/** The placement of the frame the carried picture came with, before the drag's offset. */
	private carriedAt = "";
	private carriedBy = { dx: 0, dy: 0 };
	private carriedKey = "";
	private boardsCarried = "";
	/** Called with the boards whose carried picture is on screen, when that changes: their pages hide. */
	carrying: ((paths: ReadonlySet<string>) => void) | undefined;
	private carryingNow: ReadonlySet<string> = new Set();
	/** The document the current layout was made from. */
	drawnDoc: PenDocument | undefined;
	/** Whether the last frame shown was drawn by CanvasKit, with the drawing in it (`shot.ts` waits for one). */
	drewDrawing = false;

	/** What each item looks like it covers, by id (`boundsOf`): what is outlined, hit and boxed in. */
	bounds: ReadonlyMap<string, Frame> = new Map();

	constructor(options: { worker?: boolean } = {}) {
		this.port = options.worker === false ? this.local() : this.remote();
	}

	/** The scene in a worker, or on this page when the browser cannot paint in one. */
	private remote(): PenLayer["port"] {
		const can = typeof Worker === "function" && typeof OffscreenCanvas === "function" && "transferToImageBitmap" in OffscreenCanvas.prototype;
		if (!can) return this.local();
		let worker: Worker;
		try {
			worker = new Worker(new URL("./scene.worker.ts", import.meta.url), { type: "module" });
		} catch {
			return this.local();
		}
		worker.onmessage = (event: MessageEvent<SceneOutput>) => this.receive(event.data);
		worker.onmessageerror = () => (sheetStats().workerError = "messageerror");
		worker.onerror = (event) => {
			sheetStats().workerError = String(event.message ?? "error").slice(0, 200);
			// A worker that would not start is the page's scene instead, with everything it was told.
			event.preventDefault();
			worker.terminate();
			if (this.disposed) return;
			this.port = this.local();
			for (const message of this.state.values()) this.port.post(message);
		};
		worker.postMessage({ type: "init", origin: location.href });
		// Reported in development, and in a build opened through the crash recorder, which sets the cookie.
		if (import.meta.env?.DEV || /(?:^|; )rec_off=/.test(document.cookie)) worker.postMessage({ type: "debug", off: [...debugOff] });
		return { post: (message) => worker.postMessage(message), close: () => worker.terminate() };
	}

	private local(): PenLayer["port"] {
		const offscreen = typeof OffscreenCanvas === "function" && "transferToImageBitmap" in OffscreenCanvas.prototype;
		const scene = new StageScene({
			post: (message) => queueMicrotask(() => this.receive(message)),
			canvas: () => (offscreen ? new OffscreenCanvas(1, 1) : document.createElement("canvas")),
			snapshot: (canvas) => ("transferToImageBitmap" in canvas ? canvas.transferToImageBitmap() : createImageBitmap(canvas)),
			origin: location.href,
		});
		return { post: (message) => scene.receive(message), close: () => scene.dispose() };
	}

	private send(message: SceneInput, key: string = message.type): void {
		if (this.disposed || debugOff.has("sheet")) return;
		if (message.type !== "ack") this.state.set(key, message);
		this.port.post(message);
	}

	private receive(message: SceneOutput): void {
		if (this.disposed) {
			if (message.type === "frame") {
				message.bitmap?.close();
				message.carried?.bitmap.close();
			}
			return;
		}
		if (message.type === "frame") this.present(message);
		// Said when the frame that draws them is on screen (`present`), not when the worker decides to.
		else if (message.type === "pictured") this.picturedNext = new Set(message.paths);
		else if (message.type === "stats") Object.assign(sheetStats(), message.stats);
		else {
			this.placed = new Map(message.placed);
			this.bounds = new Map(message.bounds);
			this.placedList = [...this.placed.values()];
			this.turns = new Map();
			for (const one of this.placedList) {
				const m = matrixOf(this.placed, one.node.id);
				if (!isUnturned(m)) this.turns.set(one.node.id, invertTurn(m));
			}
			// A turned item is looked for where it is drawn: the box in the index is the one that encloses it there.
			this.placedIndex = new BoxIndex(this.placedList.map((one) => this.drawnBox(one)));
			this.hitWindow = undefined;
			this.cards = message.cards;
			if (this.docs.has(message.seq)) this.drawnDoc = this.docs.get(message.seq);
			for (const seq of this.docs.keys()) if (seq <= message.seq) this.docs.delete(seq);
			this.writeHits();
			this.drawn?.();
		}
	}

	/** Show a frame, placed back over the window by the camera it was drawn under. */
	private present(frame: Extract<SceneOutput, { type: "frame" }>): void {
		const sheet = this.sheet;
		if (!frame.bitmap) {
			if (sheet) sheet.hidden = true;
			this.showCarried(frame, "");
			this.pictured?.(new Set());
			this.presented?.();
			return;
		}
		if (!sheet) {
			frame.bitmap.close();
			frame.carried?.bitmap.close();
			this.send({ type: "ack" });
			return;
		}
		this.bitmaps ??= sheet.getContext("bitmaprenderer");
		if (!this.bitmaps) {
			frame.bitmap.close();
			frame.carried?.bitmap.close();
			return;
		}
		this.bitmaps.transferFromImageBitmap(frame.bitmap);
		this.drewDrawing = frame.gpu === true;
		sheetStats().shown = (sheetStats().shown ?? 0) + 1;
		const { x, y, zoom } = frame.camera;
		sheet.style.width = `${frame.width}px`;
		sheet.style.height = `${frame.height}px`;
		sheet.style.transform = `translate(${x - frame.width / 2 / zoom}px, ${y - frame.height / 2 / zoom}px) scale(${1 / zoom})`;
		sheet.hidden = false;
		this.showCarried(frame, sheet.style.transform);
		sheetStats().pictured = this.picturedNext.size;
		(globalThis as { __decksPictured?: ReadonlySet<string> }).__decksPictured = this.picturedNext;
		this.pictured?.(this.picturedNext);
		this.presented?.();
		// The next frame once this one has had its turn on screen, so frames never queue up.
		requestAnimationFrame(() => this.send({ type: "ack" }));
	}

	/**
	 * The carried picture that came with a frame, in the same task as the sheet, so what a drag picks
	 * up leaves the sheet and appears over it at once; a frame with none puts it away, as the drop's
	 * frame does once the moved things are on the sheet in their new places.
	 */
	private showCarried(frame: Extract<SceneOutput, { type: "frame" }>, at: string): void {
		const carried = frame.carried;
		if (!carried) {
			if (this.carriedEl && !this.carriedEl.hidden) {
				this.carriedEl.hidden = true;
				// The picture is let go between drags: it is as large as the sheet, which on a phone is memory to keep for nothing.
				this.carriedBitmaps?.transferFromImageBitmap(null);
				this.carriedEl.width = 1;
				this.carriedEl.height = 1;
			}
		} else if (this.sheet) {
			if (!this.carriedEl) {
				const element = document.createElement("canvas");
				element.className = "stage-sheet stage-carried";
				element.setAttribute("aria-hidden", "true");
				this.carriedEl = element;
				this.carriedBitmaps = null;
			}
			const element = this.carriedEl;
			if (element.previousElementSibling !== this.sheet) this.sheet.after(element);
			this.carriedBitmaps ??= element.getContext("bitmaprenderer");
			if (this.carriedBitmaps) this.carriedBitmaps.transferFromImageBitmap(carried.bitmap);
			else carried.bitmap.close();
			element.style.width = `${frame.width}px`;
			element.style.height = `${frame.height}px`;
			this.carriedAt = at;
			element.hidden = false;
			this.slideCarried(this.carriedBy.dx, this.carriedBy.dy);
		} else carried.bitmap.close();
		const boards: ReadonlySet<string> = new Set(carried?.boards ?? []);
		if (boards.size === this.carryingNow.size && [...boards].every((path) => this.carryingNow.has(path))) return;
		this.carryingNow = boards;
		this.carrying?.(boards);
	}

	/**
	 * The item under a stage point: the one drawn last, since that is the one on top.
	 *
	 * Tested against what an item draws (`bounds`), not the box it was given: a petal drawn in a
	 * corner of a 600 by 700 box is hit on the petal. A press finds the outermost group round what
	 * it hit, the way a design tool selects a group whole; `deep` finds the item itself, for a
	 * double-click. Boards are not drawn here and are not found; an item inside an instance is
	 * found as the instance, because a copy is moved and deleted whole.
	 */
	/**
	 * Where an item is drawn, as an upright box that encloses it: its own box, unless it was turned,
	 * when it is the box round the turned one. What the index searches and what a marquee compares.
	 */
	private drawnBox(placed: Placed): Frame {
		const box = this.bounds.get(placed.node.id) ?? placed.box;
		const back = this.turns.get(placed.node.id);
		if (!back) return box;
		const forward = invertTurn(back);
		const points = cornersOf(box).map((corner) => applyTurn(forward, corner));
		const x = Math.min(...points.map((p) => p.x));
		const y = Math.min(...points.map((p) => p.y));
		return { x, y, w: Math.max(...points.map((p) => p.x)) - x, h: Math.max(...points.map((p) => p.y)) - y };
	}

	/** A stage point in an item's own upright coordinates: itself, unless the item was turned. */
	private turnedPoint(id: string, point: { x: number; y: number }): { x: number; y: number } {
		const back = this.turns.get(id);
		return back ? applyTurn(back, point) : point;
	}

	hitTest(point: { x: number; y: number }, options?: { deep?: boolean; skip?: (node: PenNode) => boolean }): PenHit | undefined {
		let best: Placed | undefined;
		for (const at of this.placedIndex.search({ x: point.x, y: point.y, w: 0, h: 0 })) {
			const placed = this.placedList[at]!;
			const { node } = placed;
			if (node.id.includes("/") || node.type === "group") continue;
			if (options?.skip?.(node)) continue;
			if (node.type === "browser" && node.metadata?.type === "decks.board") continue;
			const box = this.bounds.get(node.id) ?? placed.box;
			// A turned item is drawn somewhere its upright box is not: the press is carried back to the box (`turn.ts`).
			const local = this.turnedPoint(node.id, point);
			if (local.x < box.x || local.x > box.x + box.w || local.y < box.y || local.y > box.y + box.h) continue;
			if (!best || placed.order > best.order) best = placed;
		}
		if (!best) return undefined;
		if (!options?.deep) {
			// A group is picked whole, and so is a shape (`@decks/pen`, `shapes.ts`): its outline and words are parts of it.
			for (let up = best.parent ? this.placed.get(best.parent) : undefined; up; up = up.parent ? this.placed.get(up.parent) : undefined) {
				if (up.node.type === "group" || isShape(up.node)) best = up;
			}
		}
		return { id: best.node.id, node: best.node, box: { ...(this.bounds.get(best.node.id) ?? best.box) } };
	}

	/**
	 * Every item wholly inside a stage rectangle, leaving out any whose parent is picked too:
	 * what a marquee selects. Boards and the inside of an instance are not items to select.
	 */
	/** The markdown card on top at a stage point, its links as drawn, and the point inside it. */
	private cardAt(point: { x: number; y: number }) {
		let found: CardGeometry | undefined;
		for (const card of this.cards) {
			const { box } = card;
			if (this.hidden.has(card.id) || (found && card.order < found.order)) continue;
			if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			found = card;
		}
		return found ? { card: found, x: point.x - found.box.x - NOTE_PAD, y: point.y - found.box.y - NOTE_PAD } : undefined;
	}

	/**
	 * The link under a stage point, in a markdown card: where a press there would go. The card's
	 * links are the ones it was drawn with, so the boxes are exact; a link in a wide table is where
	 * the table's scroll has put it, and only while it is in view.
	 */
	linkAt(point: { x: number; y: number }): string | undefined {
		const found = this.cardAt(point);
		if (!found) return undefined;
		const { card, x, y } = found;
		return card.links.find((l) => {
			let lx = l.x;
			if (l.scroller !== undefined) {
				const view = card.scrollers[l.scroller];
				if (!view || x < view.x || x > view.x + view.w) return false;
				lx -= this.scrollOf(card.id, l.scroller);
			}
			return x >= lx && x <= lx + l.w && y >= l.y && y <= l.y + l.h;
		})?.href;
	}

	/** How far each card's wide tables are scrolled, by `id:index`. The stage's to keep, not the file's. */
	private readonly scrolls = new Map<string, number>();
	private scrollOf(id: string, index: number): number {
		return this.scrolls.get(`${id}:${index}`) ?? 0;
	}

	/**
	 * Scroll the wide table under a stage point sideways by `dx` stage pixels. True when there was one
	 * to scroll — even at its end, so a sideways gesture over a table never turns into a pan halfway.
	 */
	scrollBy(point: { x: number; y: number }, dx: number): boolean {
		const found = this.cardAt(point);
		if (!found) return false;
		const { card, x, y } = found;
		const index = card.scrollers.findIndex((v) => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h);
		const view = card.scrollers[index];
		if (!view) return false;
		const key = `${card.id}:${index}`;
		const now = this.scrolls.get(key) ?? 0;
		const next = Math.max(0, Math.min(view.content - view.w, now + dx));
		if (next !== now) {
			this.scrolls.set(key, next);
			this.send({ type: "scroll", scrolls: [...this.scrolls] });
		}
		return true;
	}

	within(r: Frame): string[] {
		const index = this.doc ? indexOf(this.doc) : new Map();
		const inside = new Set<string>();
		for (const at of this.placedIndex.search(r)) {
			const { node, box: given } = this.placedList[at]!;
			if (node.id.includes("/") || (node.type === "browser" && node.metadata?.type === "decks.board")) continue;
			// A shape's outline and words are never picked apart from it.
			if (isShape(index.get(node.id)?.parent)) continue;
			const box = this.bounds.get(node.id) ?? given;
			if (box.x >= r.x && box.y >= r.y && box.x + box.w <= r.x + r.w && box.y + box.h <= r.y + r.h) inside.add(node.id);
		}
		return [...inside].filter((id) => {
			for (let parent = index.get(id)?.parent; parent; parent = index.get(parent.id)?.parent) if (inside.has(parent.id)) return false;
			return true;
		});
	}

	/**
	 * Draw items moved or resized by a gesture that has not been saved yet; nothing to stop (`scene.ts`).
	 * A move is told to the worker once, when it picks the items up; every step after that slides the
	 * carried picture here.
	 */
	preview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		const changes = moving?.size ? [...moving] : undefined;
		const slide = !!changes && changes.every(([, change]) => change.w === undefined && change.h === undefined);
		if (slide) {
			const first = changes![0]![1];
			this.slideCarried(first.dx, first.dy);
			const key = changes!.map(([id]) => id).sort().join("|");
			if (key === this.carriedKey) return;
			this.carriedKey = key;
		} else this.carriedKey = "";
		this.send({ type: "preview", moving: changes });
	}

	/** Boards a drag carries, and how far: drawn as pictures on the carried layer, slid here (`preview`). */
	carry(boards: readonly string[], by: { dx: number; dy: number }): void {
		if (boards.length) this.slideCarried(by.dx, by.dy);
		const key = [...boards].sort().join("|");
		if (key === this.boardsCarried) return;
		this.boardsCarried = key;
		this.send({ type: "carry", boards: [...boards] });
	}

	private slideCarried(dx: number, dy: number): void {
		this.carriedBy = { dx, dy };
		if (this.carriedEl && !this.carriedEl.hidden) this.carriedEl.style.transform = `translate(${dx}px, ${dy}px) ${this.carriedAt}`;
	}

	/**
	 * The ink the drawing does not hold yet — the stroke under the pen, and finished ones until the
	 * stage's answer draws them — drawn on the sheet over everything (`StageInk`). `warm` with no
	 * strokes loads the painter ahead of the first stroke, when the draw tool is picked up.
	 */
	ink(strokes: LiveInk[], warm?: boolean): void {
		// How many strokes the sheet holds as live ink: what a check watches across a lift.
		sheetStats().ink = strokes.length;
		this.send({ type: "ink", strokes, ...(warm ? { warm } : {}) });
	}

	/** Items drawn as if gone, while an eraser is over them and before the delete comes back. */
	private hidden: ReadonlySet<string> = new Set();

	muteText(ids: ReadonlySet<string> | undefined): void {
		this.send({ type: "mute", ids: [...(ids ?? [])] });
	}

	hide(ids: ReadonlySet<string> | undefined): void {
		const next = ids ?? new Set<string>();
		if (next.size === 0 && this.hidden.size === 0) return;
		this.hidden = next;
		this.send({ type: "hide", ids: [...next] });
	}

	/** The one sheet the drawing and the boards' pictures are shown on, among the boards. */
	attach(element: HTMLCanvasElement): void {
		this.sheet = element;
		this.bitmaps = null;
	}

	/** The SVG the click shapes are written into, among the boards and over the sheet. */
	attachHits(svg: SVGSVGElement): void {
		this.hits = svg;
		this.writeHits();
	}

	setDoc(doc: PenDocument | undefined, base: string): void {
		if (doc === this.doc && base === this.base) return;
		this.doc = doc;
		this.base = base;
		this.hidden = new Set();
		// The worker lets go of a carried move when a drawing arrives (`scene.ts`), so the next one is told afresh.
		this.carriedKey = "";
		const seq = ++this.seq;
		this.docs.set(seq, doc);
		this.send({ type: "doc", doc, base, seq });
	}

	/** The boards on this stage, by path, and how each is drawn: a hole over its document, or its picture. */
	setBoards(boards: readonly SceneBoard[]): void {
		const key = boards.map((b) => `${b.path}@${b.x},${b.y},${b.w},${b.h},${b.live ? 1 : 0},${b.picture ?? ""},${b.ready ? 1 : 0},${b.news ?? ""},${b.glow ? 1 : 0}`).join("|");
		if (key === this.boardKey) return;
		this.boardKey = key;
		this.send({ type: "boards", boards: boards.map((b) => ({ ...b })) });
		const boxes = boards.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join("|");
		if (boxes !== this.boardBoxes) {
			this.boardBoxes = boxes;
			this.boardIndex = new BoxIndex(boards.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })));
			this.writeHits();
		}
	}

	setScheme(scheme: "light" | "dark"): void {
		if (scheme === this.scheme) return;
		this.scheme = scheme;
		this.send({ type: "scheme", scheme });
	}

	setCamera(camera: Camera): void {
		this.camera = camera;
		this.send({ type: "camera", camera, moving: this.moving });
		// The click shapes follow the window: written again only once it has left the area they cover.
		if (this.hitWindow && this.placedList.length > 0) {
			const seen = this.windowRect(0);
			const w = this.hitWindow;
			if (seen.x < w.x || seen.y < w.y || seen.x + seen.w > w.x + w.w || seen.y + seen.h > w.y + w.h) this.writeHits();
		}
	}

	/** The window on the stage, grown by `more` windows on each side. */
	private windowRect(more: number): Rect {
		const { x, y, zoom } = this.camera;
		const w = this.view.width / zoom;
		const h = this.view.height / zoom;
		return { x: x - w / 2 - more * w, y: y - h / 2 - more * h, w: w * (1 + 2 * more), h: h * (1 + 2 * more) };
	}

	/** Whether the camera is being moved: pictures wait for it to stop before changing size. */
	setMoving(moving: boolean): void {
		if (moving === this.moving) return;
		this.moving = moving;
		this.send({ type: "camera", camera: this.camera, moving });
	}

	setView(view: { width: number; height: number }): void {
		this.view = view;
		const dpr = Math.min(MAX_DPR, (typeof devicePixelRatio === "number" ? devicePixelRatio : 1) || 1);
		this.send({ type: "view", width: view.width, height: view.height, dpr, overscan: OVERSCAN, budget: PICTURE_BUDGET, widest: PICTURE_WIDEST });
		if (this.placedList.length > 0) this.writeHits();
	}

	dispose(): void {
		this.send({ type: "dispose" });
		this.disposed = true;
		this.port.close();
		this.carriedEl?.remove();
	}

	/**
	 * The click shapes: one invisible SVG shape per drawn item on the over sheet, in stage units,
	 * among the boards. A filled shape catches clicks over its area; a line, over a band 12 units
	 * wide, so a thin arrow can still be picked up. A group has no shape of its own: its children do.
	 */
	private writeHits(): void {
		const svg = this.hits;
		if (!svg) return;
		const NS = "http://www.w3.org/2000/svg";
		const shapes: SVGElement[] = [];
		const add = (placed: Placed) => {
			const { node, box } = placed;
			if (node.id.includes("/") && node.type === "group") return;
			if (node.type === "browser" && node.metadata?.type === "decks.board") return;
			if (node.type === "group") return;
			// A shape is clicked where its outline is drawn, which has its own click shape: its box's corners are not it.
			if (isShape(node)) return;
			let shape: SVGElement;
			if (node.type === "ellipse") {
				shape = document.createElementNS(NS, "ellipse");
				shape.setAttribute("cx", String(box.x + box.w / 2));
				shape.setAttribute("cy", String(box.y + box.h / 2));
				shape.setAttribute("rx", String(box.w / 2));
				shape.setAttribute("ry", String(box.h / 2));
			} else if (node.type === "path" && typeof node.geometry === "string") {
				const vb = node.viewBox ?? (() => {
					const b = pathBounds(node.geometry as string);
					return b ? ([b.x, b.y, b.w, b.h] as const) : undefined;
				})();
				if (!vb || vb[2] <= 0 || vb[3] <= 0) return;
				shape = document.createElementNS(NS, "path");
				shape.setAttribute("d", node.geometry);
				shape.setAttribute("transform", `translate(${box.x} ${box.y}) scale(${box.w / vb[2]} ${box.h / vb[3]}) translate(${-vb[0]} ${-vb[1]})`);
				const filled = node.fill !== undefined && node.fill !== null;
				shape.setAttribute("stroke-width", String(Math.max(12, typeof node.strokeWidth === "number" ? node.strokeWidth : 0)));
				shape.setAttribute("vector-effect", "non-scaling-stroke");
				shape.style.pointerEvents = filled ? "all" : "stroke";
			} else {
				const bounds = this.bounds.get(node.id) ?? box;
				shape = document.createElementNS(NS, "rect");
				shape.setAttribute("x", String(bounds.x));
				shape.setAttribute("y", String(bounds.y));
				shape.setAttribute("width", String(Math.max(0, bounds.w)));
				shape.setAttribute("height", String(Math.max(0, bounds.h)));
			}
			// Turned, the shape is drawn where the turn leaves it, so a press over a board lands on it there.
			const back = this.turns.get(node.id);
			if (back) {
				const m = invertTurn(back);
				const already = shape.getAttribute("transform");
				shape.setAttribute("transform", `matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]})${already ? ` ${already}` : ""}`);
			}
			shape.setAttribute("class", "pen-hit");
			shape.setAttribute("fill", "none");
			shape.setAttribute("stroke", "none");
			shape.dataset.id = node.id;
			shapes.push(shape);
		};
		/*
		 * Only for the items near the window. A shape is a node the browser keeps and tests, and one a
		 * screen away from anything the pointer can reach is a node for nothing; `setCamera` writes the
		 * set again when the window leaves the area this one covers.
		 */
		const reach = this.view.width > 0 ? this.windowRect(1) : undefined;
		this.hitWindow = reach;
		const near = reach ? this.placedIndex.search(reach).map((at) => this.placedList[at]!) : this.placedList;
		for (const placed of near) {
			let top = placed;
			while (top.parent) top = this.placed.get(top.parent) ?? top;
			if (top.parent) continue;
			const box = this.bounds.get(placed.node.id) ?? placed.box;
			if (this.boardIndex.search(box).length === 0) continue;
			add(placed);
		}
		svg.replaceChildren(...shapes);
	}
}
