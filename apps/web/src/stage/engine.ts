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
import init, { PageEngine, openStage } from "@decks/stage";
import { diff, expand, isCard, isMarkdownText, isShape, pathBounds, shapeKind, shapeOutline, shapeRadius, walk, type Frame, type PenDocument, type PenNode, type Placed, type ThemeState } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { fontFiles, isFallbackFamily, type FontNeed } from "../canvas/pen/font-files.ts";
import { iconUrl, parseIcon } from "../canvas/pen/icons.ts";
import { isFile, isLiveFile } from "../canvas/pen/card-frame.ts";
import { snapEdges, snapMove, type Box, type Guide } from "../canvas/pen/snap.ts";
import { boundsOf } from "../canvas/pen/bounds.ts";
import { BoxIndex, type Rect } from "../canvas/spatial.ts";
import { cardReader, mathTypesetter } from "./reader.ts";
import type { CardGeometry, FromWorker, LiveInk, PenHit, PenPreview, SceneBoard, ToWorker } from "./types.ts";

/** How far a press reaches a line, in screen pixels: wider for a finger. */
const BAND_PX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 12 : 8;
/** The copies of a board's picture the server keeps (0 is the whole one), smallest that covers the board on screen. */
const SMALL = [192, 480];
/** Pictures fetched at once, and a stand-in picture asked for again this often, this many times. */
const FETCHES = 6;
const STAND_IN_RETRY_MS = 1200;
const STAND_IN_TRIES = 50;

/** What the stage last did, for checks and the crash recorder to read: the old sheet's counters, and the engine's. */
type SheetStats = Record<string, unknown> & { shown?: number; ink?: number };
const sheetStats = (): SheetStats => ((globalThis as { __decksSheet?: SheetStats }).__decksSheet ??= { shown: 0 });

