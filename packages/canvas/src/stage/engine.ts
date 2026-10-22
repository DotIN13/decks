/**
 * The stage's engine, on the page: the Rust page engine (`@decks/stage`) and its render worker.
 *
 * The page engine owns a copy of the drawing, kept on the server's revision by its edits
 * (`stage.pen.delta`), and answers what the stage asks of the drawing: where each item is, what is
 * under a point, what a marquee holds, a card's links. Each frame it draws two canvases in the same
 * call that moves the board pages (`frame`): under them, the boards' pictures; over them, the
 * worker's tiles, then what a gesture is moving and the stroke under the pen, drawn fresh.
 *
 * Fonts, pictures, icons and the markdown reader are the app's own, fetched here and handed to both
 * engines once each.
 */
import type { PageEngine } from "@decks/stage";
import { diff, isShape, pathBounds, shapeKind, shapeOutline, shapeRadius, type Frame, type PenDocument, type PenNode, type Placed, type ThemeState } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { fontFiles, isFallbackFamily, type FontNeed } from "../pen/font-files.ts";
import { iconUrl, parseIcon } from "../pen/icons.ts";
import { pictureAddress } from "../host.ts";
import { snapMove, type Box, type Guide } from "../pen/snap.ts";
import { boundsOf } from "../pen/bounds.ts";
import { docIndex, drawnNodes } from "../pen/doc-index.ts";
import { BoxIndex, type Rect } from "../spatial.ts";
import { cardReader, mathTypesetter } from "./reader.ts";
import { GLIDE_MS, glideAt, glideShifts } from "../editor/core/glide.ts";
import type { CardGeometry, FromWorker, LiveInk, PenPreview, SceneBoard, ToWorker } from "./types.ts";
import { detect, type Detected } from "./backends/detect.ts";
import { noticeFor } from "./backends/notice.ts";

/** How far a press reaches a line, in screen pixels: wider for a finger. */
const BAND_PX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 12 : 8;
/** The copies of a board's picture the server keeps (0 is the whole one), smallest that covers the board on screen. */
const SMALL = [192, 480];
/**
 * A board's picture is fetched again, larger, once it is shown this much bigger than the copy held
 * (a zoom in on a phone kept the first, small one, blurred): checked when the zoom has rested this
 * long, so a pinch asks once at its end rather than at every step.
 */
const SHARPER_AT = 1.2;
const SHARPER_AFTER_MS = 250;
/** Pictures fetched at once, and a stand-in picture asked for again this often, this many times. */
const FETCHES = 6;
const STAND_IN_RETRY_MS = 1200;
const STAND_IN_TRIES = 50;
/** How long to wait before asking again for a picture that did not load, each time it fails again. */
const PICTURE_RETRY_MS = [2000, 5000, 15000, 30000, 60000];
/**
 * How far past each edge of the window the canvas is drawn, in screen pixels. A pan slides the canvas
 * last drawn rather than drawing it again, until the window reaches its edge: drawing the whole window
 * was the most of a pan's time on the GPU (110 ms from a wheel step to its frame at 22% on a 2× screen).
 */
const SLACK_PX = 320;
/** The largest canvas side a GPU is sure to take, in device pixels. */
const MAX_SIDE = 8192;

/** What the stage last did, for checks and the crash recorder to read: the old sheet's counters, and the engine's. */
/**
 * `shown` counts the page's draws and `tiles` the worker's tiles that reached the page. `sharpAt` is
 * the `performance.now()` of the first draw at rest after a batch from a worker that had every
 * message the page sent it (the drawing, its fonts, pictures) and had nothing left to paint in the
 * window and its margin at the resting scale, with no font still being fetched: the first sharp frame.
 * Measured by `e2e/checks/render-perf.mjs`.
 */
type SheetStats = Record<string, unknown> & { shown?: number; ink?: number; tiles?: number; sharpAt?: number };
const sheetStats = (): SheetStats => ((globalThis as { __decksSheet?: SheetStats }).__decksSheet ??= { shown: 0, tiles: 0 });

const EMPTY = '{"version":"2.14","children":[]}';

/** What the page engine laid out again since it was last asked (`Page::layout_changes`). */
type LayoutChanges = {
	all: boolean;
	roots: Array<{ id: string; base: number; items: Array<[string, number, number, number, number, string | null, number, ThemeState]>; cards: RootCard[] }>;
	removed: string[];
	bases: Array<[string, number]>;
};
/** A card as the engine sends it with its top-level item: its place in that item's tree (`i`) rather than its paint order. */
type RootCard = Omit<CardGeometry, "order"> & { i: number };
type RootLaid = { base: number; items: Array<[string, number]>; cards: RootCard[] };

/**
 * The stage's drawing for `Stage.tsx`, with the same calls the CanvasKit sheet had (`canvas/pen/layer.ts`)
 * so the stage chooses between the two by one setting while this one is proved.
 */
export class StageEngine {
	private page: PageEngine | undefined;
	private worker: Worker | undefined;
	private disposed = false;
	private camera: Camera = { x: 0, y: 0, zoom: 1 };
	private view = { width: 0, height: 0 };
	private scheme: "light" | "dark" = "light";
	private moving = false;
	/** The drawing as both engines hold it, and the address its pictures are relative to. */
	private doc: PenDocument | undefined;
	private base = "";
	private over: HTMLCanvasElement | undefined;
	private hits: SVGSVGElement | undefined;
	private hitWindow: Rect | undefined;
	private bandZoom = 0;
	private boardIndex = new BoxIndex([]);
	/** The boards `boardIndex` answers for, in its order: `boards` when it is up to date with them. */
	private indexed: readonly SceneBoard[] = [];
	private boardBoxes = "";
	private size = { w: 0, h: 0 };
	/** The canvas's margin past the window, in screen pixels, and the stage rectangle it was last drawn for. */
	private slack = 0;
	private drawnAt: { x: number; y: number; zoom: number } | undefined;
	private boards: readonly SceneBoard[] = [];
	private boardKey = "";
	private viewState = { hidden: [] as string[], mute: [] as string[], holes: [] as string[], scrolls: {} as Record<string, number> };
	private viewKey = "";
	private fontsAsked = new Set<string>();
	/**
	 * Pictures fetched, by key: the address fetched (a board's may carry a size), the board's own
	 * address for it, stand-in retries, and for a board's the copy's width (0: the whole picture).
	 */
	private picturesAsked = new Map<string, { url: string; source: string; tries: number; size?: number; failed?: number }>();
	/** Fonts loaded, kept to give an engine started again after its device was lost. */
	private fonts: Array<{ family: string; bytes: Uint8Array; fallback: boolean }> = [];
	private iconsAsked = new Set<string>();
	private fetching = 0;
	private lifted = new Set<string>();
	private sent = 0;
	private shownSeen = 0;
	/** Messages posted to the worker that is running now, and that count when the last one that changes what it paints was posted. */
	private posted = 0;
	private postedContent = 0;
	/** Font files asked for and not yet given to the engines. */
	private fontsPending = 0;
	/** A batch came from a worker with nothing left to paint: the next draw at rest is a sharp one (`sharpAt`). */
	private sharpNext = false;
	/** A stage engine that could not start: the stage shows these words (`backends/notice.ts`) rather than drawing nothing silently. */
	failed: ((notice: string) => void) | undefined;
	/** After each new layout, so the stage can redraw a selection round what moved. */
	drawn: (() => void) | undefined;
	/** After each frame is on screen. */
	presented: (() => void) | undefined;
	/** The boards drawn as their picture, when that changes. */
	pictured: ((paths: ReadonlySet<string>) => void) | undefined;
	/** The live boards a drag carries as their picture, whose pages wait unseen. */
	carrying: ((paths: ReadonlySet<string>) => void) | undefined;
	private picturedKey = "";
	private carryingKey = "";
	/** The engine's `boardMarks` when `pictured` and `carrying` were last read: read again only when it moves. */
	private marksSeen = -1;

