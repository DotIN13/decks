/* tslint:disable */
/* eslint-disable */

/**
 * The pictures every backend must draw alike (`stage_paint::fixtures`), for
 * `apps/web/scripts/stage-backends.ts` to hold to the native goldens (`crates/gpu/goldens/`) under
 * WebGPU and WebGL 2. Not used by the app.
 */
export class Fixtures {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * One of the fonts `list` names, under its family.
     */
    addFont(family: string, bytes: Uint8Array, fallback: boolean): void;
    /**
     * What there is to draw, as JSON: `{"fonts": [[family, file, fallback]], "names": [..],
     * "stages": [..]}` (fonts from `packages/stage/fonts/`, stages from `crates/gpu/fixtures/`).
     */
    static list(): string;
    constructor();
    /**
     * Draw fixture `name` (with `pen`, a `.pen` file's text: that stage, the way the worker tiles
     * it) and lay it on the handle's canvas pixel for pixel, over white. Size the canvas to the
     * picture first: its golden's size. Its `[width, height]`.
     */
    show(handle: GpuHandle, name: string, pen?: string | null): Uint32Array;
}

/**
 * WebGPU or WebGL 2, opened on a canvas: the page's own, or the worker's offscreen one.
 */
export class GpuHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The graphics API it draws with: `"webgpu"` or `"webgl2"`. The worker opens with the page's.
     */
    backend(): string;
    /**
     * The widest and tallest a picture is kept: resize bigger ones before `putPicture`.
     */
    maxPictureSize(): number;
    /**
     * The widest and tallest texture the device allows, in pixels. Pictures are kept no bigger
     * than this or 4096, whichever is less (`maxPictureSize`).
     */
    maxTextureSize(): number;
    /**
     * Samples a pixel it draws with: 4, or 1 on a device short of them or of memory.
     */
    samples(): number;
}

