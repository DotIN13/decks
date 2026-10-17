/**
 * The stage drawn by the C++ engine (`@decks/engine`), under the board pages: each board's picture
 * or its paper, and the news outline of a board that has no page to glow.
 *
 * Switched on by `localStorage["decks:stage-engine"] = "on"` (or `?engine=on` once), while it is
 * being built. In that mode the worker's sheet keeps the drawing only, and the boards come here:
 * the engine draws them on a canvas the size of the window, in the same call that moves the board
 * pages (`Stage`'s `writeTransform`), so a picture and its page cannot be a frame apart and nothing
 * is drawn past the edge of the screen. The boards' pages sit over this canvas, which is why a
 * sleeping page has no background of its own here (`canvas.css`, `[data-engine]`).
 *
 * Pictures are fetched at the smallest copy the server keeps that covers the board on screen, as
 * the sheet does (`pen/scene.ts`), decoded off the page's thread by `createImageBitmap`, handed to
 * the graphics card and let go of on the page: a picture lives once, as a texture. Past the budget,
 * the pictures drawn longest ago go first.
 */
import { createEngine, type Engine, type Item } from "@decks/engine";
import type { SceneBoard } from "./pen/layer.ts";
import type { SceneOutput } from "./pen/scene.ts";

type TileMessage = Extract<SceneOutput, { type: "tile" | "tiles-clear" | "tiles-done" }>;
/** Drawing tiles held at most, a megabyte each: about three screens' worth at 2x. */
const MAX_TILES = 96;

/**
 * Whether this browser is using the engine, read once: `?engine=on` uses WebGPU where there is one,
 * `?engine=webgl2` insists on WebGL 2, `?engine=off` goes back to the sheet, and the choice is kept.
 */
export function engineWanted(): boolean {
	return engineChoice() !== "off";
}

export type EngineChoice = "off" | "on" | "webgl2";

/** The choices Settings offers (`settings/Settings.tsx`), with what each does. */
export const ENGINES: ReadonlyArray<{ id: EngineChoice; label: string; note: string }> = [
	{ id: "off", label: "Off", note: "CanvasKit paints the canvas on a worker." },
	{ id: "on", label: "On", note: "The C++ engine, on WebGPU or WebGL 2." },
	{ id: "webgl2", label: "WebGL 2", note: "The C++ engine, always on WebGL 2." },
];

/** Keep a choice for this browser; the canvas is built again to take it (`App.tsx`). */
export function saveEngineChoice(choice: EngineChoice): void {
	try {
		localStorage.setItem("decks:stage-engine", choice);
	} catch {
		// No storage: the choice lasts until the page is loaded again.
	}
}

export function engineChoice(): EngineChoice {
	try {
		const asked = new URLSearchParams(location.search).get("engine");
		if (asked === "on" || asked === "off" || asked === "webgl2") localStorage.setItem("decks:stage-engine", asked);
		const kept = localStorage.getItem("decks:stage-engine");
		return kept === "on" || kept === "webgl2" ? kept : "off";
	} catch {
		return "off";
	}
}

interface Camera {
	x: number;
	y: number;
	zoom: number;
}

/** The copies the server keeps of a whole picture (`SMALL` in `pen/scene.ts`); 0 is the whole one. */
const SMALL = [192, 480];
/** The widths a picture is decoded at (`LEVELS` in `pen/scene.ts`): the smallest that covers the board on screen. */
const LEVELS = [96, 192, 384, 720, 1024, 1440, 2048];
/** Pictures fetched at once. */
const FETCHES = 6;
/** Bytes of pictures on the graphics card, at most: as the sheet's 32M pixels. */
const BUDGET = 128 * 1024 * 1024;
/** A stand-in picture, the server's "not ready yet", is asked for again this often, this many times. */
const STAND_IN_RETRY_MS = 1200;
const STAND_IN_TRIES = 50;