	/** Every item as laid out, by id, with its node; and what each item covers. */
	placed: ReadonlyMap<string, Placed> = new Map<string, Placed>();
	bounds: ReadonlyMap<string, Frame> = new Map<string, Frame>();
	/** The document the layout was made from. */
	drawnDoc: PenDocument | undefined;
	private scrolls = new Map<string, number>();
	private penHit?: CanvasRenderingContext2D;
	/** Not used by this engine: kept so the stage can treat both alike. */
	drewDrawing = true;
	onCarryPending: ((pending: boolean) => void) | undefined;
	/**
	 * Each frame of a drop's glide (`startGlide`): how far each item that glides is still drawn from
	 * where it lands, so the outlines round them ride along; undefined when the glide ends or a new
	 * gesture cancels it.
	 */
	onGlide: ((shifts: ReadonlyMap<string, { dx: number; dy: number }> | undefined) => void) | undefined;

	/**
	 * The canvas, once the stage has made it: among the board pages, after them. The boards'
	 * pictures, the drawing and what a gesture moves are all drawn on it.
	 */
	attachCanvas(canvas: HTMLCanvasElement): void {
		this.over = canvas;
		if (!this.started) {
			this.started = true;
			void this.start(canvas).catch((error: unknown) => this.fail(error));
		}
	}
	private started = false;
	private lastOps = 0;
	/** The graphics API the stage draws with, `"webgpu"` or `"webgl2"`, once open. */
	private backend = "";
	/** The worker's, which it opens the page's first. */
	private workerBackend = "";
	/** The widest and tallest a picture is kept (the device's limit, or 4096): bigger ones are resized. */
	private maxPicture = 4096;
	/** What this browser draws with (`backends/detect.ts`), found once. */
	private detected: Detected | undefined;
	/** Stops watching for the device to be lost. */
	private unwatch: (() => void) | undefined;
	/** The device is gone and nothing is drawn until the engine has started again. */
	private paused = false;
	private restarting = false;
	/** Times the engine started again after its device was lost (WebGPU) or its context (WebGL 2). */
	private restarts = 0;
	/** The pictures put on the page engine, of boards and of fills: for checks. */
	private picturesPut = 0;

	private fail(error: unknown): void {
		console.error(`stage engine: ${String((error as Error)?.message ?? error)}`);
		this.failed?.(noticeFor(error));
	}

	private async start(over: HTMLCanvasElement): Promise<void> {
		const found = (this.detected ??= await detect());
		const stage = await found.backend.load();
		if (this.disposed) return;
		this.fitCanvases();
		const gpu = await stage.openStage(over, over.width, over.height, found.backend.name, found.lowMemory);
		if (this.disposed) return gpu.free();
		this.backend = gpu.backend();
		this.maxPicture = gpu.maxPictureSize();
		const doc = this.doc ? JSON.stringify(this.doc) : EMPTY;
		(globalThis as { __decksRust?: unknown }).__decksRust = this;
		const self = this;
		(globalThis as { __decksEngine?: unknown }).__decksEngine = {
			stats: () => ({ tiles: this.page?.tileCount() ?? 0, drawn: [this.lastOps, this.lastOps], engine: "rust", backend: this.backend, workerBackend: this.workerBackend, maxPicture: this.maxPicture, restarts: this.restarts, pictures: this.picturesPut, paused: this.paused }),
			/** The boards a drag carries as their picture, and by how far. */
			get carried() {
				return { paths: new Set(JSON.parse(self.page?.carrying() ?? "[]") as string[]), ...self.carriedBy };
			},
		};
		this.page = new stage.PageEngine(doc, this.scheme === "dark", `s${Math.random().toString(36).slice(2, 7)}`);
		this.page.setGpu(gpu);
		this.page.setMarkdownReader(cardReader(this.scheme));
		this.page.setMath(mathTypesetter());
		this.paused = false;
		this.worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
		this.posted = 0;
		this.postedContent = 0;
		this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.receive(data);
		this.post({ type: "init", doc, dark: this.scheme === "dark", backend: this.backend, lowMemory: found.lowMemory });
		for (const font of this.fonts) {
			this.page.addFont(font.family, font.bytes, font.fallback);
			this.post({ type: "font", name: font.family, bytes: font.bytes, fallback: font.fallback });
		}
		this.unwatch = found.backend.watch(over, { lost: () => this.lose(), restored: () => void this.restart(), isLost: () => this.page?.lost() ?? false });
		this.viewKey = "";
		this.sendView();
		this.boardKey = "";
		this.setBoards(this.boards);
		this.laidOut();
		this.needFonts();
		this.draw();
	}

	/**
	 * The device is gone (`backends/webgpu.ts`, `backends/webgl.ts`), or the worker's: nothing more
	 * is drawn, and the engines are let go while their context is lost, so what they free is freed
	 * on nothing. The drawing, the boards, the camera and the fonts stay here for `restart`.
	 */
	private lose(): void {
		if (this.paused) return;
		this.paused = true;
		this.worker?.terminate();
		this.worker = undefined;
		this.page?.free();
		this.page = undefined;
		this.picturesAsked.clear();
		this.iconsAsked.clear();
		this.lifted.clear();
		this.picturedKey = "";
		this.carryingKey = "";
		this.marksSeen = -1;
		this.drawnAt = undefined;
		this.shown = undefined;
	}

	/** Start both engines again on the same canvas, once its context is back. */
	private async restart(): Promise<void> {
		if (this.disposed || this.restarting || !this.over) return;
		this.lose();
		// The new engine watches its own device (`start`).
		this.unwatch?.();
		this.unwatch = undefined;
		this.restarting = true;
		this.restarts++;
		try {
			await this.start(this.over);
		} catch (error) {
			this.fail(error);
		} finally {
			this.restarting = false;
		}
	}

	private post(message: ToWorker, transfer: Transferable[] = []): void {
		if (this.worker) {
			this.worker.postMessage(message, transfer);
			this.posted++;
			if (message.type !== "camera" && message.type !== "dropped") this.postedContent = this.posted;
		}
		this.sent++;
	}