const EMPTY = '{"version":"2.14","children":[]}';

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
	private boardBoxes = "";
	private size = { w: 0, h: 0 };
	private boards: readonly SceneBoard[] = [];
	private boardKey = "";
	private viewState = { hidden: [] as string[], mute: [] as string[], holes: [] as string[], scrolls: {} as Record<string, number> };
	private viewKey = "";
	private fontsAsked = new Set<string>();
	private picturesAsked = new Map<string, { url: string; tries: number }>();
	private iconsAsked = new Set<string>();
	private fetching = 0;
	private lifted = new Set<string>();
	private sent = 0;
	private shownSeen = 0;
	/** A stage engine that could not start: the stage says so, rather than drawing nothing silently. */
	failed: ((why: string) => void) | undefined;
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

	/** Every item as laid out, by id, with its node; and what each item covers. */
	placed: ReadonlyMap<string, Placed> = new Map();
	bounds: ReadonlyMap<string, Frame> = new Map();
	/** The document the layout was made from. */
	drawnDoc: PenDocument | undefined;
	private cards: CardGeometry[] = [];
	private scrolls = new Map<string, number>();
	private penHit?: CanvasRenderingContext2D;
	/** Not used by this engine: kept so the stage can treat both alike. */
	drewDrawing = true;
	onCarryPending: ((pending: boolean) => void) | undefined;

	/**
	 * The canvas, once the stage has made it: among the board pages, after them. The boards'
	 * pictures, the drawing and what a gesture moves are all drawn on it.
	 */
	attachCanvas(canvas: HTMLCanvasElement): void {
		this.over = canvas;
		if (!this.started) {
			this.started = true;
			void this.start(canvas).catch((error: unknown) => {
				const why = String((error as Error)?.message ?? error);
				console.error(`stage engine: ${why}`);
				this.failed?.(why);
			});
		}
	}
	private started = false;
	private lastOps = 0;

	private async start(over: HTMLCanvasElement): Promise<void> {
		await init();
		this.fitCanvases();
		const gpu = await openStage(over, over.width, over.height);
		if (this.disposed) return;
		const doc = this.doc ? JSON.stringify(this.doc) : EMPTY;
		(globalThis as { __decksRust?: unknown }).__decksRust = this;
		const self = this;
		(globalThis as { __decksEngine?: unknown }).__decksEngine = {
			stats: () => ({ tiles: this.page?.tileCount() ?? 0, drawn: [this.lastOps, this.lastOps], engine: "rust" }),
			/** The boards a drag carries as their picture, and by how far. */
			get carried() {
				return { paths: new Set(JSON.parse(self.page?.carrying() ?? "[]") as string[]), ...self.carriedBy };
			},
		};
		this.page = new PageEngine(doc, this.scheme === "dark", `s${Math.random().toString(36).slice(2, 7)}`);
		this.page.setGpu(gpu);
		this.page.setMarkdownReader(cardReader(this.scheme));
		this.page.setMath(mathTypesetter());
		this.worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
		this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.receive(data);
		this.post({ type: "init", doc, dark: this.scheme === "dark" });
		this.boardKey = "";
		this.setBoards(this.boards);
		this.laidOut();
		this.needFonts();
		this.draw();
	}

	private post(message: ToWorker, transfer: Transferable[] = []): void {
		this.worker?.postMessage(message, transfer);
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
				{
					const gone = JSON.parse(this.page.evict()) as Array<[number, number, number]>;
					if (gone.length) this.post({ type: "dropped", keys: gone });
				}
				this.shownSeen = this.sent;
				this.draw();
				break;
			case "discarded":
				this.page.forgetTiles(JSON.stringify(message.keys));
				this.draw();
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
			case "ready":
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
		this.nodes = undefined;
		this.base = base;
		this.viewState.hidden = [];
		if (!this.page) return;
		/*
		 * A drawing that arrives ends any preview: whatever a drag was showing is now the drawing itself.
		 * The page applies a preview to its own copy and takes it back after, so it is taken back before
		 * the edits rather than over them. Lifted items stay lifted, drawn where the drawing now has them,
		 * until the stage puts the gesture down.
		 */
		this.page.setPreview("null");
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
		this.laidOut();
		this.needFonts();
		this.draw();
	}

	private whole(doc: PenDocument | undefined): void {
		const text = doc ? JSON.stringify(doc) : EMPTY;
		this.page?.setDocument(text);
		this.post({ type: "doc", doc: text, dark: this.scheme === "dark" });
	}

	/** Take in the page engine's layout: every item's box with its node, what it covers, the cards. */
	private laidOut(): void {
		if (!this.page) return;
		const doc = this.doc;
		const nodes = new Map<string, PenNode>();
		if (doc) for (const node of walk(expand(doc))) nodes.set(node.id, node);
		const placed = new Map<string, Placed>();
		for (const [id, x, y, w, h, parent, order, theme] of JSON.parse(this.page.layout()) as Array<[string, number, number, number, number, string | null, number, ThemeState]>) {
			const node = nodes.get(id);
			if (!node) continue;
			placed.set(id, { node, box: { x, y, w, h }, parent: parent ?? undefined, theme, order });
		}
		this.placed = placed;
		this.bounds = boundsOf(placed);
		this.cards = JSON.parse(this.page.cards()) as CardGeometry[];
		this.drawnDoc = doc;
		this.placedList = [...placed.values()];
		this.placedIndex = undefined;
		this.writeHits();
		this.drawn?.();
	}

	setView(view: { width: number; height: number }): void {
		this.view = view;
		this.fitCanvases();
		this.sendCamera();
		this.writeHits();
		this.draw();
	}

	/** Both canvases the window's size, in device pixels; the engine's surfaces follow in `frame`. */
	private fitCanvases(): void {
		const dpr = Math.min(2, devicePixelRatio || 1);
		const w = Math.max(1, Math.round(this.view.width * dpr));
		const h = Math.max(1, Math.round(this.view.height * dpr));
		if (w === this.size.w && h === this.size.h) return;
		this.size = { w, h };
		for (const canvas of [this.over]) {
			if (!canvas) continue;
			canvas.width = w;
			canvas.height = h;
			canvas.style.width = `${this.view.width}px`;
			canvas.style.height = `${this.view.height}px`;
		}
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
		this.draw();
		this.sendCamera();
		this.wantBoardPictures();
		// The click shapes follow the window: written again once it leaves the area they cover.
		const w = this.hitWindow;
		if (w && this.placedList.length) {
			const seen = this.windowRect(0);
			const drifted = this.bandZoom > 0 && (camera.zoom > this.bandZoom * 1.25 || camera.zoom < this.bandZoom * 0.8);
			if (drifted || seen.x < w.x || seen.y < w.y || seen.x + seen.w > w.x + w.w || seen.y + seen.h > w.y + w.h) this.writeHits();
		}
	}

	setMoving(moving: boolean): void {
		if (moving === this.moving) return;
		this.moving = moving;
		this.sendCamera();
		if (!moving) this.wantBoardPictures();
	}

	/** The stage point at the window's top-left, from the camera's centre. */
	private corner(): { x: number; y: number } {
		return { x: this.camera.x - this.view.width / 2 / this.camera.zoom, y: this.camera.y - this.view.height / 2 / this.camera.zoom };
	}

	private sendCamera(): void {
		if (!this.view.width) return;
		const { x, y } = this.corner();
		this.post({ type: "camera", x, y, zoom: this.camera.zoom, dpr: Math.min(2, devicePixelRatio || 1), width: this.view.width, height: this.view.height, moving: this.moving });
	}

	/** Draw both canvases now: always from the call that moved the pages, or when a tile arrives. */
	draw(): void {
		if (!this.page || !this.view.width) return;
		const { x, y } = this.corner();
		const ops = this.page.frame(x, y, this.camera.zoom, Math.min(2, devicePixelRatio || 1), this.view.width, this.view.height, this.moving);
		this.lastOps = ops;
		sheetStats().shown = (sheetStats().shown ?? 0) + 1;
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
		this.wantPictures(JSON.parse(this.page.wantedPictures()) as string[]);
		this.presented?.();
	}

	// --- boards --------------------------------------------------------------------------------

	setBoards(boards: readonly SceneBoard[]): void {
		this.boards = boards;
		const key = JSON.stringify(boards.map((b) => [b.path, b.x, b.y, b.w, b.h, b.live, b.news, b.glow, b.picture]));
		if (key === this.boardKey || !this.page) return;
		this.boardKey = key;
		this.page.setBoards(JSON.stringify(boards.map((b) => ({ path: b.path, x: b.x, y: b.y, w: b.w, h: b.h, live: b.live, news: b.news, glow: b.glow }))));
		const boxes = boards.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join("|");
		if (boxes !== this.boardBoxes) {
			this.boardBoxes = boxes;
			this.boardIndex = new BoxIndex(boards.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })));
			this.writeHits();
		}
		// A board whose picture changed is asked for again.
		for (const board of boards) {
			const asked = this.picturesAsked.get(`board:${board.path}`);
			if (asked && board.picture && asked.url !== board.picture) {
				this.picturesAsked.delete(`board:${board.path}`);
				this.page.forgetPicture(`board:${board.path}`);
			}
		}
		this.wantBoardPictures();
		this.draw();
	}

	private carriedBy = { dx: 0, dy: 0 };
	carry(paths: readonly string[], offset: { dx: number; dy: number }): void {
		this.carriedBy = { dx: offset.dx, dy: offset.dy };
		this.page?.carry(JSON.stringify(paths), offset.dx, offset.dy);
		this.draw();
	}

	/** Fetch the pictures of the boards in view (and of live ones kept ready), at the size they are shown. */
	private wantBoardPictures(): void {
		if (!this.page || !this.view.width) return;
		const dpr = Math.min(2, devicePixelRatio || 1);
		const w = this.view.width / this.camera.zoom;
		const h = this.view.height / this.camera.zoom;
		const left = this.camera.x - w;
		const top = this.camera.y - h;
		for (const board of this.boards) {
			if (!board.picture || (board.live && !board.ready)) continue;
			if (board.x + board.w < left || board.x > left + w * 2 || board.y + board.h < top || board.y > top + h * 2) continue;
			const key = `board:${board.path}`;
			if (this.picturesAsked.has(key)) continue;
			const need = board.w * this.camera.zoom * dpr;
			const size = /^(https?:|\/)/.test(board.picture) ? (SMALL.find((one) => one >= need) ?? 0) : 0;
			const url = size ? `${board.picture}${board.picture.includes("?") ? "&" : "?"}w=${size}` : board.picture;
			this.fetchPicture(key, url, true);
		}
	}

	// --- pictures, fonts, icons -----------------------------------------------------------------

	/** Image fills and card pictures by their address, and icons (`icon:<key>`): fetched once for both engines. */
	private wantPictures(urls: readonly string[]): void {
		for (const url of urls) {
			if (url.startsWith("icon:")) this.fetchIcon(url.slice(5));
			else if (!this.picturesAsked.has(url)) {
				const base = this.base || location.href;
				this.fetchPicture(url, new URL(url, base).href, false);
			}
		}
	}

	private fetchPicture(key: string, url: string, board: boolean): void {
		const asked = this.picturesAsked.get(key) ?? { url, tries: 0 };
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
				const forPage = await createImageBitmap(blob, { premultiplyAlpha: "premultiply" });
				if (this.disposed || !this.page) return forPage.close();
				this.page.putPicture(key, forPage);
				// A board's picture is drawn by the page alone; an image fill by the worker's tiles too.
				if (!board) {
					const forWorker = await createImageBitmap(blob, { premultiplyAlpha: "premultiply" });
					this.post({ type: "picture", url: key, bitmap: forWorker }, [forWorker]);
					this.laidOut();
				}
				if (standIn && asked.tries++ < STAND_IN_TRIES) setTimeout(() => this.fetchPicture(key, url, board), STAND_IN_RETRY_MS);
				this.draw();
			})
			.catch(() => {
				/* Not reachable: drawn without it, as an empty place. */
			})
			.finally(() => {
				this.fetching--;
			});
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
			if (!this.page) return;
			// In the order the chain lists them, so fallbacks are tried in the app's order.
			for (const one of loaded) {
				if (!one) continue;
				const fallback = isFallbackFamily(one.file.family);
				this.page.addFont(one.file.family, one.bytes, fallback);
				this.post({ type: "font", name: one.file.family, bytes: one.bytes, fallback });
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
		if (!this.page) return;
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
			const bent = JSON.parse(this.page.setPreview(JSON.stringify(this.withOutlines(moving)))) as string[];
			if (bent.length) {
				for (const id of bent) this.lifted.add(id);
				this.post({ type: "lift", ids: bent });
			}
		} else {
			this.page.setPreview("null");
			this.offset = { dx: 0, dy: 0 };
			if (this.lifted.size) this.post({ type: "drop", ids: [...this.lifted] });
		}
		this.laidOut();
		this.draw();
	}

	/** The drawing's items by id, made when first asked for after each new drawing. */
	private nodes: Map<string, PenNode> | undefined;

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
			if (!this.nodes) this.nodes = new Map([...walk(this.doc.children)].map((node) => [node.id, node]));
			const node = this.nodes.get(id);
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

	/** The stroke still under the pen, drawn by the page each frame. */
	ink(strokes: readonly LiveInk[], _warm?: boolean): void {
		sheetStats().ink = strokes.length;
		this.page?.setInk(JSON.stringify(strokes));
		this.draw();
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
		const at = canvas.getBoundingClientRect();
		if (!at.width || !at.height) return undefined;
		const { x, y } = this.corner();
		this.page.frameLifted(x, y, this.camera.zoom, Math.min(2, devicePixelRatio || 1), this.view.width, this.view.height);
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

	private placedList: Placed[] = [];
	private placedIndex: BoxIndex | undefined;
	private index(): BoxIndex {
		return (this.placedIndex ??= new BoxIndex(this.placedList.map((one) => this.bounds.get(one.node.id) ?? one.box)));
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
	 * and one beside it reaches the board. On bare canvas the stage has the press and `hitTest` answers.
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
		const near = reach ? this.index().search(reach).map((at) => this.placedList[at]!) : this.placedList;
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
	 * The item under a stage point: the topmost the engine finds there. A press finds the outermost
	 * group round what it hit, the way a design tool selects a group whole; `deep` finds the item
	 * itself. Boards are not found here, and an item inside an instance is found as the instance.
	 */
	hitTest(point: { x: number; y: number }, options?: { deep?: boolean; skip?: (node: PenNode) => boolean }): PenHit | undefined {
		if (!this.page) return undefined;
		let best: Placed | undefined;
		for (const id of JSON.parse(this.page.pickAll(point.x, point.y, (2 * BAND_PX) / this.camera.zoom)) as string[]) {
			const placed = this.placed.get(id);
			if (!placed) continue;
			const { node } = placed;
			if (node.id.includes("/") || node.type === "group") continue;
			if (node.type === "browser" && node.metadata?.type === "decks.board") continue;
			if (options?.skip?.(node)) continue;
			// The reach is for lines: anything else is hit inside what it draws, so of two close shapes the nearer one wins.
			if (node.type === "path") {
				if (this.onPath(placed, point) === false) continue;
			} else {
				const box = this.bounds.get(node.id) ?? placed.box;
				if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			}
			best = placed;
			break;
		}
		if (!best) return undefined;
		if (!options?.deep) {
			for (let up = best.parent ? this.placed.get(best.parent) : undefined; up; up = up.parent ? this.placed.get(up.parent) : undefined) {
				if (up.node.type === "group" || isShape(up.node) || isFile(up.node) || isLiveFile(up.node) || (isCard(up.node) && isMarkdownText(best.node))) best = up;
			}
		}
		return { id: best.node.id, node: best.node, box: { ...(this.bounds.get(best.node.id) ?? best.box) } };
	}

	/** Every item wholly inside a stage rectangle, leaving out any whose parent is picked too: a marquee. */
	within(r: Frame): string[] {
		const inside = new Set<string>();
		for (const [id, placed] of this.placed) {
			const { node } = placed;
			if (id.includes("/") || (node.type === "browser" && node.metadata?.type === "decks.board")) continue;
			if (placed.parent && isShape(this.placed.get(placed.parent)?.node)) continue;
			const box = this.bounds.get(id) ?? placed.box;
			if (box.x >= r.x && box.y >= r.y && box.x + box.w <= r.x + r.w && box.y + box.h <= r.y + r.h) inside.add(id);
		}
		return [...inside].filter((id) => {
			for (let parent = this.placed.get(id)?.parent; parent; parent = this.placed.get(parent)?.parent) if (inside.has(parent)) return false;
			return true;
		});
	}

	private cardAt(point: { x: number; y: number }) {
		let found: CardGeometry | undefined;
		for (const card of this.cards) {
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

	snapEdges(box: { x1: number; y1: number; x2: number; y2: number }, edges: ReadonlyArray<"x1" | "x2" | "y1" | "y2">, targets: readonly Box[], threshold: number) {
		return snapEdges(box, edges, targets, threshold);
	}

	dispose(): void {
		this.disposed = true;
		this.worker?.terminate();
		this.worker = undefined;
		this.page?.free();
		this.page = undefined;
		this.hits?.replaceChildren();
	}
}