interface Picture {
	url: string;
	/** The copy held, as its `w=` width; 0 for the whole picture. */
	size: number;
	bytes: number;
	fetching: boolean;
	failed: boolean;
	tries: number;
	used: number;
	/** A texture is on the card under the board's name. */
	ready: boolean;
	/** The picture's own proportions, which say how tall the board is in it. */
	w: number;
	h: number;
	/** The file as fetched, kept compressed so a new size is a decode, not a download. */
	blob?: Blob;
	/** Its full width, from the first decode; and the width it is decoded at now. */
	natural: number;
	level: number;
	decoding: boolean;
}

export class EngineStage {
	private engine: Engine | undefined;
	private boards: readonly SceneBoard[] = [];
	private camera: Camera = { x: 0, y: 0, zoom: 1 };
	private view = { width: 0, height: 0 };
	private scheme: "light" | "dark" = "light";
	private moving = false;
	private pictures = new Map<string, Picture>();
	private fetching = 0;
	private frame = 0;
	private disposed = false;
	/** Called with the boards whose picture is on screen, when that changes (`Stage`'s `onSheet`). */
	pictured: ((paths: ReadonlySet<string>) => void) | undefined;
	private picturedNow: ReadonlySet<string> = new Set();
	/** Which backend it is running on, once started: shown in the diagnostics. */
	backend: string | undefined;
	/** The drawing's tiles held on the card, by the worker's key (`pen/scene.ts`, `drawTiles`). */
	private tiles = new Map<string, { level: number; x: number; y: number; size: number; used: number }>();
	/** The level on screen. A new level's tiles are held back until the worker says the view is whole. */
	private tileLevel = 0;
	private tileSettle: ReturnType<typeof setTimeout> | undefined;
	/** Tell the worker a tile was let go of (`PenLayer.forgetTile`). */
	forgetTile: ((key: string) => void) | undefined;
	/** Called when no backend could start: the page goes back to the sheet. */
	failed: (() => void) | undefined;
	/** Tiles that arrived before the engine was ready, shown once it is. */
	private early: TileMessage[] = [];
	/** Each board's items as laid out, where the board is, so a drag can move them without laying out every board. */
	private boardItems = new Map<string, Array<[string, Item]>>();
	/** The boards a drag carries, and how far: drawn that far from where they are until it lets go (`carry`). */
	private carried: { paths: ReadonlySet<string>; dx: number; dy: number } = { paths: new Set(), dx: 0, dy: 0 };

	constructor(under: HTMLCanvasElement, over: HTMLCanvasElement) {
		void createEngine({ under, over, ...(engineChoice() === "webgl2" ? { prefer: "webgl2" as const } : {}) }).then((engine) => {
			if (!engine || this.disposed) {
				engine?.dispose();
				if (!engine && !this.disposed) {
					for (const message of this.early.splice(0)) if (message.type === "tile") message.bitmap?.close();
					this.failed?.();
				}
				return;
			}
			this.engine = engine;
			this.backend = engine.backend;
			(globalThis as { __decksEngine?: EngineStage }).__decksEngine = this;
			this.setView(this.view);
			this.layout();
			for (const message of this.early.splice(0)) this.tile(message);
			this.draw();
			/*
			 * And the pictures of the boards already here. Everything that asks for them (`setBoards`,
			 * `setCamera`) came while the engine was starting and did nothing, so a page opened on a
			 * still camera fetched none and drew every board as blank paper until something moved.
			 */
			this.reportPictured();
			this.want();
		}).catch((error: unknown) => {
			console.error(`stage engine: could not start (${String((error as Error)?.message ?? error)}); the sheet draws instead`);
			if (this.disposed) return;
			for (const message of this.early.splice(0)) if (message.type === "tile") message.bitmap?.close();
			this.failed?.();
		});
	}