	private receive(message: FromWorker): void {
		if (this.disposed || !this.page) {
			if (message.type === "tiles") for (const t of message.tiles) t.bitmap.close();
			return;
		}
		switch (message.type) {
			case "tiles":
				for (const t of message.tiles) this.page.putTile(t.scale, t.x, t.y, t.bitmap);
				sheetStats().tiles = (sheetStats().tiles ?? 0) + message.tiles.length;
				if (message.left === 0 && message.got >= this.postedContent && this.fontsPending === 0) this.sharpNext = true;
				{
					const gone = JSON.parse(this.page.evict()) as Array<[number, number, number]>;
					if (gone.length) this.post({ type: "dropped", keys: gone });
				}
				// On screen with the next frame's one draw, however many batches come before it.
				this.seenAtDraw = this.sent;
				this.drawSoon();
				break;
			case "discarded":
				this.page.forgetTiles(JSON.stringify(message.keys));
				this.drawSoon();
				break;
			case "landed":
				this.page.landed(JSON.stringify(message.ids));
				for (const id of message.ids) this.lifted.delete(id);
				this.draw();
				break;
			case "wanted":
				this.wantPictures(message.urls);
				break;
			case "resync":
				this.post({ type: "doc", doc: this.doc ? JSON.stringify(this.doc) : EMPTY, dark: this.scheme === "dark" });
				break;
			case "error":
				console.error(`stage render worker: ${message.message}`);
				break;
			case "failed":
				this.fail(message.message);
				break;
			case "lost":
				// The worker's device went: both start again, so the tiles and the page agree.
				void this.restart();
				break;
			case "ready":
				this.workerBackend = message.backend;
				this.sendCamera();
				break;
		}
	}

	/**
	 * The drawing to show: the server's, or a copy with words being typed. What changed from the one
	 * held is found by `diff` and applied to both engines in place; one they cannot apply goes whole.
	 */
	setDoc(doc: PenDocument | undefined, base: string): void {
		if (doc === this.doc && base === this.base) return;
		const before = this.doc;
		this.doc = doc;
		this.base = base;
		/*
		 * What a delete hid while it waited is the drawing's business again: the answer has it gone, or,
		 * after an undo, back. The engines are told (below, after the drawing), or they went on hiding a
		 * restored item until the page was loaded again.
		 */
		const unhide = this.viewState.hidden.length > 0;
		this.viewState.hidden = [];
		if (!this.page) return;
		/*
		 * A drawing that arrives ends any preview: whatever a drag was showing is now the drawing itself.
		 * The page applies a preview to its own copy and takes it back after, so it is taken back before
		 * the edits rather than over them. Lifted items stay lifted, drawn where the drawing now has them,
		 * until the stage puts the gesture down.
		 */
		this.page.setPreview("null");
		this.shown = undefined;
		if (!doc) this.whole(undefined);
		else if (!before) this.whole(doc);
		else {
			const edits = diff(before, doc);
			if (edits.length) {
				const text = JSON.stringify(edits);
				try {
					this.page.applyEdits(text);
					this.post({ type: "edits", edits: text });
				} catch {
					this.whole(doc);
				}
			}
		}
		if (unhide) this.sendView();
		this.laidOut();
		this.needFonts();
		// A drop that moved things glides them in from where they were let go, from this very frame.
		const gliding = this.settling && this.startGlide();
		if (!gliding) this.draw();
		// A drag of boards alone that was let go: its arrows are now the drawing's own, routed where the boards landed.
		if (this.boardsOnly && !this.carriedCount) this.landBoards();
		// A gesture let go: the drawing that answers it is here, so what it lifted goes back into the tiles.
		if (this.settling) {
			this.settling = false;
			this.landing = undefined;
			if (this.lifted.size && !this.boardsOnly) this.post({ type: "drop", ids: [...this.lifted] });
		}
	}

	/**
	 * Where what a drop can move was let go (`settle`), and the glide in hand: each item's shift from
	 * where it lands, and when it began.
	 */
	private landing: ReadonlyMap<string, Frame> | undefined;
	private glide: { shifts: ReadonlyMap<string, { dx: number; dy: number }>; start: number; frame: number } | undefined;

	/**
	 * The drawing that answers a drop is laid out: everything that moved glides from where it was let
	 * go to where it is now (`editor/core/glide.ts`), drawn lifted with a shrinking offset for
	 * `GLIDE_MS`, then put down. Shown before this drawing's first frame, so nothing is drawn where it
	 * lands before it has glided there. False when nothing moved.
	 */
	private startGlide(): boolean {
		const landing = this.landing;
		this.landing = undefined;
		if (!landing || !this.page) return false;
		const shifts = glideShifts(landing, (id) => this.placed.get(id)?.box, (id) => this.placed.get(id)?.parent);
		if (!shifts.size) return false;
		this.settling = false;
		const start = performance.now();
		const first = glideAt(shifts, 0);
		this.showPreview(first);
		this.onGlide?.(first);
		const step = () => {
			const glide = this.glide;
			if (!glide || this.disposed) return;
			const elapsed = performance.now() - glide.start;
			if (elapsed >= GLIDE_MS) {
				this.glide = undefined;
				this.showPreview(undefined);
				this.onGlide?.(undefined);
				return;
			}
			const now = glideAt(glide.shifts, elapsed);
			this.showPreview(now);
			this.onGlide?.(now);
			glide.frame = requestAnimationFrame(step);
		};
		this.glide = { shifts, start, frame: requestAnimationFrame(step) };
		return true;
	}

	/**
	 * A gesture was let go and its edit sent (`Stage.tsx`, `settleGesture`). When the drawing that
	 * answers it arrives, what it lifted is put down: painted back into the worker's tiles, and drawn
	 * here until they come (`landed`). Without this an item stayed lifted after its drop, drawn by
	 * the page every frame and holding the worker to the screen's tiles. A new gesture first cancels it.
	 */
	settle(landing?: ReadonlyMap<string, Frame>): void {
		this.settling = true;
		this.landing = landing;
	}
	private settling = false;


	private whole(doc: PenDocument | undefined): void {
		const text = doc ? JSON.stringify(doc) : EMPTY;
		this.page?.setDocument(text);
		this.post({ type: "doc", doc: text, dark: this.scheme === "dark" });
	}