export class PageEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A font file, under the name the app's chains use; `fallback` for the files tried last. The
     * stage is laid out again, unless `later` (a batch of fonts): then once, by `layOut`.
     */
    addFont(name: string, bytes: Uint8Array, fallback: boolean, later?: boolean | null): void;
    /**
     * The server's edits (`stage.pen.delta` `edits`, as JSON).
     */
    applyEdits(edits: string): void;
    /**
     * Apply a batch of changes (JSON); `mine` when this session made it. Returns its generation.
     */
    apply(changes: string, mine: boolean): number;
    /**
     * A number that goes up whenever `pictured` or `carrying` would answer differently.
     */
    boardMarks(): number;
    boards(): string;
    /**
     * An item's box on the stage, `[x, y, w, h]`, or `null`.
     */
    boxOf(id: string): string;
    /**
     * Each markdown card's links and wide tables.
     */
    cards(): string;
    /**
     * Boards a drag carries (`["path", …]`), and how far.
     */
    carry(paths: string, dx: number, dy: number): void;
    /**
     * The live boards a drag carries as their picture, whose pages wait unseen.
     */
    carrying(): string;
    /**
     * Tiles let go of past the budget, `[[scale, x, y], …]`, to tell the worker.
     */
    evict(): string;
    /**
     * The box round everything on the stage, `[x, y, w, h]`.
     */
    extent(): string;
    /**
     * The words and faces of what was laid out again since the last call (all of it the first time), for fonts.
     */
    fontNeedsChanged(): string;
    /**
     * The words and faces on the stage, for fonts.
     */
    fontNeeds(): string;
    /**
     * Forget a board's picture (it changed): asked for again when next drawn.
     */
    forgetPicture(url: string): void;
    /**
     * The worker discarded these tiles, `[[scale, x, y], …]`.
     */
    forgetTiles(keys: string): void;
    /**
     * Draw only the lifted items over the pages, for a ghost to be copied from the canvas in the
     * same task; the next `frame` draws everything again.
     */
    frameLifted(x: number, y: number, zoom: number, dpr: number, width: number, height: number): number;
    /**
     * Draw the screen for a camera, under and over the boards' pages. Call it in the same
     * animation frame that moves the pages. Returns how many draw operations it made.
     * `want`: the scale the worker's latest camera wants its tiles at (`scaleFor`, an `f32`'s bits),
     * shown once they cover the window; 0 for the exact zoom times `dpr`.
     */
    frame(x: number, y: number, zoom: number, dpr: number, width: number, height: number, want: number): number;
    generation(): number;
    /**
     * Whether `wantedPictures` has anything to say: asked before it, so most frames make no JSON.
     */
    hasWanted(): boolean;
    /**
     * The worker's tiles have them again (`["id", …]`): stop drawing them here.
     */
    landed(items: string): void;
    /**
     * Lay the drawing out for the pictures put `later` since the last time; false if there were none.
     */
    layOutPictures(): boolean;
    /**
     * Everything laid out again: after a batch of fonts added `later`.
     */
    layOut(): void;
    /**
     * The layout as it changed since the last call (`Page::layout_changes`): what the page reads after
     * each change instead of `layout` and `cards` whole.
     */
    layoutChanges(): string;
    /**
     * Every item as laid out: `[[id, x, y, w, h, parent, order, theme], …]`.
     */
    layout(): string;
    /**
     * Lift top-level items for a drag (`["id", …]`): drawn here from now on.
     */
    lift(items: string): void;
    lost(): boolean;
    /**
     * Words measured with this stage's own fonts and readers, as `TextMeasure.measure` measures them
     * on the server: for the page to lay out an edit the person made, and route its arrows, ahead of
     * the server's drawing, on the boxes the server will find.
     */
    measure(text: string, style: string, max_width: number, markdown: boolean, align: string): Float64Array;
    /**
     * A new id for an item this session makes.
     */
    newId(): string;
    constructor(text: string, dark: boolean, session: string);
    /**
     * Every item under a stage point, topmost first.
     */
    pickAll(x: number, y: number, slop: number): string;
    pick(x: number, y: number, slop: number): string;
    /**
     * The boards drawn as their picture in the last frame.
     */
    pictured(): string;
    /**
     * An icon's shapes, as `parseIcon` gives them, by the key the engine asked for (after `icon:`).
     */
    putIcon(key: string, json: string): void;
    /**
     * A picture by its address (an image fill's `url`, or `board:<id>`). `width` × `height` is its
     * own size, when the bitmap was made smaller to fit `maxPictureSize`; else the bitmap's.
     * `later`: the drawing is laid out for it by `layOutPictures`, once for a batch, not now.
     */
    putPicture(url: string, bitmap: ImageBitmap, width?: number | null, height?: number | null, later?: boolean | null): void;
    /**
     * A tile's pixels from the worker (`WorkerEngine::paintPixels`), RGBA8 premultiplied, rows
     * `stride` bytes apart, written into the page's own texture for it: what `putTile` does for a
     * picture, at a tenth of its cost to the page's thread under WebKit.
     */
    putTilePixels(scale: number, x: number, y: number, pixels: Uint8Array, stride: number): void;
    /**
     * A tile's picture from the worker, copied into the page's own texture for it.
     */
    putTile(scale: number, x: number, y: number, bitmap: ImageBitmap): void;
    redo(): string;
    /**
     * Every top-level item: `[{ id, type, x, y, w, h }]`, its box as laid out.
     */
    roots(): string;
    /**
     * The stage's boards: `[{ path, x, y, w, h, live, news?, glow? }]`.
     */
    setBoards(boards: string): void;
    /**
     * The colour scheme, dark or not.
     */
    setDark(dark: boolean): void;
    /**
     * The whole drawing (`stage.pen` `doc`, as JSON text).
     */
    setDocument(text: string): void;
    setGpu(handle: GpuHandle): void;
    /**
     * The stroke under the pen, `[{ d, filled, color, size, opacity }]`, in stage units; `[]` ends it.
     */
    setInk(strokes: string): void;
    /**
     * Read cards with the app's own reader: `(source) => JSON of blocks`.
     */
    setMarkdownReader(read: Function): void;
    /**
     * The app's typesetter for `$…$` formulas in words and cards.
     */
    setMath(typeset: Function): void;
    /**
     * A gesture in progress: `[[id, { dx, dy, w?, h?, radius?, set? }], …]`, or `null` when it ends.
     * Returns what it newly lifted (the arrows it bends, a resized shape's outline), as a JSON list, for the worker to lift.
     */
    setPreview(moving: string): string;
    /**
     * What the stage hides, mutes or shows live, and who wrote it: `{ hidden, mute, holes, scrolls, writer? }`.
     */
    setView(view: string): void;
    /**
     * Show the lifted items or not, while a ghost of them stands in.
     */
    showLifted(on: boolean): void;
    /**
     * Show the level wanted at the next frame, whole or not: its tiles stopped coming.
     */
    showWanted(): void;
    /**
     * The scale shown (`Page::shown_scale`), as an `f32`'s bits.
     */
    shownScale(): number;
    /**
     * The picture `url` at its next size down, on the GPU, for a quarter of the memory (`Gpu::shrink`):
     * `[width, height]` of what is held now, or null if it has no smaller size or is not held.
     */
    shrinkPicture(url: string): Uint32Array | undefined;
    /**
     * The document as `.pen` text.
     */
    text(): string;
    tileCount(): number;
    /**
     * `{ changes, generation }` for the batch undone, or `null`.
     */
    undo(): string;
    /**
     * Pictures asked for since the last call, to load: `["url", …]`.
     */
    wantedPictures(): string;
    /**
     * Make now, in idle time before the first gesture, what a zoom or a drag would otherwise make
     * the first time it needs it (`Gpu::warm`): every pipeline the page draws with, the glyph
     * textures (the page draws text only for lifted items and ink), and with `spares` (not on a
     * device short of memory) a window's worth of spare tile textures, which tiles let go of in a
     * zoom go back to and new ones come from, a megabyte each.
     */
    warm(spares: boolean): void;
    within(x: number, y: number, w: number, h: number): string;
}