	/**
	 * A tile of the drawing from the worker, onto the layer over the board pages. A tile of the level
	 * on screen shows at once, replacing its old self. After a zoom, the new level's tiles wait unseen
	 * until the worker says every one in view is sent (`tiles-done`), then replace the old level in one
	 * frame: two levels drawn at once doubled every shadow and soft edge, and shapes went dark.
	 */
	tile(message: TileMessage): void {
		const engine = this.engine;
		if (!engine) {
			if (message.type === "tile" && this.early.length > 256) message.bitmap?.close();
			else this.early.push(message);
			return;
		}
		if (message.type === "tiles-clear") {
			for (const key of this.tiles.keys()) this.dropTile(key, false);
			this.draw();
			return;
		}
		if (message.type === "tiles-done") {
			this.showLevel(message.level);
			return;
		}
		const { key, level, x, y, size, bitmap } = message;
		if (this.tileLevel === 0) this.tileLevel = level;
		if (!bitmap) {
			this.dropTile(key, false);
		} else {
			engine.texture(`tile:${key}`, bitmap, 1, { mipmaps: false });
			bitmap.close();
			this.tiles.set(key, { level, x, y, size, used: this.frame });
			if (level === this.tileLevel) this.placeTile(key);
			this.keepTilesToBudget();
		}
		this.draw();
		// Should the word never come, the new level shows anyway once its tiles stop arriving.
		clearTimeout(this.tileSettle);
		if (level !== this.tileLevel) this.tileSettle = setTimeout(() => this.showLevel(level), 2000);
	}

	private placeTile(key: string): void {
		const one = this.tiles.get(key);
		if (one) this.engine?.set(`tile:${key}`, { layer: 1, order: 1, x: one.x, y: one.y, w: one.size, h: one.size, texture: `tile:${key}`, crisp: true });
	}

	private dropTile(key: string, tell: boolean): void {
		this.engine?.remove(`tile:${key}`);
		this.engine?.forget(`tile:${key}`);
		this.tiles.delete(key);
		if (tell) this.forgetTile?.(key);
	}

	/** The level whose tiles are all in goes on screen, and every other level's tiles go, in one frame. */
	private showLevel(level: number): void {
		clearTimeout(this.tileSettle);
		this.tileSettle = undefined;
		this.tileLevel = level;
		for (const [key, one] of this.tiles) {
			if (one.level === level) this.placeTile(key);
			else this.dropTile(key, true);
		}
		this.draw();
	}

	/**
	 * Past the budget, the tiles furthest from the window go, and the worker hears of each. A tile of the
	 * level on screen that the window touches is never one of them: it would be drawn again at once.
	 */
	private keepTilesToBudget(): void {
		if (this.tiles.size <= MAX_TILES) return;
		const { x, y, zoom } = this.camera;
		const w = this.view.width / zoom / 2;
		const h = this.view.height / zoom / 2;
		const far = [...this.tiles.entries()]
			.filter(([, one]) => !(one.level === this.tileLevel && Math.abs(one.x + one.size / 2 - x) < w + one.size / 2 && Math.abs(one.y + one.size / 2 - y) < h + one.size / 2))
			.map(([key, one]) => ({ key, d: (one.x + one.size / 2 - x) ** 2 + (one.y + one.size / 2 - y) ** 2 }))
			.sort((a, b) => b.d - a.d);
		for (const { key } of far.slice(0, this.tiles.size - MAX_TILES)) this.dropTile(key, true);
	}

	setView(view: { width: number; height: number }): void {
		this.view = view;
		if (!this.engine || view.width === 0) return;
		this.engine.view(view.width, view.height, Math.min(2, window.devicePixelRatio || 1));
		this.engine.camera(this.camera.x, this.camera.y, this.camera.zoom);
		this.draw();
	}

	setScheme(scheme: "light" | "dark"): void {
		if (scheme === this.scheme) return;
		this.scheme = scheme;
		this.layout();
		this.draw();
	}

	/** In the call that moves the board pages, and drawn there, so the two land in one frame. */
	setCamera(camera: Camera): void {
		this.camera = camera;
		if (!this.engine) return;
		this.engine.camera(camera.x, camera.y, camera.zoom);
		this.draw();
		this.reportPictured();
		this.want();
	}