	/**
	 * Take in what the page engine laid out again since the last time (`layoutChanges`): each item's box
	 * with its node, what it covers, the cards. Only the top-level items it re-laid are read, so a
	 * drag's step (the arrows it bends) and an edit (what it reached) cost what they changed, not the
	 * canvas. `placed` stays in paint order.
	 *
	 * `quiet` (a drag's step that only moves things, `showPreview`): the click shapes over boards and
	 * the stage's readers of the layout (`drawn`) wait for the gesture's end, since nothing they read
	 * changed but the arrows the drag bends.
	 */
	private laidOut(quiet = false): void {
		if (!this.page) return;
		const doc = this.doc;
		const changes = JSON.parse(this.page.layoutChanges()) as LayoutChanges;
		const nodes = doc ? drawnNodes(doc) : new Map<string, PenNode>();
		const placed = this.placed as Map<string, Placed>;
		const bounds = this.bounds as Map<string, Frame>;
		const forget = (root: RootLaid) => {
			for (const [id] of root.items) {
				placed.delete(id);
				bounds.delete(id);
			}
		};
		if (changes.all) {
			placed.clear();
			bounds.clear();
			this.laid.clear();
		}
		// Whether the map is still in paint order after the changes: items set again keep their place, new ones go last.
		let inOrder = changes.bases.length === 0;
		let last = -1;
		for (const root of this.laid.values()) last = Math.max(last, root.base);
		for (const id of changes.removed) {
			const root = this.laid.get(id);
			if (!root) continue;
			forget(root);
			this.laid.delete(id);
		}
		for (const [id, base] of changes.bases) {
			const root = this.laid.get(id);
			if (!root) continue;
			root.base = base;
			for (const [item, i] of root.items) {
				const was = placed.get(item);
				if (was) placed.set(item, { ...was, order: base + i + 1 });
			}
		}
		for (const { id, base, items, cards } of changes.roots) {
			const was = this.laid.get(id);
			const subset = new Map<string, Placed>();
			const ids: Array<[string, number]> = [];
			for (const [item, x, y, w, h, parent, i, theme] of items) {
				const node = nodes.get(item);
				if (!node) continue;
				subset.set(item, { node, box: { x, y, w, h }, parent: parent ?? undefined, theme, order: base + i + 1 });
				ids.push([item, i]);
			}
			if (was) {
				const same = was.items.length === ids.length && was.items.every(([item], at) => item === ids[at]![0]);
				if (!same) {
					forget(was);
					inOrder = false;
				}
			} else if (base < last) inOrder = false;
			for (const [item, one] of subset) placed.set(item, one);
			for (const [item, frame] of boundsOf(subset)) bounds.set(item, frame);
			this.laid.set(id, { base, items: ids, cards });
		}
		if (!inOrder) {
			// Put back in paint order: an item came inside a top-level one, or the top level changed order.
			const all = [...placed.values()].sort((a, b) => a.order - b.order);
			placed.clear();
			for (const one of all) placed.set(one.node.id, one);
		}
		if (changes.all || changes.roots.length || changes.removed.length || changes.bases.length) {
			this.cardList = undefined;
			this.placedList = undefined;
			this.placedIndex = undefined;
		}
		this.drawnDoc = doc;
		if (quiet) return;
		this.writeHits();
		this.drawn?.();
	}
	/** Each top-level item as last laid out: its first paint order, its items with their place in it, its cards. */
	private laid = new Map<string, RootLaid>();
	private cardList: CardGeometry[] | undefined;
	/** The markdown cards, in paint order, made from `laid` when first asked for after a change. */
	private cards(): CardGeometry[] {
		if (this.cardList) return this.cardList;
		const list: CardGeometry[] = [];
		for (const root of this.laid.values()) for (const { i, ...card } of root.cards) list.push({ ...card, order: root.base + i + 1 });
		return (this.cardList = list);
	}

	setView(view: { width: number; height: number }): void {
		this.view = view;
		this.fitCanvases();
		this.sendCamera();
		this.writeHits();
		this.draw();
	}

	/** The canvas the window's size and `SLACK_PX` more on each side, in device pixels; the engine's surface follows in `frame`. */
	private fitCanvases(): void {
		const dpr = Math.min(2, devicePixelRatio || 1);
		this.slack = Math.max(0, Math.min(SLACK_PX, Math.floor((MAX_SIDE / dpr - Math.max(this.view.width, this.view.height)) / 2)));
		const cssW = this.view.width + 2 * this.slack;
		const cssH = this.view.height + 2 * this.slack;
		const w = Math.max(1, Math.round(cssW * dpr));
		const h = Math.max(1, Math.round(cssH * dpr));
		if (w === this.size.w && h === this.size.h) return;
		this.size = { w, h };
		this.drawnAt = undefined;
		for (const canvas of [this.over]) {
			if (!canvas) continue;
			canvas.width = w;
			canvas.height = h;
			canvas.style.width = `${cssW}px`;
			canvas.style.height = `${cssH}px`;
		}
	}

	/** The stage rectangle the canvas covers at the camera now: the window and the slack round it. */
	private drawRect(): { x: number; y: number; zoom: number; width: number; height: number } {
		const { x, y } = this.corner();
		const m = this.slack / this.camera.zoom;
		return { x: x - m, y: y - m, zoom: this.camera.zoom, width: this.view.width + 2 * this.slack, height: this.view.height + 2 * this.slack };
	}

	/**
	 * Whether the canvas last drawn still shows this camera, moved: the zoom is the same and the
	 * window is inside what was drawn. Only while the camera moves; at rest it is drawn again, centred
	 * and on whole pixels.
	 */
	private slides(): boolean {
		const at = this.drawnAt;
		if (!at || !this.moving || at.zoom !== this.camera.zoom) return false;
		const { x, y } = this.corner();
		const zoom = this.camera.zoom;
		return x >= at.x && y >= at.y && x + this.view.width / zoom <= at.x + (this.view.width + 2 * this.slack) / zoom && y + this.view.height / zoom <= at.y + (this.view.height + 2 * this.slack) / zoom;
	}

	/** The canvas sits in the world (`Stage.tsx`), so it is placed in stage units at the rectangle it was drawn for, and the world's transform moves it. */
	private place(): void {
		const at = this.drawnAt;
		if (!this.over || !at) return;
		this.over.style.transform = `translate(${at.x}px, ${at.y}px) scale(${1 / at.zoom})`;
	}

	setScheme(scheme: "light" | "dark"): void {
		if (scheme === this.scheme) return;
		this.scheme = scheme;
		if (this.page) {
			// The stage is drawn again in the other scheme: cards' colours, papers, ink.
			this.page.setMarkdownReader(cardReader(scheme));
			this.page.setDark(scheme === "dark");
			this.whole(this.doc);
			this.laidOut();
		}
		this.draw();
	}

	/** In the call that moves the board pages, and drawn there, so the two land in one frame. */
	setCamera(camera: Camera): void {
		this.camera = camera;
		if (!this.slides()) this.draw();
		this.sendCamera();
		this.wantBoardPictures();
		if (camera.zoom !== this.sharperZoom) {
			this.sharperZoom = camera.zoom;
			this.sharperSoon();
		}
		// The click shapes follow the window: written again once it leaves the area they cover.
		const w = this.hitWindow;
		if (w && this.placed.size) {
			const seen = this.windowRect(0);
			const drifted = this.bandZoom > 0 && (camera.zoom > this.bandZoom * 1.25 || camera.zoom < this.bandZoom * 0.8);
			if (drifted || seen.x < w.x || seen.y < w.y || seen.x + seen.w > w.x + w.w || seen.y + seen.h > w.y + w.h) this.writeHits();
		}
	}

	setMoving(moving: boolean): void {
		if (moving === this.moving) return;
		this.moving = moving;
		this.sendCamera();
		if (!moving) {
			this.wantBoardPictures();
			// Drawn again where the camera came to rest: the slack round it again, and on whole pixels.
			this.draw();
		}
	}

	/** The stage point at the window's top-left, from the camera's centre. */
	private corner(): { x: number; y: number } {
		return { x: this.camera.x - this.view.width / 2 / this.camera.zoom, y: this.camera.y - this.view.height / 2 / this.camera.zoom };
	}

	private sendCamera(): void {
		if (!this.view.width) return;
		// The worker paints tiles for the slack too, so a pan slides onto drawing rather than an empty margin.
		const { x, y, zoom, width, height } = this.drawRect();
		this.post({ type: "camera", x, y, zoom, dpr: Math.min(2, devicePixelRatio || 1), width, height, moving: this.moving });
	}