/**
 * Words measured as the page lays them out, for the server: the same text crate, fonts and
 * markdown reader, so a box an agent reads back from an edit is the box the page draws.
 */
export class TextMeasure {
    free(): void;
    [Symbol.dispose](): void;
    addFont(name: string, bytes: Uint8Array, fallback: boolean): void;
    /**
     * `[w, h]` of words in a style (`{ fontFamily, fontSize, fontWeight, fontStyle, letterSpacing,
     * lineHeight }`), wrapped at `max_width` when it is not negative. A card's markdown (`markdown`)
     * is laid out at that width, aligned by `align`, and its height is the card's.
     */
    measure(text: string, style: string, max_width: number, markdown: boolean, align: string): Float64Array;
    constructor();
    setMarkdownReader(read: Function): void;
    setMath(typeset: Function): void;
}

export class WorkerEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A font file: the stage is laid out again and its tiles painted again at the next paint, once
     * for every font, picture and icon that came before it.
     */
    addFont(name: string, bytes: Uint8Array, fallback: boolean): void;
    /**
     * The server's edits (`stage.pen.delta` `edits`, as JSON).
     */
    applyEdits(edits: string): void;
    /**
     * The page's batch number `generation`; an error asks for the whole document.
     */
    apply(changes: string, generation: number): void;
    /**
     * Stale tiles at other scales the worker let go of since the last call: `[[scale, x, y], …]`.
     */
    discarded(): string;
    dropItems(items: string): void;
    /**
     * The page let go of a tile.
     */
    dropped(scale: number, x: number, y: number): void;
    /**
     * Items put down whose tiles are all painted again: `["id", …]`.
     */
    landed(): string;
    lift(items: string): void;
    /**
     * The device went away (WebGPU's device lost, WebGL's context lost): the page starts again.
     */
    lost(): boolean;
    constructor(text: string, dark: boolean);
    /**
     * The scale of the overview's tiles (`overview_scale`), as an `f32`'s bits; 0 for an empty stage.
     */
    overviewScale(): number;
    /**
     * As `paint`, but each tile is painted into a texture and copied into a buffer to be read:
     * `[{ scale, x, y, buffer, stride }]`, `buffer` a `GPUBuffer` the caller maps for reading
     * (`mapAsync`), copies its bytes out of (RGBA8 premultiplied, rows `stride` bytes apart) and
     * unmaps before the next call, which uses the same buffers again. The page writes the bytes
     * into its texture (`PageEngine::putTilePixels`) rather than copy a picture, which under
     * WebKit costs its thread about 2 ms a tile. Empty on WebGL 2, which has no such buffers here.
     */
    paintPixels(x: number, y: number, zoom: number, dpr: number, width: number, height: number, zooming: boolean, limit: number): Array<any>;
    /**
     * Paint up to `limit` tiles the view needs: `[{ scale, x, y, bitmap }]`, bitmaps to transfer.
     */
    paint(x: number, y: number, zoom: number, dpr: number, width: number, height: number, zooming: boolean, limit: number): Array<any>;
    putIcon(key: string, json: string): void;
    /**
     * As the page's: `width` × `height` is the picture's own size when the bitmap was made smaller.
     * `keep`: the bitmap is left open, to be handed to the page, which copies it too.
     */
    putPicture(url: string, bitmap: ImageBitmap, width?: number | null, height?: number | null, keep?: boolean | null): void;
    reload(text: string, dark: boolean): void;
    /**
     * The tile canvas, `TILE` pixels square, and the GPU opened on it.
     */
    setGpu(handle: GpuHandle, canvas: OffscreenCanvas): void;
    setMarkdownReader(read: Function): void;
    setMath(typeset: Function): void;
    setView(view: string): void;
    static tileSize(): number;
    /**
     * Tiles the window still needs after the last `paint` (`Worker::view_left`), for measures.
     */
    viewLeft(x: number, y: number, zoom: number, dpr: number, width: number, height: number, zooming: boolean): number;
    wantedPictures(): string;
    /**
     * Make now, in idle time, what painting would otherwise make the first time it needs it
     * (`Gpu::warm`): every pipeline, a multisampled tile and a layer tile, the glyph textures, and
     * the tile it paints into to read back (`paintPixels`) where it can.
     */
    warm(): void;
}