	setMoving(moving: boolean): void {
		if (moving === this.moving) return;
		this.moving = moving;
		// A copy bigger than the one held is fetched once the camera has stopped, as the sheet does.
		if (!moving) this.want();
	}

	setBoards(boards: readonly SceneBoard[]): void {
		this.boards = boards;
		this.layout();
		this.draw();
		this.want();
	}

	/**
	 * Boards being dragged, drawn `dx dy` from where they are until the drag lets go. The stage keeps a
	 * dragged board where it was picked up until then, and the sheet carries the pictures of the ones it
	 * draws; with the engine on, the pictures are the engine's, and without this they stayed behind.
	 */
	carry(paths: readonly string[], offset: { dx: number; dy: number }): void {
		const was = this.carried;
		const next = { paths: new Set(paths), dx: offset.dx, dy: offset.dy };
		const samePaths = was.paths.size === next.paths.size && paths.every((path) => was.paths.has(path));
		if (was.dx === next.dx && was.dy === next.dy && samePaths) return;
		this.carried = next;
		// A live board picked up or put down changes what is drawn of it, its picture or nothing: laid out again.
		if (!samePaths) this.layout();
		else for (const path of next.paths) this.placeBoard(path);
		this.draw();
	}

	/** Called with the live boards whose picture the engine is carrying: their pages wait, unseen (`Stage`). */
	carrying: ((paths: ReadonlySet<string>) => void) | undefined;
	private carryingNow: ReadonlySet<string> = new Set();

	/** One board's items at its place, shifted when a drag carries it. */
	private placeBoard(path: string): void {
		const engine = this.engine;
		const items = this.boardItems.get(path);
		if (!engine || !items) return;
		const shift = this.carried.paths.has(path) ? this.carried : undefined;
		for (const [id, item] of items) engine.set(id, shift ? { ...item, x: item.x + shift.dx, y: item.y + shift.dy } : item);
	}

	/** Every board as the engine's items: its paper, its picture over it, its news outline. */
	private layout(): void {
		const engine = this.engine;
		if (!engine) return;
		engine.clear();
		this.boardItems.clear();
		const carrying = new Set<string>();
		// Clearing took the tiles' items too: they go back as they were.
		for (const [key, one] of this.tiles) if (one.level === this.tileLevel) this.placeTile(key);
		const paper: [number, number, number, number] = this.scheme === "dark" ? [30, 30, 32, 1] : [255, 255, 255, 1];
		let order = 0;
		for (const board of this.boards) {
			const radius = 12;
			const items: Array<[string, Item]> = [];
			const put = (id: string, item: Item) => items.push([id, item]);
			const picture = this.pictures.get(board.path);
			const shown = !!picture?.ready && picture.url === board.picture;
			// A live board being dragged is drawn as its picture, once there is one, and its page waits.
			const carriedLive = board.live && shown && this.carried.paths.has(board.path);
			if (carriedLive) carrying.add(board.path);
			if (!board.live || carriedLive) {
				put(`paper:${board.path}`, { layer: 0, order: order++, x: board.x, y: board.y, w: board.w, h: board.h, color: paper, radius });
				if (shown && picture && picture.w > 0) {
					// The whole board was pictured: a picture taller than the box is cut at its foot, a shorter one ends early.
					const tall = (picture.h / picture.w) * board.w;
					const h = Math.min(board.h, tall);
					put(`picture:${board.path}`, { layer: 0, order: order++, x: board.x, y: board.y, w: board.w, h, texture: board.path, uv: [0, 0, 1, h / tall], radius });
				}
			}
			if (board.glow && board.news) {
				const colour = parseColour(board.news);
				if (colour) put(`news:${board.path}`, { layer: 0, order: order++, x: board.x, y: board.y, w: board.w, h: board.h, color: [colour[0], colour[1], colour[2], 0.6], radius, stroke: 1.5 });
			}
			if (items.length === 0) continue;
			this.boardItems.set(board.path, items);
			this.placeBoard(board.path);
		}
		const was = this.carryingNow;
		if (was.size !== carrying.size || [...carrying].some((path) => !was.has(path))) {
			this.carryingNow = carrying;
			this.carrying?.(carrying);
		}
		this.reportPictured();
	}

