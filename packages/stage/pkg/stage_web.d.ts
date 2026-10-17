/* tslint:disable */
/* eslint-disable */

/**
 * WebGPU, opened on a canvas: the page's own, or the worker's offscreen one.
 */
export class GpuHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
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
     * A picture by its address (an image fill's `url`, or `board:<id>`).
     */
    putPicture(url: string, bitmap: ImageBitmap): void;
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
     * A gesture in progress: `[[id, { dx, dy, w?, h?, radius?, set? }], …]`, or `null` when it ends.
     */
    setPreview(moving: string): void;
    /**
     * What the stage hides, mutes or shows live: `{ hidden, mute, holes, scrolls }`.
     */
    setView(view: string): void;
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
    constructor(text: string, dark: boolean);
    /**
     * Paint up to `limit` tiles the view needs: `[{ scale, x, y, bitmap }]`, bitmaps to transfer.
     */
    paint(x: number, y: number, zoom: number, dpr: number, width: number, height: number, moving: boolean, limit: number): Array<any>;
    putIcon(key: string, json: string): void;
    putPicture(url: string, bitmap: ImageBitmap): void;
    reload(text: string, dark: boolean): void;
    /**
     * The tile canvas, `TILE` pixels square, and WebGPU opened on it.
     */
    setGpu(handle: GpuHandle, canvas: OffscreenCanvas): void;
    setMarkdownReader(read: Function): void;
    setView(view: string): void;
    static tileSize(): number;
    wantedPictures(): string;
}

export function openCanvas(canvas: HTMLCanvasElement, width: number, height: number): Promise<GpuHandle>;

export function openOffscreen(canvas: OffscreenCanvas, width: number, height: number): Promise<GpuHandle>;

/**
 * The page's two canvases on one device: `over` the boards' pages (the drawing, the screen's first
 * surface) and `under` them (board pictures).
 */
export function openStage(over: HTMLCanvasElement, under: HTMLCanvasElement, width: number, height: number): Promise<GpuHandle>;

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_gpuhandle_free: (a: number, b: number) => void;
    readonly __wbg_pageengine_free: (a: number, b: number) => void;
    readonly __wbg_workerengine_free: (a: number, b: number) => void;
    readonly openCanvas: (a: any, b: number, c: number) => any;
    readonly openOffscreen: (a: any, b: number, c: number) => any;
    readonly openStage: (a: any, b: any, c: number, d: number) => any;
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
    readonly pageengine_putPicture: (a: number, b: number, c: number, d: any) => void;
    readonly pageengine_putTile: (a: number, b: number, c: number, d: number, e: any) => void;
    readonly pageengine_redo: (a: number) => [number, number];
    readonly pageengine_roots: (a: number) => [number, number];
    readonly pageengine_setBoards: (a: number, b: number, c: number) => void;
    readonly pageengine_setDocument: (a: number, b: number, c: number) => [number, number];
    readonly pageengine_setGpu: (a: number, b: number) => void;
    readonly pageengine_setInk: (a: number, b: number, c: number) => void;
    readonly pageengine_setMarkdownReader: (a: number, b: any) => void;
    readonly pageengine_setPreview: (a: number, b: number, c: number) => [number, number];
    readonly pageengine_setView: (a: number, b: number, c: number) => void;
    readonly pageengine_text: (a: number) => [number, number];
    readonly pageengine_tileCount: (a: number) => number;
    readonly pageengine_undo: (a: number) => [number, number];
    readonly pageengine_wantedPictures: (a: number) => [number, number];
    readonly pageengine_within: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly start: () => void;
    readonly workerengine_addFont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly workerengine_apply: (a: number, b: number, c: number, d: number) => [number, number];
    readonly workerengine_applyEdits: (a: number, b: number, c: number) => [number, number];
    readonly workerengine_discarded: (a: number) => [number, number];
    readonly workerengine_dropItems: (a: number, b: number, c: number) => void;
    readonly workerengine_dropped: (a: number, b: number, c: number, d: number) => void;
    readonly workerengine_landed: (a: number) => [number, number];
    readonly workerengine_lift: (a: number, b: number, c: number) => void;
    readonly workerengine_new: (a: number, b: number, c: number) => [number, number, number];
    readonly workerengine_paint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly workerengine_putIcon: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly workerengine_putPicture: (a: number, b: number, c: number, d: any) => void;
    readonly workerengine_reload: (a: number, b: number, c: number, d: number) => [number, number];
    readonly workerengine_setGpu: (a: number, b: number, c: any) => void;
    readonly workerengine_setMarkdownReader: (a: number, b: any) => void;
    readonly workerengine_setView: (a: number, b: number, c: number) => void;
    readonly workerengine_tileSize: () => number;
    readonly workerengine_wantedPictures: (a: number) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___js_sys_89ffcc1aa63764a9___Function_fn_wasm_bindgen_d9d9da00610227f7___JsValue_____wasm_bindgen_d9d9da00610227f7___sys__Undefined___js_sys_89ffcc1aa63764a9___Function_fn_wasm_bindgen_d9d9da00610227f7___JsValue_____wasm_bindgen_d9d9da00610227f7___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_a918a428dde8d233___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_a918a428dde8d233___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true__67: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wasm_bindgen_d9d9da00610227f7___sys__JsNullable_wgpu_a918a428dde8d233___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_d9d9da00610227f7___JsError___true__68: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d9d9da00610227f7___convert__closures_____invoke___wgpu_a918a428dde8d233___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true_: (a: number, b: number, c: any) => void;
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