/**
 * This engine's compiled `WebAssembly.Module`, which the page posts to its render worker so the
 * worker instantiates it rather than fetch and compile its own copy.
 */
export function engineModule(): any;

/**
 * Any page canvas, as `openStage`.
 */
export function openCanvas(canvas: HTMLCanvasElement, width: number, height: number, backend?: string | null, low_memory?: boolean | null): Promise<GpuHandle>;

/**
 * The worker's tile canvas. Pass the page's `backend()` so both draw with the same API.
 */
export function openOffscreen(canvas: OffscreenCanvas, width: number, height: number, backend?: string | null, low_memory?: boolean | null): Promise<GpuHandle>;

/**
 * The page's canvas, over the boards' pages: the drawing, and the boards' pictures.
 */
export function openStage(canvas: HTMLCanvasElement, width: number, height: number, backend?: string | null, low_memory?: boolean | null): Promise<GpuHandle>;

/**
 * One joined arrow routed by the engine's router (`stage_scene::arrows`), for the server's reroute:
 * its `metadata`, the boxes of what its ends name (`{ name: [x, y, w, h] }`) and its stroke width.
 * Returns the path's fields as JSON, `{ x, y, width, height, geometry }`, or `""` when an end is
 * not among the boxes.
 */
export function routeArrow(metadata: string, ends: string, stroke: number): string;

/**
 * The scale tiles are painted at for a zoom times the screen's density (`tiles::scale_for`), as an
 * `f32`'s bits, so the page knows which tiles the worker's latest camera wants.
 */