	private draw(): void {
		if (!this.engine) return;
		this.frame++;
		this.engine.render();
	}

	/** The boards in view, and each one's picture at the size it is on screen. */
	private inView(): SceneBoard[] {
		const { x, y, zoom } = this.camera;
		const w = this.view.width / zoom;
		const h = this.view.height / zoom;
		const left = x - w / 2 - w / 4;
		const top = y - h / 2 - h / 4;
		const right = x + w / 2 + w / 4;
		const bottom = y + h / 2 + h / 4;
		return this.boards.filter((b) => !(b.x + b.w < left || b.x > right || b.y + b.h < top || b.y > bottom));
	}

	private reportPictured(): void {
		const seen = new Set<string>();
		const { x, y, zoom } = this.camera;
		const w = this.view.width / zoom;
		const h = this.view.height / zoom;
		for (const board of this.boards) {
			if (board.live) continue;
			const picture = this.pictures.get(board.path);
			if (!picture?.ready || picture.url !== board.picture) continue;
			if (board.x + board.w < x - w / 2 || board.x > x + w / 2 || board.y + board.h < y - h / 2 || board.y > y + h / 2) continue;
			seen.add(board.path);
		}
		const was = this.picturedNow;
		if (was.size === seen.size && [...seen].every((path) => was.has(path))) return;
		this.picturedNow = seen;
		this.pictured?.(seen);
	}

	/**
	 * Fetch and decode what the boards in view need: a picture for each that has none, a larger copy
	 * once the camera stops, and a decode at the size the board is on screen, so a board seen small
	 * holds a small texture. A live board is its page: its picture is not fetched at all.
	 */
	private want(): void {
		if (!this.engine || this.disposed) return;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		for (const board of this.inView()) {
			// A live board is its page, and its picture is fetched only when asked to be kept ready, for a drag to carry.
			if (!board.picture || (board.live && !board.ready)) continue;
			let picture = this.pictures.get(board.path);
			if (!picture || picture.url !== board.picture) {
				if (picture?.ready) this.engine.forget(board.path);
				picture = { url: board.picture, size: -1, bytes: 0, fetching: false, failed: false, tries: 0, used: this.frame, ready: false, w: 0, h: 0, natural: 0, level: 0, decoding: false };
				this.pictures.set(board.path, picture);
			}
			picture.used = this.frame;
			if (picture.failed) continue;
			const need = board.w * this.camera.zoom * dpr;
			const size = SMALL.find((one) => one >= need) ?? 0;
			if (!picture.fetching && this.fetching < FETCHES) {
				const bigger = picture.size !== 0 && (size === 0 || size > picture.size);
				if (picture.size === -1 || (bigger && !this.moving)) {
					this.fetch(board.path, picture, size);
					continue;
				}
			}
			if (!picture.blob || picture.decoding) continue;
			const level = Math.min(LEVELS.find((one) => one >= need) ?? LEVELS[LEVELS.length - 1]!, picture.natural || Infinity);
			// A new size only when the camera has stopped; the one held is drawn until then.
			if (!picture.ready || (!this.moving && level !== picture.level)) this.decode(board.path, picture, level);
		}
	}

	private fetch(path: string, picture: Picture, size: number): void {
		// A picture the page took itself is a `blob:` address of one size (`shots/adaptors.ts`).
		if (!/^(https?:|\/)/.test(picture.url)) size = 0;
		picture.fetching = true;
		this.fetching++;
		const url = size ? `${picture.url}${picture.url.includes("?") ? "&" : "?"}w=${size}` : picture.url;
		void fetch(url, { credentials: "same-origin" })
			.then(async (response) => {
				if (!response.ok) throw new Error(String(response.status));
				const standIn = response.headers.get("X-Decks-Stand-In") === "1";
				const blob = await response.blob();
				if (this.disposed || this.pictures.get(path) !== picture) return;
				picture.blob = blob;
				picture.size = size;
				picture.natural = 0;
				picture.level = 0;
				if (standIn) this.askAgain(path, picture, size);
			})
			.catch(() => {
				if (!picture.blob) picture.failed = true;
			})
			.finally(() => {
				picture.fetching = false;
				this.fetching--;
				this.want();
			});
	}