	/**
	 * Draw in the next frame, once, however many of the worker's messages come before it. The worker
	 * posts tiles a few at a time, and a page busy with a pan takes them in a burst: drawing for each
	 * drew the canvas fifteen times in three milliseconds, all in one frame (`engine-slide.mjs`).
	 */
	private drawSoon(): void {
		if (this.drawFrame) return;
		this.drawFrame = requestAnimationFrame(() => {
			this.drawFrame = 0;
			if (!this.disposed) this.draw();
		});
	}
	private drawFrame = 0;
	/** What had been sent when the tiles that arrived last were asked for: shown once they are drawn. */
	private seenAtDraw = 0;

	/** Draw the canvas now, for the window and its slack: from a camera that left what was drawn, or when anything else changes. */
	draw(): void {
		if (!this.page || !this.view.width || this.paused) return;
		// A draw now is the one a batch of tiles asked for in the next frame.
		if (this.drawFrame) {
			cancelAnimationFrame(this.drawFrame);
			this.drawFrame = 0;
		}
		this.shownSeen = Math.max(this.shownSeen, this.seenAtDraw);
		const at = this.drawRect();
		const ops = this.page.frame(at.x, at.y, at.zoom, Math.min(2, devicePixelRatio || 1), at.width, at.height, this.moving);
		this.drawnAt = { x: at.x, y: at.y, zoom: at.zoom };
		this.place();
		this.lastOps = ops;
		sheetStats().shown = (sheetStats().shown ?? 0) + 1;
		if (this.sharpNext && !this.moving) {
			this.sharpNext = false;
			sheetStats().sharpAt ??= performance.now();
		}
		// Asked for in JSON only when the engine says they changed: most frames, nothing did.
		const marks = this.page.boardMarks();
		if (marks !== this.marksSeen) {
			this.marksSeen = marks;
			const pictured = this.page.pictured();
			if (pictured !== this.picturedKey) {
				this.picturedKey = pictured;
				this.pictured?.(new Set(JSON.parse(pictured) as string[]));
			}
			const carrying = this.page.carrying();
			if (carrying !== this.carryingKey) {
				this.carryingKey = carrying;
				this.carrying?.(new Set(JSON.parse(carrying) as string[]));
			}
		}
		if (this.page.hasWanted()) this.wantPictures(JSON.parse(this.page.wantedPictures()) as string[]);
		this.presented?.();
	}

	// --- boards --------------------------------------------------------------------------------