export function scaleFor(zoom_times_dpr: number, zooming: boolean): number;

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_fixtures_free: (a: number, b: number) => void;
    readonly __wbg_gpuhandle_free: (a: number, b: number) => void;
    readonly __wbg_pageengine_free: (a: number, b: number) => void;
    readonly __wbg_textmeasure_free: (a: number, b: number) => void;
    readonly __wbg_workerengine_free: (a: number, b: number) => void;
    readonly engineModule: () => any;
    readonly fixtures_addFont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly fixtures_list: () => [number, number];
    readonly fixtures_new: () => number;
    readonly fixtures_show: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly gpuhandle_backend: (a: number) => [number, number];
    readonly gpuhandle_maxPictureSize: (a: number) => number;
    readonly gpuhandle_maxTextureSize: (a: number) => number;
    readonly gpuhandle_samples: (a: number) => number;
    readonly openCanvas: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly openOffscreen: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly openStage: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly pageengine_addFont: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly pageengine_apply: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pageengine_applyEdits: (a: number, b: number, c: number) => [number, number];
    readonly pageengine_boardMarks: (a: number) => number;
    readonly pageengine_boards: (a: number) => [number, number];
    readonly pageengine_boxOf: (a: number, b: number, c: number) => [number, number];
    readonly pageengine_cards: (a: number) => [number, number];
    readonly pageengine_carry: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly pageengine_carrying: (a: number) => [number, number];
    readonly pageengine_evict: (a: number) => [number, number];
    readonly pageengine_extent: (a: number) => [number, number];
    readonly pageengine_fontNeeds: (a: number) => [number, number];
    readonly pageengine_fontNeedsChanged: (a: number) => [number, number];
    readonly pageengine_forgetPicture: (a: number, b: number, c: number) => void;
    readonly pageengine_forgetTiles: (a: number, b: number, c: number) => void;
    readonly pageengine_frame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly pageengine_frameLifted: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly pageengine_generation: (a: number) => number;
    readonly pageengine_hasWanted: (a: number) => number;
    readonly pageengine_landed: (a: number, b: number, c: number) => void;
    readonly pageengine_layOut: (a: number) => void;
    readonly pageengine_layOutPictures: (a: number) => number;
    readonly pageengine_layout: (a: number) => [number, number];
    readonly pageengine_layoutChanges: (a: number) => [number, number];
    readonly pageengine_lift: (a: number, b: number, c: number) => void;
    readonly pageengine_lost: (a: number) => number;
    readonly pageengine_measure: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly pageengine_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly pageengine_newId: (a: number) => [number, number];
    readonly pageengine_pick: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pageengine_pickAll: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pageengine_pictured: (a: number) => [number, number];
    readonly pageengine_putIcon: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly pageengine_putPicture: (a: number, b: number, c: number, d: any, e: number, f: number, g: number) => void;
    readonly pageengine_putTile: (a: number, b: number, c: number, d: number, e: any) => void;
    readonly pageengine_putTilePixels: (a: number, b: number, c: number, d: number, e: any, f: number) => void;
    readonly pageengine_redo: (a: number) => [number, number];
    readonly pageengine_roots: (a: number) => [number, number];
    readonly pageengine_setBoards: (a: number, b: number, c: number) => void;
    readonly pageengine_setDark: (a: number, b: number) => void;
    readonly pageengine_setDocument: (a: number, b: number, c: number) => [number, number];
    readonly pageengine_setGpu: (a: number, b: number) => void;
    readonly pageengine_setInk: (a: number, b: number, c: number) => void;
    readonly pageengine_setMarkdownReader: (a: number, b: any) => void;
    readonly pageengine_setMath: (a: number, b: any) => void;
    readonly pageengine_setPreview: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pageengine_setView: (a: number, b: number, c: number) => void;
    readonly pageengine_showLifted: (a: number, b: number) => void;
    readonly pageengine_showWanted: (a: number) => void;
    readonly pageengine_shownScale: (a: number) => number;
    readonly pageengine_shrinkPicture: (a: number, b: number, c: number) => [number, number];
    readonly pageengine_text: (a: number) => [number, number];
    readonly pageengine_tileCount: (a: number) => number;
    readonly pageengine_undo: (a: number) => [number, number];
    readonly pageengine_wantedPictures: (a: number) => [number, number];
    readonly pageengine_warm: (a: number, b: number) => void;
    readonly pageengine_within: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly routeArrow: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly scaleFor: (a: number, b: number) => number;
    readonly start: () => void;
    readonly textmeasure_addFont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly textmeasure_measure: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly textmeasure_new: () => number;
    readonly textmeasure_setMarkdownReader: (a: number, b: any) => void;
    readonly textmeasure_setMath: (a: number, b: any) => void;
    readonly workerengine_addFont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly workerengine_apply: (a: number, b: number, c: number, d: number) => [number, number];
    readonly workerengine_applyEdits: (a: number, b: number, c: number) => [number, number];
    readonly workerengine_discarded: (a: number) => [number, number];
    readonly workerengine_dropItems: (a: number, b: number, c: number) => void;
    readonly workerengine_dropped: (a: number, b: number, c: number, d: number) => void;
    readonly workerengine_landed: (a: number) => [number, number];
    readonly workerengine_lift: (a: number, b: number, c: number) => void;
    readonly workerengine_lost: (a: number) => number;
    readonly workerengine_new: (a: number, b: number, c: number) => [number, number, number];
    readonly workerengine_overviewScale: (a: number) => number;
    readonly workerengine_paint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly workerengine_paintPixels: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly workerengine_putIcon: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly workerengine_putPicture: (a: number, b: number, c: number, d: any, e: number, f: number, g: number) => void;
    readonly workerengine_reload: (a: number, b: number, c: number, d: number) => [number, number];
    readonly workerengine_setGpu: (a: number, b: number, c: any) => void;
    readonly workerengine_setMarkdownReader: (a: number, b: any) => void;
    readonly workerengine_setMath: (a: number, b: any) => void;
    readonly workerengine_setView: (a: number, b: number, c: number) => void;
    readonly workerengine_tileSize: () => number;
    readonly workerengine_viewLeft: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly workerengine_wantedPictures: (a: number) => [number, number];
    readonly workerengine_warm: (a: number) => void;
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___js_sys_89ffcc1aa63764a9___Function_fn_wasm_bindgen_d9d9da00610227f7___JsValue_____wasm_bindgen_d9d9da00610227f7___sys__Undefined___js_sys_89ffcc1aa63764a9___Function_fn_wasm_bindgen_d9d9da00610227f7___JsValue_____wasm_bindgen_d9d9da00610227f7___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_f9fd8ba721963722___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_f9fd8ba721963722___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true__105: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_f9fd8ba721963722___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true__106: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wgpu_f9fd8ba721963722___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true_: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