	private decode(path: string, picture: Picture, level: number): void {
		const blob = picture.blob;
		if (!blob) return;
		picture.decoding = true;
		// The first decode is whole, to learn the picture's width; after that, at the size asked.
		const sized = picture.natural ? ({ resizeWidth: level, resizeQuality: "high" } as ImageBitmapOptions) : undefined;
		void createImageBitmap(blob, sized)
			.then((bitmap) => {
				if (this.disposed || this.pictures.get(path) !== picture || !this.engine) {
					bitmap.close();
					return;
				}
				if (!picture.natural) {
					picture.natural = bitmap.width;
					// Decoded whole only to learn its width: decoded again at the size it is shown, unless that is this one.
					if (bitmap.width > level) {
						bitmap.close();
						picture.decoding = false;
						this.decode(path, picture, level);
						return;
					}
				}
				this.engine.texture(path, bitmap, 0);
				picture.bytes = bitmap.width * bitmap.height * 4;
				picture.w = bitmap.width;
				picture.h = bitmap.height;
				picture.level = bitmap.width;
				bitmap.close();
				picture.ready = true;
				this.keepToBudget();
				this.layout();
				this.draw();
			})
			.catch(() => {
				if (!picture.ready) picture.failed = true;
			})
			.finally(() => {
				picture.decoding = false;
			});
	}

	private askAgain(path: string, picture: Picture, size: number): void {
		picture.tries++;
		if (picture.tries > STAND_IN_TRIES) return;
		setTimeout(() => {
			if (this.disposed || this.pictures.get(path) !== picture || picture.fetching) return;
			this.fetch(path, picture, size);
		}, STAND_IN_RETRY_MS);
	}

	private keepToBudget(): void {
		let total = 0;
		for (const one of this.pictures.values()) total += one.ready ? one.bytes : 0;
		if (total <= BUDGET) return;
		const showing = new Set(this.inView().map((b) => b.path));
		const oldest = [...this.pictures.entries()].filter(([path, one]) => one.ready && !showing.has(path)).sort((a, b) => a[1].used - b[1].used);
		for (const [path, one] of oldest) {
			if (total <= BUDGET) break;
			this.engine?.forget(path);
			total -= one.bytes;
			this.pictures.delete(path);
		}
	}

	/** What the diagnostics read: the backend, pictures held, and their bytes. */
	stats(): { backend: string | undefined; pictures: number; bytes: number; items: number; drawn: [number, number]; tiles: number; levels: Record<string, number> } {
		const levels: Record<string, number> = {};
		for (const one of this.tiles.values()) levels[one.level] = (levels[one.level] ?? 0) + 1;
		let bytes = 0;
		let count = 0;
		for (const one of this.pictures.values())
			if (one.ready) {
				bytes += one.bytes;
				count++;
			}
		return { backend: this.backend, pictures: count, bytes, items: this.engine?.stats().items ?? 0, drawn: this.engine?.stats().drawn ?? [0, 0], tiles: this.tiles.size, levels };
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.tileSettle);
		for (const message of this.early.splice(0)) if (message.type === "tile") message.bitmap?.close();
		this.engine?.dispose();
		this.engine = undefined;
	}
}

/** `#rrggbb`, `#rgb` or `rgb(r g b)` as 0 to 255; anything else is not drawn. */
function parseColour(colour: string): [number, number, number] | undefined {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
	if (hex) {
		const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}
	const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(colour.trim());
	return rgb ? [+rgb[1]!, +rgb[2]!, +rgb[3]!] : undefined;
}