	setBoards(boards: readonly SceneBoard[]): void {
		const was = this.boards;
		this.boards = boards;
		const key = JSON.stringify(boards.map((b) => [b.path, b.x, b.y, b.w, b.h, b.live, b.news, b.glow, b.picture]));
		if (key === this.boardKey || !this.page) {
			// The same boxes as the ones the index was made for: it answers for these too.
			if (key === this.boardKey && this.indexed === was) this.indexed = boards;
			return;
		}
		this.boardKey = key;
		this.page.setBoards(JSON.stringify(boards.map((b) => ({ path: b.path, x: b.x, y: b.y, w: b.w, h: b.h, live: b.live, news: b.news, glow: b.glow }))));
		const boxes = boards.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join("|");
		if (boxes !== this.boardBoxes) {
			this.boardBoxes = boxes;
			this.boardIndex = new BoxIndex(boards.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })));
			this.writeHits();
		}
		this.indexed = boards;
		/*
		 * A board whose picture changed is asked for again, against the board's own address: the one
		 * fetched carries a size (`&w=480`), and comparing that one forgot every server picture on each
		 * change of the boards, such as the zoom crossing the live zoom, so each board went white until
		 * it was fetched again. The old picture stays drawn until the new one replaces it.
		 */
		for (const board of boards) {
			const asked = this.picturesAsked.get(`board:${board.path}`);
			if (asked && board.picture && asked.source !== board.picture) this.picturesAsked.delete(`board:${board.path}`);
		}
		this.wantBoardPictures();
		this.draw();
	}

	private carriedBy = { dx: 0, dy: 0 };
	/**
	 * The boards a drag carries, and how far. An arrow with an end on one bends with it: the gesture's
	 * preview is sent again with the boards where they are now, or, when only boards are dragged, a
	 * preview of nothing but them. Such a drag's arrows stay as last routed when it is let go, until
	 * the server's drawing comes back routed to where the boards landed (`setDoc`), or two seconds pass.
	 */
	carry(paths: readonly string[], offset: { dx: number; dy: number }): void {
		this.carriedBy = { dx: offset.dx, dy: offset.dy };
		this.carriedCount = paths.length;
		if (!this.page) return;
		this.page.carry(JSON.stringify(paths), offset.dx, offset.dy);
		if (paths.length) {
			if (this.shown === undefined) {
				this.boardsOnly = true;
				clearTimeout(this.boardsLanding);
			}
			this.lift(this.page.setPreview(this.shown ?? "[]"));
			this.laidOut(this.shown === undefined || this.moveOnly);
		} else if (this.boardsOnly && this.shown === undefined) {
			clearTimeout(this.boardsLanding);
			this.boardsLanding = setTimeout(() => this.landBoards(), 2000);
		}
		this.draw();
	}
	/** The preview a gesture on drawn items is showing, as sent to the engine; undefined when none. */
	private shown: string | undefined;
	private carriedCount = 0;
	/** A drag of boards alone is showing its arrows, or has let go and waits for the drawing. */
	private boardsOnly = false;
	private boardsLanding: ReturnType<typeof setTimeout> | undefined;
	private landBoards(): void {
		clearTimeout(this.boardsLanding);
		if (!this.boardsOnly) return;
		this.boardsOnly = false;
		if (this.shown !== undefined || !this.page) return;
		this.page.setPreview("null");
		if (this.lifted.size) this.post({ type: "drop", ids: [...this.lifted] });
		this.laidOut();
		this.draw();
	}
	/**
	 * What `setPreview` newly lifted (its answer): the arrows it bent, and a shape's outline resized
	 * with it. The worker leaves them out of its tiles too, and they are put down with the rest.
	 */
	private lift(answer: string): void {
		const bent = JSON.parse(answer) as string[];
		if (!bent.length) return;
		for (const id of bent) this.lifted.add(id);
		this.post({ type: "lift", ids: bent });
	}

	/**
	 * Fetch the pictures of the boards in view (and of live ones kept ready), at the size they are
	 * shown. A board already fetched keeps its copy, unless `sharper` and it is now shown
	 * `SHARPER_AT` times wider than that copy: then the next copy up is fetched, drawn over the old
	 * one when it comes. Never a smaller one: a zoom out keeps the sharp copy it has.
	 */
	private wantBoardPictures(sharper = false): void {
		if (!this.page || !this.view.width) return;
		const dpr = Math.min(2, devicePixelRatio || 1);
		const w = this.view.width / this.camera.zoom;
		const h = this.view.height / this.camera.zoom;
		const left = this.camera.x - w;
		const top = this.camera.y - h;
		// The boards near the window, from the index `setBoards` keeps (built from these boards, in their order).
		const near = this.indexed !== this.boards ? this.boards : this.boardIndex.search({ x: left, y: top, w: w * 2, h: h * 2 }).map((at) => this.boards[at]!);
		for (const board of near) {
			if (!board.picture || (board.live && !board.ready)) continue;
			if (board.x + board.w < left || board.x > left + w * 2 || board.y + board.h < top || board.y > top + h * 2) continue;
			const key = `board:${board.path}`;
			const need = board.w * this.camera.zoom * dpr;
			const sized = /^(https?:|\/)/.test(board.picture);
			const asked = this.picturesAsked.get(key);
			if (asked) {
				// Held at a copy's size, and shown wider than it: the next one up, when the zoom rests.
				if (!sharper || !sized || !asked.size || need <= asked.size * SHARPER_AT || asked.source !== board.picture) continue;
				this.picturesAsked.delete(key);
			}
			const size = sized ? (SMALL.find((one) => one >= need) ?? 0) : 0;
			const url = size ? `${board.picture}${board.picture.includes("?") ? "&" : "?"}w=${size}` : board.picture;
			this.fetchPicture(key, url, true, board.picture, size);
		}
	}

	/** Look for blurred boards (`wantBoardPictures`) once the zoom has stopped changing for `SHARPER_AFTER_MS`, and the camera moving. */
	private sharperSoon(): void {
		clearTimeout(this.sharperTimer);
		this.sharperTimer = setTimeout(() => {
			if (this.disposed) return;
			if (this.moving) return this.sharperSoon();
			this.wantBoardPictures(true);
		}, SHARPER_AFTER_MS);
	}
	private sharperTimer: ReturnType<typeof setTimeout> | undefined;
	/** The zoom the boards' pictures were last looked at for: a new one looks again (`sharperSoon`). */
	private sharperZoom = 0;

	// --- pictures, fonts, icons -----------------------------------------------------------------

	/** Image fills and card pictures by their address, and icons (`icon:<key>`): fetched once for both engines. */
	private wantPictures(urls: readonly string[]): void {
		for (const url of urls) {
			if (url.startsWith("icon:")) this.fetchIcon(url.slice(5));
			else if (!this.picturesAsked.has(url)) {
				this.fetchPicture(url, pictureAddress(url, this.base || location.href), false);
			}
		}
	}

	private fetchPicture(key: string, url: string, board: boolean, source = url, size?: number): void {
		const asked = this.picturesAsked.get(key) ?? { url, source, tries: 0, size };
		this.picturesAsked.set(key, asked);
		if (this.fetching >= FETCHES) {
			setTimeout(() => {
				if (this.picturesAsked.get(key) === asked) this.picturesAsked.delete(key);
				this.wantBoardPictures();
			}, 200);
			return;
		}
		this.fetching++;
		void fetch(url, { credentials: "same-origin" })
			.then(async (response) => {
				if (!response.ok) throw new Error(String(response.status));
				const standIn = response.headers.get("X-Decks-Stand-In") === "1";
				const blob = await response.blob();
				const { bitmap: forPage, width, height } = await this.picture(blob);
				// Asked again since (a sharper copy, an engine started again): this one is not wanted.
				if (this.disposed || !this.page || this.picturesAsked.get(key) !== asked) return forPage.close();
				this.page.putPicture(key, forPage, width, height);
				this.picturesPut++;
				// A board's picture is drawn by the page alone; an image fill by the worker's tiles too.
				if (!board) {
					const { bitmap: forWorker } = await this.picture(blob);
					this.post({ type: "picture", url: key, bitmap: forWorker, width, height }, [forWorker]);
					this.laidOut();
				}
				if (standIn && asked.tries++ < STAND_IN_TRIES) setTimeout(() => this.fetchPicture(key, url, board, asked.source, asked.size), STAND_IN_RETRY_MS);
				this.draw();
			})
			.catch(() => {
				// Not reachable now (a shot that failed, the network): drawn without it, as an empty place,
				// and asked again later, a little longer each time, while nothing newer has been asked for.
				const wait = PICTURE_RETRY_MS[asked.failed ?? 0];
				if (wait === undefined) return;
				asked.failed = (asked.failed ?? 0) + 1;
				setTimeout(() => {
					if (!this.disposed && this.picturesAsked.get(key) === asked) this.fetchPicture(key, url, board, asked.source, asked.size);
				}, wait);
			})
			.finally(() => {
				this.fetching--;
			});
	}

	/**
	 * A picture's bitmap, premultiplied, no bigger across than the device keeps one, and its own size
	 * (`width` × `height`, which lays it out).
	 */
	private async picture(blob: Blob): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
		const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "premultiply" });
		const { width, height } = bitmap;
		const fit = Math.min(1, this.maxPicture / Math.max(width, height, 1));
		if (fit >= 1) return { bitmap, width, height };
		const resizeWidth = Math.max(1, Math.floor(width * fit));
		const resizeHeight = Math.max(1, Math.floor(height * fit));
		// From the file again, not from `bitmap`: WebKit's WebGL takes a bitmap made from a bitmap as
		// straight and premultiplies it a second time (every partly clear pixel too dark).
		bitmap.close();
		const smaller = await createImageBitmap(blob, { premultiplyAlpha: "premultiply", resizeWidth, resizeHeight, resizeQuality: "high" });
		return { bitmap: smaller, width, height };
	}

	private fetchIcon(key: string): void {
		if (this.iconsAsked.has(key)) return;
		this.iconsAsked.add(key);
		const [library = "lucide", name = "", weight = "400"] = key.split("|");
		const url = iconUrl(library, name, Number(weight));
		if (!url) return;
		void fetch(url)
			.then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
			.then((svg) => {
				const shape = parseIcon(svg, Number(weight));
				if (!shape || !this.page) return;
				const json = JSON.stringify(shape);
				this.page.putIcon(key, json);
				this.post({ type: "icon", key, shape: json });
				this.draw();
			})
			.catch(() => {
				/* An icon that does not load is not drawn. */
			});
	}

	/** Fetch the font files the stage's words need (`font-files.ts`), and hand each to both engines in the chain's order. */
	private needFonts(): void {
		if (!this.page) return;
		const needs = JSON.parse(this.page.fontNeeds()) as FontNeed[];
		const files = fontFiles(needs).filter((file) => !this.fontsAsked.has(file.key));
		if (!files.length) return;
		for (const file of files) this.fontsAsked.add(file.key);
		this.fontsPending += files.length;
		void Promise.all(
			files.map(async (file) => {
				for (const url of [file.url, file.fallback].filter(Boolean) as string[]) {
					try {
						const response = await fetch(url);
						if (response.ok) return { file, bytes: new Uint8Array(await response.arrayBuffer()) };
					} catch {
						/* the next address */
					}
				}
				return undefined;
			}),
		).then((loaded) => {
			this.fontsPending -= files.length;
			// Kept first: an engine started again after a lost device is given them from here.
			const fonts = loaded.filter((one) => one !== undefined).map((one) => ({ family: one.file.family, bytes: one.bytes, fallback: isFallbackFamily(one.file.family) }));
			this.fonts.push(...fonts);
			if (!this.page) return;
			// In the order the chain lists them, so fallbacks are tried in the app's order.
			for (const { family, bytes, fallback } of fonts) {
				this.page.addFont(family, bytes, fallback);
				this.post({ type: "font", name: family, bytes, fallback });
			}
			this.laidOut();
			this.draw();
		});
	}

	// --- gestures --------------------------------------------------------------------------------

	/**
	 * Items a gesture is moving or reshaping: lifted out of the worker's tiles and drawn here each
	 * frame, moved and with the fields shown, until the gesture ends (`undefined`) and the saved
	 * drawing has been painted into the tiles again.
	 */
	preview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		// A gesture's own preview ends a glide still in hand: what it shows is where things are now.
		if (this.glide) {
			cancelAnimationFrame(this.glide.frame);
			this.glide = undefined;
			this.onGlide?.(undefined);
		}
		this.showPreview(moving);
	}

	private showPreview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		if (!this.page) return;
		// Only moved: nothing the stage reads of the layout changes but the arrows bent, so it is told at the end.
		this.moveOnly = !!moving?.size && [...moving.values()].every((one) => one.w === undefined && one.h === undefined && one.radius === undefined && (!one.set || Object.keys(one.set).length === 0));
		if (moving?.size) {
			const fresh = [...moving.keys()].filter((id) => !this.lifted.has(id));
			if (fresh.length) {
				for (const id of fresh) this.lifted.add(id);
				this.page.lift(JSON.stringify(fresh));
				this.post({ type: "lift", ids: fresh });
			}
			const first = moving.values().next().value;
			this.offset = { dx: first?.dx ?? 0, dy: first?.dy ?? 0 };
			// The arrows joined to what moves bend with it, routed by the page's engine: lifted out of the tiles too.
			this.shown = JSON.stringify(this.withOutlines(moving));
			this.boardsOnly = false;
			this.settling = false;
			this.lift(this.page.setPreview(this.shown));
		} else {
			this.shown = undefined;
			this.boardsOnly = false;
			this.page.setPreview("null");
			this.offset = { dx: 0, dy: 0 };
			if (this.lifted.size) this.post({ type: "drop", ids: [...this.lifted] });
		}
		this.laidOut(this.moveOnly);
		this.draw();
	}
	/** The gesture shown only moves what it carries (`showPreview`). */
	private moveOnly = false;

	/**
	 * A library shape being resized or rounded shows its outline as the saved drawing will have it
	 * (`fitShapes`): sized to the shape, and built at that size by its kind (`build`) so a curve stays
	 * a circle, rather than left at its old size. Its radius is the shape's own, not a frame corner.
	 */
	private withOutlines(moving: ReadonlyMap<string, PenPreview>): Array<[string, PenPreview]> {
		const list = [...moving];
		if (!this.doc) return list;
		for (const [at, [id, change]] of list.entries()) {
			if (change.w === undefined && change.h === undefined && change.radius === undefined) continue;
			const node = docIndex(this.doc).get(id)?.node;
			const outline = node && isShape(node) ? shapeOutline(node) : undefined;
			if (!node || !outline) continue;
			const w = change.w ?? node.width;
			const h = change.h ?? node.height;
			if (typeof w !== "number" || typeof h !== "number") continue;
			const set: Record<string, unknown> = { x: 0, y: 0, width: w, height: h };
			const build = shapeKind(node.metadata?.kind)?.build;
			if (build) {
				const metadata = change.radius === undefined ? node.metadata : ({ ...node.metadata, radius: change.radius ?? undefined } as PenNode["metadata"]);
				set.geometry = build(w, h, shapeRadius({ ...node, width: w, height: h, metadata }) ?? 0);
				set.viewBox = [0, 0, w, h];
			}
			if (change.radius !== undefined) {
				const { radius: _, ...rest } = change;
				list[at] = [id, rest];
			}
			list.push([outline.id, { dx: 0, dy: 0, set }]);
		}
		return list;
	}

	/** Strokes to draw over everything until they are in the drawing, at the next frame however often they change. */
	ink(strokes: readonly LiveInk[], _warm?: boolean): void {
		sheetStats().ink = strokes.length;
		this.page?.setInk(JSON.stringify(strokes));
		this.drawSoon();
	}

	hide(ids: ReadonlySet<string> | undefined): void {
		this.viewState.hidden = [...(ids ?? [])];
		this.sendView();
	}

	muteText(ids: ReadonlySet<string> | undefined): void {
		this.viewState.mute = [...(ids ?? [])];
		this.sendView();
	}

	holes(ids: ReadonlySet<string>): void {
		this.viewState.holes = [...ids];
		this.sendView();
	}

	/**
	 * A picture of what a drag carries, for the ghost a drag over a card shows (`Stage.tsx`): the lifted
	 * items drawn alone for one frame and copied off the canvas in the same task, then the stage drawn
	 * whole again. `rect` is where they lay on screen before the drag; they are now the drag's offset on.
	 */
	cutFromCarried(rect: { left: number; top: number; width: number; height: number }): HTMLCanvasElement | undefined {
		const canvas = this.over;
		if (!this.page || !canvas || !this.lifted.size || rect.width < 1 || rect.height < 1) return undefined;
		const drawn = this.drawRect();
		this.page.frameLifted(drawn.x, drawn.y, drawn.zoom, Math.min(2, devicePixelRatio || 1), drawn.width, drawn.height);
		this.drawnAt = { x: drawn.x, y: drawn.y, zoom: drawn.zoom };
		this.place();
		// Measured once placed: the canvas may have been slid from where it now is.
		const at = canvas.getBoundingClientRect();
		if (!at.width || !at.height) {
			this.draw();
			return undefined;
		}
		const sx = canvas.width / at.width;
		const sy = canvas.height / at.height;
		const left = rect.left + this.offset.dx * this.camera.zoom - at.left;
		const top = rect.top + this.offset.dy * this.camera.zoom - at.top;
		const out = document.createElement("canvas");
		out.width = Math.max(1, Math.round(rect.width * sx));
		out.height = Math.max(1, Math.round(rect.height * sy));
		out.getContext("2d")?.drawImage(canvas, left * sx, top * sy, rect.width * sx, rect.height * sy, 0, 0, out.width, out.height);
		this.draw();
		return out;
	}
	/** The lifted items drawn or not, while a ghost of them stands in. */
	showCarriedLayer(on: boolean): void {
		this.page?.showLifted(on);
		this.draw();
	}
	/** How far the drag has moved what it carries. */
	private offset = { dx: 0, dy: 0 };
	/** The old sheet's tile hand-off, which this engine does not use. */
	setTiles(_sink: unknown): void {}
	forgetTile(_key: string): void {}
	attach(_sheet: HTMLCanvasElement): void {}

	/** The SVG of invisible shapes that take a press on a drawn item from the board page under it. */
	attachHits(svg: SVGSVGElement): void {
		this.hits = svg;
		this.writeHits();
	}

	/** `placed` as a list, and an index of what each covers, made when first asked for after a change. */
	private placedList: Placed[] | undefined;
	private placedIndex: BoxIndex | undefined;
	private list(): Placed[] {
		return (this.placedList ??= [...this.placed.values()]);
	}
	private index(): BoxIndex {
		return (this.placedIndex ??= new BoxIndex(this.list().map((one) => this.bounds.get(one.node.id) ?? one.box)));
	}

	/** The window on the stage, grown by `more` windows on each side. */
	private windowRect(more: number): Rect {
		const { x, y, zoom } = this.camera;
		const w = this.view.width / zoom;
		const h = this.view.height / zoom;
		return { x: x - w / 2 - more * w, y: y - h / 2 - more * h, w: w * (1 + 2 * more), h: h * (1 + 2 * more) };
	}

	/**
	 * One invisible shape per drawn item over a board, near the window: a press on it is the drawing's,
	 * and one beside it reaches the board. On bare canvas the stage has the press and the editor's pick (`editor/core/pick.ts`) answers.
	 */
	private writeHits(): void {
		const svg = this.hits;
		if (!svg) return;
		const NS = "http://www.w3.org/2000/svg";
		const band = (2 * BAND_PX) / this.camera.zoom;
		this.bandZoom = this.camera.zoom;
		const shapes: SVGElement[] = [];
		const reach = this.view.width > 0 ? this.windowRect(1) : undefined;
		this.hitWindow = reach;
		const list = this.list();
		const near = reach ? this.index().search(reach).map((at) => list[at]!) : list;
		for (const placed of near) {
			const { node, box } = placed;
			if (node.type === "group" || isShape(node) || (node.type === "browser" && node.metadata?.type === "decks.board")) continue;
			let top = placed;
			while (top.parent) top = this.placed.get(top.parent) ?? top;
			if (top.parent) continue;
			const bounds = this.bounds.get(node.id) ?? box;
			if (this.boardIndex.search(bounds).length === 0) continue;
			let shape: SVGElement;
			if (node.type === "ellipse") {
				shape = document.createElementNS(NS, "ellipse");
				shape.setAttribute("cx", String(box.x + box.w / 2));
				shape.setAttribute("cy", String(box.y + box.h / 2));
				shape.setAttribute("rx", String(box.w / 2));
				shape.setAttribute("ry", String(box.h / 2));
			} else if (node.type === "path" && typeof node.geometry === "string") {
				const b = node.viewBox ?? (() => {
					const p = pathBounds(node.geometry as string);
					return p ? ([p.x, p.y, p.w, p.h] as const) : undefined;
				})();
				if (!b || b[2] <= 0 || b[3] <= 0) continue;
				shape = document.createElementNS(NS, "path");
				shape.setAttribute("d", node.geometry);
				shape.setAttribute("transform", `translate(${box.x} ${box.y}) scale(${box.w / b[2]} ${box.h / b[3]}) translate(${-b[0]} ${-b[1]})`);
				shape.setAttribute("stroke-width", String(Math.max(band, typeof node.strokeWidth === "number" ? node.strokeWidth : 0)));
				shape.setAttribute("vector-effect", "non-scaling-stroke");
				shape.style.pointerEvents = node.fill !== undefined && node.fill !== null ? "all" : "stroke";
			} else {
				shape = document.createElementNS(NS, "rect");
				shape.setAttribute("x", String(bounds.x));
				shape.setAttribute("y", String(bounds.y));
				shape.setAttribute("width", String(Math.max(0, bounds.w)));
				shape.setAttribute("height", String(Math.max(0, bounds.h)));
			}
			shape.setAttribute("class", "pen-hit");
			shape.setAttribute("fill", "none");
			shape.setAttribute("stroke", "none");
			shape.dataset.id = node.id;
			shapes.push(shape);
		}
		svg.replaceChildren(...shapes);
	}

	private sendView(): void {
		this.viewState.scrolls = Object.fromEntries(this.scrolls);
		const key = JSON.stringify(this.viewState);
		if (key === this.viewKey) return;
		this.viewKey = key;
		this.page?.setView(key);
		this.post({ type: "view", view: key });
		this.draw();
	}

	/** Tiles the page holds: none until the worker's first ones arrive. */
	tileCount(): number {
		return this.page?.tileCount() ?? 0;
	}

	/** A mark for what has been sent so far: `shows(mark)` once a frame painted after all of it is on screen. */
	mark(): number {
		return this.sent;
	}
	shows(mark: number): boolean {
		return this.shownSeen >= mark;
	}

	// --- questions ------------------------------------------------------------------------------

	/** Whether a stage point is on what a path draws: its line with the press's reach, or inside its fill. */
	private onPath(placed: Placed, point: { x: number; y: number }): boolean | undefined {
		const { node } = placed;
		if (typeof node.geometry !== "string" || !node.geometry) return undefined;
		const vb = node.viewBox ?? (() => {
			const b = pathBounds(node.geometry as string);
			return b ? ([b.x, b.y, b.w, b.h] as const) : undefined;
		})();
		if (!vb || vb[2] <= 0 || vb[3] <= 0) return undefined;
		const ctx = (this.penHit ??= document.createElement("canvas").getContext("2d") ?? undefined);
		if (!ctx) return undefined;
		const path = new Path2D(node.geometry);
		const box = placed.box;
		const sx = box.w / vb[2];
		const sy = box.h / vb[3];
		if (!(sx > 0) || !(sy > 0)) return undefined;
		const px = (point.x - box.x) / sx + vb[0];
		const py = (point.y - box.y) / sy + vb[1];
		const drawn = typeof node.strokeWidth === "number" ? node.strokeWidth : 0;
		ctx.lineWidth = Math.max(drawn, (2 * BAND_PX) / this.camera.zoom) / Math.max(sx, sy);
		const filled = node.fill !== undefined && node.fill !== null;
		return ctx.isPointInStroke(path, px, py) || (filled && ctx.isPointInPath(path, px, py));
	}

	/**
	 * Every item under a stage point, topmost first, with a press's reach round each so a thin line
	 * can be hit: raw geometry, unfiltered. Which of them a press means is the editor's
	 * (`canvas/editor/core/pick.ts`). Boards' own items are among them; nothing before a page.
	 */
	pickAll(point: { x: number; y: number }): string[] {
		if (!this.page) return [];
		return JSON.parse(this.page.pickAll(point.x, point.y, (2 * BAND_PX) / this.camera.zoom)) as string[];
	}

	/** Whether a stage point is on what a path item draws (`onPath`); `undefined` for an item not placed or with no geometry. */
	onLine(id: string, point: { x: number; y: number }): boolean | undefined {
		const placed = this.placed.get(id);
		return placed ? this.onPath(placed, point) : undefined;
	}

	private cardAt(point: { x: number; y: number }) {
		let found: CardGeometry | undefined;
		for (const card of this.cards()) {
			const { box } = card;
			if (this.viewState.hidden.includes(card.id) || (found && card.order < found.order)) continue;
			if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			found = card;
		}
		return found ? { card: found, x: point.x - found.box.x - found.pad, y: point.y - found.box.y - found.pad } : undefined;
	}

	/** The link under a stage point, in a markdown card. */
	linkAt(point: { x: number; y: number }): string | undefined {
		const found = this.cardAt(point);
		if (!found) return undefined;
		const { card, x, y } = found;
		return card.links.find((l) => {
			let lx = l.x;
			if (l.scroller !== null && l.scroller !== undefined) {
				const view = card.scrollers[l.scroller];
				if (!view || x < view.x || x > view.x + view.w) return false;
				lx -= this.scrolls.get(`${card.id}:${l.scroller}`) ?? 0;
			}
			return x >= lx && x <= lx + l.w && y >= l.y && y <= l.y + l.h;
		})?.href;
	}

	/** Scroll the wide table under a stage point sideways; true when there was one to scroll. */
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
			this.sendView();
		}
		return true;
	}

	snapMove(moving: Box, targets: readonly Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
		return snapMove(moving, targets, threshold);
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.drawFrame);
		this.unwatch?.();
		clearTimeout(this.sharperTimer);
		this.worker?.terminate();
		this.worker = undefined;
		this.page?.free();
		this.page = undefined;
		this.hits?.replaceChildren();
	}
}
