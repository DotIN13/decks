/**
 * The stage's engine, on the page: the Rust page engine (`@decks/stage`) and its render worker.
 *
 * The page engine owns a copy of the drawing, kept on the server's revision by its edits
 * (`stage.pen.delta`), and answers what the stage asks of the drawing: where each item is, what is
 * under a point, what a marquee holds, a card's links. Each frame it draws two canvases in the same
 * call that moves the board pages (`frame`): under them, the boards' pictures; over them, the
 * worker's tiles, then what a gesture is moving and the stroke under the pen, drawn fresh.
 *
 * Fonts, pictures, icons and the markdown reader are the app's own, fetched and handed to both
 * engines once each. The class holds the state; its methods' work is in engine-life.ts,
 * engine-frame.ts, engine-doc.ts, engine-hits.ts and engine-pictures.ts, one story each.
 */
import { knobs } from "../debug.ts";
import type { PageEngine } from "@decks/engine";
import { type Frame, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import type { Camera } from "@decks/protocol-old";
import { fontFiles, textNeeds, type FontFile } from "../look/font-files.ts";
import { Recovery } from "./recovery.ts";
import { snapMove, type Box, type Guide } from "../editor/snap.ts";
import { BoxIndex, type Rect } from "./spatial.ts";
import { type Words } from "./measure.ts";
import { type Shift } from "../camera/glide.ts";
import type { CardGeometry, DocEdits, FromWorker, LiveInk, PenPreview, SceneCard, TileFromWorker, ToWorker } from "./types.ts";
import { type Detected, type StageModule } from "./backends/detect.ts";
import { ENGINE, knownGpuClass, PICTURES } from "./device.ts";

export { pixelsFirst } from "./engine-life.ts";
import * as engineLife from "./engine-life.ts";
import * as engineFrame from "./engine-frame.ts";
import * as engineDoc from "./engine-doc.ts";
import * as engineHits from "./engine-hits.ts";
import * as enginePictures from "./engine-pictures.ts";
/** What a card's picture is held under in both engines: `card:<path>` (`CardPlace` in the Rust engine). */
export const pictureKey = (path: string) => `card:${path}`;

export const EMPTY = '{"version":"2.14","children":[]}';
/** Card pictures copied to the GPU in one frame (`putPaced`). */
const PICTURES_PER_FRAME = 1;

export type Font = { family: string; fallback: boolean; blob: Blob; bytes?: Uint8Array };
/** WebKit (Safari, and every browser on iOS and iPadOS), as `render/device.ts` tells it. */
export function webKit(): boolean {
	return ENGINE === "webkit";
}
/** A card as the engine sends it with its top-level item: its place in that item's tree (`i`) rather than its paint order. */
export type RootCard = Omit<CardGeometry, "order"> & { i: number };
export type RootLaid = { base: number; items: Array<[string, number]>; cards: RootCard[] };
/** How much of the window the sheet reaches past it on each side (`drawRect`): room for a scroll before it is drawn again. */
export const SHEET_MARGIN = 0.25;

/**
 * The stage's drawing for `CanvasView.tsx`, with the same calls the CanvasKit sheet it replaced had
 * so the stage chooses between the two by one setting while this one is proved.
 */
export class StageEngine {
	page: PageEngine | undefined;
	worker: Worker | undefined;
	disposed = false;
	camera: Camera = { x: 0, y: 0, zoom: 1 };
	view = { width: 0, height: 0 };
	scheme: "light" | "dark" = "light";
	moving = false;
	/** The zoom has changed since the camera started moving: tiles are wanted at the power of two under it (`scaleFor`), not the exact scale. */
	zooming = false;
	/** The drawing as both engines hold it, and the address its pictures are relative to. */
	doc: PenDocument | undefined;
	base = "";
	over: HTMLCanvasElement | undefined;
	hits: SVGSVGElement | undefined;
	hitWindow: Rect | undefined;
	bandZoom = 0;
	cardIndex = new BoxIndex([]);
	/** The cards with a node in the DOM (awake, kept, selected, hovered: `items-layer.tsx`): only an item drawn over one of these needs a click shape. */
	nodePaths: ReadonlySet<string> | undefined;
	nodeIndex = new BoxIndex([]);
	/** The boards `cardIndex` answers for, in its order: `boards` when it is up to date with them. */
	indexed: readonly SceneCard[] = [];
	cardBoxes = "";
	size = { w: 0, h: 0 };
	/** The stage rectangle the canvas was last drawn for: the window's, at the camera then. */
	drawnAt: { x: number; y: number; zoom: number } | undefined;
	placedCards: readonly SceneCard[] = [];
	cardKey = "";
	/** The live paths last sent (`setLive`). */
	liveKey = "";
	viewState: { hidden: string[]; mute: string[]; holes: string[]; scrolls: Record<string, number>; writer?: { name?: string; color: string } } = { hidden: [], mute: [], holes: [], scrolls: {} };
	viewKey = "";
	fontsAsked = new Set<string>();
	/**
	 * Pictures fetched, by key: the address fetched (a board's may carry a size), the board's own
	 * address for it, stand-in retries, and for a board's the copy's width (0: the whole picture).
	 */
	picturesAsked = new Map<string, { url: string; source: string; tries: number; size?: number; failed?: number }>();
	/**
	 * The font files fetched, kept for an engine started again as the file (`blob`); `bytes` until
	 * both engines have them, then handed (transferred, not copied) to the worker.
	 */
	fonts: Font[] = [];
	iconsAsked = new Set<string>();
	fetching = 0;
	lifted = new Set<string>();
	sent = 0;
	shownSeen = 0;
	/** Messages posted to the worker that is running now, and that count when the last one that changes what it paints was posted. */
	posted = 0;
	postedContent = 0;
	/** Font files asked for and not yet given to the engines. */
	fontsPending = 0;
	/** Font files settled, by key: given to the engines, or not to be had. */
	fontsSettled = new Set<string>();
	/**
	 * Words measured by the page's engine (`measure.ts`), kept as the server keeps them: by the fonts
	 * there were (`wordsGeneration`, counted up as fonts are given), kind, width, style and words.
	 */
	wordSizes = new Map<string, { w: number; h: number }>();
	wordsGeneration = 0;
	/**
	 * Words measured as the server measures them: the engine's own fonts once every file the words
	 * need has settled, else nothing (the estimate, `measure.ts`), and the files are sent for.
	 */
	readonly words: Words = (text, style, maxWidth, markdown, align) => {
		if (!this.page) return undefined;
		const key = JSON.stringify([this.wordsGeneration, markdown, align, Math.round(maxWidth * 10), style, text]);
		const known = this.wordSizes.get(key);
		if (known) return known;
		const files = fontFiles(textNeeds(text, style, markdown));
		if (files.some((file) => !this.fontsSettled.has(file.key))) {
			this.fetchFonts(files);
			return undefined;
		}
		const [w = 0, h = 0] = this.page.measure(text, JSON.stringify(style), maxWidth, markdown, align);
		if (this.wordSizes.size >= 8192) this.wordSizes.delete(this.wordSizes.keys().next().value!);
		const size = { w, h };
		this.wordSizes.set(key, size);
		return size;
	};
	// What the engine last did, for checks and the crash recorder (`probes.sheet`): `shown` counts the
	// page's draws and `tiles` the worker's tiles that reached it; `sharpAt` is the first draw at rest
	// with nothing left to paint at the resting scale and no font being fetched, and `settledAt` the
	// latest draw with no tile of the window missing or at another scale (`fillAfterPanMs`).
	/** A batch came from a worker with nothing left to paint: the next draw at rest is a sharp one (`sharpAt`). */
	sharpNext = false;
	/** As `sharpNext`, for `settledAt`: the next draw at rest shows the window filled in. */
	settledNext = false;
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
	picturedKey = "";
	carryingKey = "";
	/** The engine's `pageMarks` when `pictured` and `carrying` were last read: read again only when it moves. */
	marksSeen = -1;

	/** Every item as laid out, by id, with its node; and what each item covers. */
	placed: ReadonlyMap<string, Placed> = new Map<string, Placed>();
	bounds: ReadonlyMap<string, Frame> = new Map<string, Frame>();
	/** The document the layout was made from. */
	drawnDoc: PenDocument | undefined;
	scrolls = new Map<string, number>();
	penHit?: CanvasRenderingContext2D;
	/** Not used by this engine: kept so the stage can treat both alike. */
	drewDrawing = true;
	onCarryPending: ((pending: boolean) => void) | undefined;
	/**
	 * Each frame of a drop's glide (`startGlide`): how far each item that glides is still drawn from
	 * where it lands, so the outlines round them ride along; undefined when the glide ends or a new
	 * gesture cancels it.
	 */
	onGlide: ((shifts: ReadonlyMap<string, { dx: number; dy: number }> | undefined) => void) | undefined;
	started = false;
	lastOps = 0;
	/** The graphics API the stage draws with, `"webgpu"` or `"webgl2"`, once open. */
	backend = "";
	/** The worker's, which it opens the page's first. */
	workerBackend = "";
	/** The widest and tallest a picture is kept (the device's limit, or 4096): bigger ones are resized. */
	maxPicture = 4096;
	/**
	 * Card pictures, by this device's GPU (`device.ts`, `readGpuClass`): the ladder each card's is
	 * fetched from, at the rung its drawn width needs (`picture-ladder.ts`), and drawn at any zoom from
	 * the smaller sizes the GPU makes of it. Big until the adapter has been asked.
	 */
	pictures = PICTURES[knownGpuClass()];
	/** What this browser draws with (`backends/detect.ts`), found once. */
	detected: Detected | undefined;
	/** Stops watching for the device to be lost. */
	unwatch: (() => void) | undefined;
	/** The device is gone and nothing is drawn until the engine has started again. */
	paused = false;
	restarting = false;
	/** Times the engine started again after its device was lost (WebGPU) or its context (WebGL 2). */
	restarts = 0;
	/** The pictures put on the page engine, of boards and of fills: for checks. */
	picturesPut = 0;
	/** How often, and how much, the cards have been sent to the page engine (`setCards`): for `awake-bench.mjs`. */
	cardsSent = { calls: 0, bytes: 0 };

	/** Restarts after an engine error, capped (`recovery.ts`). */
	recovery = new Recovery();

	/**
	 * Where what a drop can move was let go (`settle`), and the glide in hand: each item's shift from
	 * where it lands (and, for one that appeared, how much of its transparency is left), and when the
	 * last frame of it was.
	 */
	landing: ReadonlyMap<string, Frame> | undefined;
	glide: { shifts: Map<string, Shift>; last: number; frame: number } | undefined;
	settling = false;
	/** Each top-level item as last laid out: its first paint order, its items with their place in it, its cards. */
	laid = new Map<string, RootLaid>();
	cardList: CardGeometry[] | undefined;
	/** Where the sheet is (`drawRect`); undefined to place it round the camera at the next draw. */
	sheet: { x: number; y: number; zoom: number } | undefined;
	still = false;
	placedAs = "";
	webKit: boolean | undefined;

	/** The editor's overlay as the engine paints it (`editor/core/overlay-json.ts`); the same string again changes nothing. True once the engine has it. */
	overlayJson: string | undefined;
	zoomTrail: Array<[number, number]> = [];
	fastZoom = false;
	fastTimer: ReturnType<typeof setTimeout> | undefined;
	/** The engine's module, for `scaleFor`. */
	stageModule: StageModule | undefined;
	/** The scale the worker's latest camera wants its tiles at (`scaleFor`, an `f32`'s bits), and the overview's (`overviewScale`). */
	wantScale: number | undefined;
	overviewScale = 0;

	/**
	 * The frame's one draw. Cameras, tiles from the worker and every other change only mark the canvas
	 * to be drawn (`draw`); it is drawn once, in the next animation frame's callback (`tick`), which
	 * runs before the browser paints, so the drawing still lands in the same frame as the board pages
	 * the world's transform moved. A pinch's two fingers move the camera twice a frame, a wheel or a
	 * trackpad may too, and tiles come in bursts: each drew the canvas again (2 draws a frame for a
	 * two-event pinch, 1.2 for a wheel zoom).
	 */
	dirty = false;
	/**
	 * A card's picture replacing one the engine held fades in over it (`Page::fade_pictures`, 180 ms),
	 * so a rung swap at rest never pops: a frame is drawn for each step of the fade until none is left.
	 */
	fadeFrame = 0;
	fadeLast = 0;
	/** The pictures the cards near the window want, asked for at the next frame (`setCamera`). */
	picturesSoon = false;
	tickFrame = 0;

	/** Tiles from the worker not yet taken in, oldest first, and what it said with the latest batch. */
	tileQueue: Array<{ key: string; tile: TileFromWorker }> = [];
	tileBatch: { left: number; rest: number; got: number; sent: number } | undefined;
	coarseClock: boolean | undefined;
	takeChannel: MessageChannel | undefined;
	takePosted = false;
	/** What taking tiles in has spent of this frame's share since its draw. */
	frameTaken = { ms: 0, bytes: 0, pictures: 0 };
	warmed = false;
	lowMemory = false;
	showAnyway: ReturnType<typeof setTimeout> | undefined;
	/** What had been sent when the tiles that arrived last were asked for: shown once they are drawn. */
	seenAtDraw = 0;

	carriedBy = { dx: 0, dy: 0 };
	/** The preview a gesture on drawn items is showing, as sent to the engine; undefined when none. */
	shown: string | undefined;
	carriedCount = 0;
	/** The boards the last `carry` names (`probes.engine.carried`). */
	carriedPaths: string[] = [];
	/** A drag of boards alone is showing its arrows, or has let go and waits for the drawing. */
	cardsOnly = false;
	/** A drawing came since the boards were last carried a step: the one that answers their drop, if they are let go of now. */
	cardsAnswered = false;
	cardsLanding: ReturnType<typeof setTimeout> | undefined;

	/** Each card picture on the GPU: its bytes, its smaller sizes included (`fitPictures`). */
	pictureBytes = new Map<string, number>();
	/** Each card picture's width on the GPU, after any shrinking: the rung it holds (`wantCardPictures`). */
	heldWidth = new Map<string, number>();
	/**
	 * Card picture keys that may hold nothing and have nothing asked (`holds` of 0): what a camera step
	 * has to look at. Added to whenever a card's picture state may have fallen to nothing (the cards sent
	 * again, a new revision, a fetch let go, the engine started again), and cleared of a key once a step
	 * finds it holding something: so a step with nothing in it costs nothing, where it searched the index
	 * and sorted the hundred cards near the window at every frame of a zoom (a quarter of the script time
	 * on an iPad), for a list that is empty once every card has a picture.
	 */
	unpictured = new Set<string>();
	/** Each placed card by its picture key, for `unpictured`. */
	cardByKey = new Map<string, SceneCard>();
	/** Card pictures put compressed (`putCompressedPicture`), for checks. */
	compressedPut = 0;
	/** Each compressed card picture's width and height, for checks. */
	compressedSize = new Map<string, [number, number]>();
	fitTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Board pictures waiting to be copied to the GPU, `PICTURES_PER_FRAME` a frame. Copying one is done
	 * on the page's thread (`copyExternalImageToTexture`), about 2 ms on an iPad mini, and a pan below
	 * the live zoom that brought a dozen boards in copied them all in one frame: the top cost of that pan.
	 */
	putQueue: Array<() => void> = [];
	putFrame = 0;
	putSome = (): void => {
		this.putFrame = 0;
		// `knobs.picturesPerFrame` changes it, for measuring.
		const most = knobs.picturesPerFrame ?? PICTURES_PER_FRAME;
		for (let i = 0; i < most && this.putQueue.length > 0; i++) this.putQueue.shift()!();
		if (this.putQueue.length > 0 && !this.disposed) this.putFrame = requestAnimationFrame(this.putSome);
	};
	picturesTimer: ReturnType<typeof setTimeout> | undefined;
	prefetched = false;
	/** The gesture shown only moves what it carries (`showPreview`). */
	moveOnly = false;
	/** How far the drag has moved what it carries. */
	offset = { dx: 0, dy: 0 };

	/** Each page's item on the drawing by the page's path, made when first asked for after a change: what a glide's offset is kept under. */
	pageIds: Map<string, string> | undefined;
	/** `placed` as a list, and an index of what each covers, made when first asked for after a change. */
	placedList: Placed[] | undefined;
	placedIndex: BoxIndex | undefined;

	// Its life: canvases, opening, the worker's messages, losing and restarting (engine-life.ts).
	attachCanvas(canvas: HTMLCanvasElement): void {
		return engineLife.attachCanvas(this, canvas);
	}
	recover(error: unknown, where: string): void {
		return engineLife.recover(this, error, where);
	}
	fail(error: unknown): void {
		return engineLife.fail(this, error);
	}
	async start(over: HTMLCanvasElement): Promise<void> {
		return engineLife.start(this, over);
	}
	async open(over: HTMLCanvasElement): Promise<void> {
		return engineLife.open(this, over);
	}
	lose(): void {
		return engineLife.lose(this);
	}
	async restart(): Promise<void> {
		return engineLife.restart(this);
	}
	tilePixels(on: boolean): void {
		return engineLife.tilePixels(this, on);
	}
	afterMove(ms: number): void {
		return engineLife.afterMove(this, ms);
	}
	post(message: ToWorker, transfer?: Transferable[]): void {
		return engineLife.post(this, message, transfer);
	}
	receive(message: FromWorker): void {
		return engineLife.receive(this, message);
	}
	dispose(): void {
		return engineLife.dispose(this);
	}

	// The drawing, its layout and its cards (engine-doc.ts).
	setDoc(doc: PenDocument | undefined, base: string, edits?: DocEdits, own = false): void {
		return engineDoc.setDoc(this, doc, base, edits, own);
	}
	drawnBoxes(): Map<string, Frame> {
		return engineDoc.drawnBoxes(this);
	}
	laidOut(quiet = false): void {
		return engineDoc.laidOut(this, quiet);
	}
	laidOutWhole(tops: Array<[string, number, number]>, nodes: Map<string, PenNode>, quiet: boolean): void {
		return engineDoc.laidOutWhole(this, tops, nodes, quiet);
	}
	cards(): CardGeometry[] {
		return engineDoc.cards(this);
	}
	setView(view: { width: number; height: number }): void {
		return engineDoc.setView(this, view);
	}
	fitCanvases(): void {
		return engineDoc.fitCanvases(this);
	}
	drawRect(): { x: number; y: number; zoom: number; width: number; height: number } {
		return engineDoc.drawRect(this);
	}
	boxOf(id: string): { x: number; y: number; w: number; h: number; parent?: string | undefined } | undefined {
		return engineDoc.boxOf(this, id);
	}
	setCards(cards: readonly SceneCard[], index?: BoxIndex): void {
		return engineDoc.setCards(this, cards, index);
	}
	carry(paths: readonly string[], offset: { dx: number; dy: number }): void {
		return engineDoc.carry(this, paths, offset);
	}
	landCards(): void {
		return engineDoc.landCards(this);
	}
	lift(answer: string): void {
		return engineDoc.lift(this, answer);
	}
	cutFromCarried(rect: { left: number; top: number; width: number; height: number }): HTMLCanvasElement | undefined {
		return engineDoc.cutFromCarried(this, rect);
	}
	showCarriedLayer(on: boolean): void {
		return engineDoc.showCarriedLayer(this, on);
	}

	// The camera, tiles and drawing a frame (engine-frame.ts).
	startGlide(): boolean {
		return engineFrame.startGlide(this);
	}
	glideFrom(before: Map<string, Frame> | undefined): boolean {
		return engineFrame.glideFrom(this, before);
	}
	beginGlide(shifts: Map<string, Shift>): boolean {
		return engineFrame.beginGlide(this, shifts);
	}
	settle(landing?: ReadonlyMap<string, Frame>): void {
		return engineFrame.settle(this, landing);
	}
	whole(doc: PenDocument | undefined): void {
		return engineFrame.whole(this, doc);
	}
	windowInSheet(): boolean {
		return engineFrame.windowInSheet(this);
	}
	holdStill(on: boolean): void {
		return engineFrame.holdStill(this, on);
	}
	place(): boolean {
		return engineFrame.place(this);
	}
	setScheme(scheme: "light" | "dark"): void {
		return engineFrame.setScheme(this, scheme);
	}
	setCamera(camera: Camera): void {
		return engineFrame.setCamera(this, camera);
	}
	setOverlay(json: string): boolean {
		return engineFrame.setOverlay(this, json);
	}
	setMoving(moving: boolean): void {
		return engineFrame.setMoving(this, moving);
	}
	zoomRate(now: number, zoom: number): number {
		return engineFrame.zoomRate(this, now, zoom);
	}
	corner(): { x: number; y: number } {
		return engineFrame.corner(this);
	}
	sendCamera(): void {
		return engineFrame.sendCamera(this);
	}
	wanted(t: { scale: number }): boolean {
		return engineFrame.wanted(this, t);
	}
	dropUnwanted(): void {
		return engineFrame.dropUnwanted(this);
	}
	fadeSoon(): void {
		return engineFrame.fadeSoon(this);
	}
	tickSoon(): void {
		return engineFrame.tickSoon(this);
	}
	tick(): void {
		return engineFrame.tick(this);
	}
	draw(): void {
		return engineFrame.draw(this);
	}
	flush(): void {
		return engineFrame.flush(this);
	}
	drawSoon(): void {
		return engineFrame.drawSoon(this);
	}
	takeTilesSoon(): void {
		return engineFrame.takeTilesSoon(this);
	}
	takeTiles(): void {
		return engineFrame.takeTiles(this);
	}
	warmSoon(): void {
		return engineFrame.warmSoon(this);
	}
	showAnywaySoon(): void {
		return engineFrame.showAnywaySoon(this);
	}
	dropTileQueue(): void {
		return engineFrame.dropTileQueue(this);
	}
	drawNow(): void {
		return engineFrame.drawNow(this);
	}
	drawUnguarded(): void {
		return engineFrame.drawUnguarded(this);
	}
	endGlide(): void {
		return engineFrame.endGlide(this);
	}
	setTiles(_sink: unknown): void {
		return engineFrame.setTiles(this, _sink);
	}
	forgetTile(_key: string): void {
		return engineFrame.forgetTile(this, _key);
	}
	tileCount(): number {
		return engineFrame.tileCount(this);
	}
	mark(): number {
		return engineFrame.mark(this);
	}
	shows(mark: number): boolean {
		return engineFrame.shows(this, mark);
	}

	// What is under a point, and what the view hides or mutes (engine-hits.ts).
	withOutlines(moving: ReadonlyMap<string, PenPreview>): Array<[string, PenPreview]> {
		return engineHits.withOutlines(this, moving);
	}
	ink(strokes: readonly LiveInk[], _warm?: boolean): void {
		return engineHits.ink(this, strokes, _warm);
	}
	hide(ids: ReadonlySet<string> | undefined): void {
		return engineHits.hide(this, ids);
	}
	muteText(ids: ReadonlySet<string> | undefined): void {
		return engineHits.muteText(this, ids);
	}
	holes(ids: ReadonlySet<string>): void {
		return engineHits.holes(this, ids);
	}
	setWriter(writer: { name?: string; color: string } | undefined): void {
		return engineHits.setWriter(this, writer);
	}
	attach(_sheet: HTMLCanvasElement): void {
		return engineHits.attach(this, _sheet);
	}
	attachHits(svg: SVGSVGElement): void {
		return engineHits.attachHits(this, svg);
	}
	pageIdOf(path: string): string | undefined {
		return engineHits.pageIdOf(this, path);
	}
	list(): Placed[] {
		return engineHits.list(this);
	}
	index(): BoxIndex {
		return engineHits.index(this);
	}
	windowRect(more: number): Rect {
		return engineHits.windowRect(this, more);
	}
	setNodes(paths: ReadonlySet<string>): void {
		return engineHits.setNodes(this, paths);
	}
	indexNodes(): void {
		return engineHits.indexNodes(this);
	}
	writeHits(): void {
		return engineHits.writeHits(this);
	}
	sendView(): void {
		return engineHits.sendView(this);
	}
	onPath(placed: Placed, point: { x: number; y: number }): boolean | undefined {
		return engineHits.onPath(this, placed, point);
	}
	pickAll(point: { x: number; y: number }): string[] {
		return engineHits.pickAll(this, point);
	}
	onLine(id: string, point: { x: number; y: number }): boolean | undefined {
		return engineHits.onLine(this, id, point);
	}
	cardAt(point: { x: number; y: number }) {
		return engineHits.cardAt(this, point);
	}
	linkAt(point: { x: number; y: number }): string | undefined {
		return engineHits.linkAt(this, point);
	}
	scrollBy(point: { x: number; y: number }, dx: number): boolean {
		return engineHits.scrollBy(this, point, dx);
	}

	snapMove(moving: Box, targets: readonly Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
		return snapMove(moving, targets, threshold);
	}

	// Pictures and fonts (engine-pictures.ts).
	wantCardPictures(): void {
		return enginePictures.wantCardPictures(this);
	}
	unpicturedNear(left: number, top: number, w: number, h: number, holds: (key: string) => number): SceneCard[] {
		return enginePictures.unpicturedNear(this, left, top, w, h, holds);
	}
	rungBytes(width: number, card: { w: number; h: number }): number {
		return enginePictures.rungBytes(this, width, card);
	}
	heldBytes(): number {
		return enginePictures.heldBytes(this);
	}
	budgetBytes(): number {
		return enginePictures.budgetBytes(this);
	}
	fitPictures(): void {
		return enginePictures.fitPictures(this);
	}
	fitSoon(): void {
		return enginePictures.fitSoon(this);
	}
	wantPictures(urls: readonly string[]): void {
		return enginePictures.wantPictures(this, urls);
	}
	putPaced(put: () => void): void {
		return enginePictures.putPaced(this, put);
	}
	retryStandIn(key: string, url: string, card: boolean, asked: { source: string; size?: number | undefined }): void {
		return enginePictures.retryStandIn(this, key, url, card, asked);
	}
	fetchPicture(key: string, url: string, card: boolean, source = url, size?: number): void {
		return enginePictures.fetchPicture(this, key, url, card, source, size);
	}
	layOutPicturesSoon(): void {
		return enginePictures.layOutPicturesSoon(this);
	}
	async picture(blob: Blob, wide?: number): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
		return enginePictures.picture(this, blob, wide);
	}
	fetchIcon(key: string): void {
		return enginePictures.fetchIcon(this, key);
	}
	needFonts(): void {
		return enginePictures.needFonts(this);
	}
	prefetchFonts(): void {
		return enginePictures.prefetchFonts(this);
	}
	fetchFonts(wanted: readonly FontFile[]): void {
		return enginePictures.fetchFonts(this, wanted);
	}
	giveFonts(fonts: readonly Font[], show: boolean): void {
		return enginePictures.giveFonts(this, fonts, show);
	}
	postFonts(fonts: readonly Font[]): void {
		return enginePictures.postFonts(this, fonts);
	}
	preview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		return enginePictures.preview(this, moving);
	}
	showPreview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		return enginePictures.showPreview(this, moving);
	}
}
