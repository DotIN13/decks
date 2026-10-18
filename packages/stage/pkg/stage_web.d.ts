/* tslint:disable */
/* eslint-disable */

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
     * A font file, under the name the app's chains use; `fallback` for the files tried last.
     */
    addFont(name: string, bytes: Uint8Array, fallback: boolean): void;
    /**
     * The server's edits (`stage.pen.delta` `edits`, as JSON).
     */
    applyEdits(edits: string): void;
    /**
     * Apply a batch of changes (JSON); `mine` when this session made it. Returns its generation.
     */
    apply(changes: string, mine: boolean): number;
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
     */
    frame(x: number, y: number, zoom: number, dpr: number, width: number, height: number, moving: boolean): number;
    generation(): number;
    /**
     * The worker's tiles have them again (`["id", …]`): stop drawing them here.
     */
    landed(items: string): void;
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
     */
    putPicture(url: string, bitmap: ImageBitmap, width?: number | null, height?: number | null): void;
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
     * Returns the arrows it bends that were not lifted before, as a JSON list, for the worker to lift.
     */
    setPreview(moving: string): string;
    /**
     * What the stage hides, mutes or shows live: `{ hidden, mute, holes, scrolls }`.
     */
    setView(view: string): void;
    /**
     * Show the lifted items or not, while a ghost of them stands in.
     */
    showLifted(on: boolean): void;
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
     * Paint up to `limit` tiles the view needs: `[{ scale, x, y, bitmap }]`, bitmaps to transfer.
     */
    paint(x: number, y: number, zoom: number, dpr: number, width: number, height: number, moving: boolean, limit: number): Array<any>;
    putIcon(key: string, json: string): void;
    /**
     * As the page's: `width` × `height` is the picture's own size when the bitmap was made smaller.
     */
    putPicture(url: string, bitmap: ImageBitmap, width?: number | null, height?: number | null): void;
    reload(text: string, dark: boolean): void;
    /**
     * The tile canvas, `TILE` pixels square, and the GPU opened on it.
     */
    setGpu(handle: GpuHandle, canvas: OffscreenCanvas): void;
    setMarkdownReader(read: Function): void;
    setMath(typeset: Function): void;
    setView(view: string): void;
    static tileSize(): number;
    wantedPictures(): string;
}

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

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_gpuhandle_free: (a: number, b: number) => void;
    readonly __wbg_pageengine_free: (a: number, b: number) => void;
    readonly __wbg_textmeasure_free: (a: number, b: number) => void;
    readonly __wbg_workerengine_free: (a: number, b: number) => void;
    readonly gpuhandle_backend: (a: number) => [number, number];
    readonly gpuhandle_maxPictureSize: (a: number) => number;
    readonly gpuhandle_maxTextureSize: (a: number) => number;
    readonly gpuhandle_samples: (a: number) => number;
    readonly openCanvas: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly openOffscreen: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly openStage: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly pageengine_addFont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly pageengine_apply: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pageengine_applyEdits: (a: number, b: number, c: number) => [number, number];
    readonly pageengine_boards: (a: number) => [number, number];
    readonly pageengine_boxOf: (a: number, b: number, c: number) => [number, number];
    readonly pageengine_cards: (a: number) => [number, number];
    readonly pageengine_carry: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly pageengine_carrying: (a: number) => [number, number];
    readonly pageengine_evict: (a: number) => [number, number];
    readonly pageengine_extent: (a: number) => [number, number];
    readonly pageengine_fontNeeds: (a: number) => [number, number];
    readonly pageengine_forgetPicture: (a: number, b: number, c: number) => void;
    readonly pageengine_forgetTiles: (a: number, b: number, c: number) => void;
    readonly pageengine_frame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly pageengine_frameLifted: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly pageengine_generation: (a: number) => number;
    readonly pageengine_landed: (a: number, b: number, c: number) => void;
    readonly pageengine_layout: (a: number) => [number, number];
    readonly pageengine_lift: (a: number, b: number, c: number) => void;
    readonly pageengine_lost: (a: number) => number;
    readonly pageengine_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly pageengine_newId: (a: number) => [number, number];
    readonly pageengine_pick: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pageengine_pickAll: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pageengine_pictured: (a: number) => [number, number];
    readonly pageengine_putIcon: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly pageengine_putPicture: (a: number, b: number, c: number, d: any, e: number, f: number) => void;
    readonly pageengine_putTile: (a: number, b: number, c: number, d: number, e: any) => void;
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
    readonly pageengine_text: (a: number) => [number, number];
    readonly pageengine_tileCount: (a: number) => number;
    readonly pageengine_undo: (a: number) => [number, number];
    readonly pageengine_wantedPictures: (a: number) => [number, number];
    readonly pageengine_within: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly routeArrow: (a: number, b: number, c: number, d: number, e: number) => [number, number];
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
    readonly workerengine_paint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly workerengine_putIcon: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly workerengine_putPicture: (a: number, b: number, c: number, d: any, e: number, f: number) => void;
    readonly workerengine_reload: (a: number, b: number, c: number, d: number) => [number, number];
    readonly workerengine_setGpu: (a: number, b: number, c: any) => void;
    readonly workerengine_setMarkdownReader: (a: number, b: any) => void;
    readonly workerengine_setMath: (a: number, b: any) => void;
    readonly workerengine_setView: (a: number, b: number, c: number) => void;
    readonly workerengine_tileSize: () => number;
    readonly workerengine_wantedPictures: (a: number) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___js_sys_89ffcc1aa63764a9___Function_fn_wasm_bindgen_d9d9da00610227f7___JsValue_____wasm_bindgen_d9d9da00610227f7___sys__Undefined___js_sys_89ffcc1aa63764a9___Function_fn_wasm_bindgen_d9d9da00610227f7___JsValue_____wasm_bindgen_d9d9da00610227f7___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_2572a5db769fe780___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_2572a5db769fe780___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true__83: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_2572a5db769fe780___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true__84: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wgpu_2572a5db769fe780___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true_: (a: number, b: number, c: any) => void;
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
