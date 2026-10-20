/**
 * What this browser can draw the stage with, found before any engine is loaded: WebGPU where it has
 * an adapter, else WebGL 2 where both the page and a worker's `OffscreenCanvas` have it, else
 * nothing, and the stage shows why (`notice.ts`).
 *
 * The answer also says which build to load: `@decks/stage` (`pkg/`) draws with WebGPU only, and
 * `@decks/stage/gl` (`pkg-gl/`) with WebGL 2 as well, at about 680 KB more brotli wasm, so a
 * browser with WebGPU never downloads the GL half. The page and its render worker load the same
 * one, named by the backend the page passes in the worker's init.
 *
 * Nothing here touches the stage's own canvas: a canvas that has once had a WebGPU context can
 * never have a WebGL 2 one, and the engine opens it (`crates/web/src/select.rs`).
 */
import * as webgpu from "./webgpu.ts";
import * as webgl from "./webgl.ts";

/** The graphics API the stage draws with, by the name the engine gives it. */
export type BackendName = "webgpu" | "webgl2";

/** The engine's module, either build: they have the same calls. */
export type StageModule = typeof import("@decks/stage");

/** Starts the engine again when its device goes, and stops watching when the stage goes. */
export type Watch = (canvas: EventTarget, on: { lost: () => void; restored: () => void; isLost: () => boolean }) => () => void;

/** A backend this browser has: the build to load, and how its device is lost and comes back. */
export interface Backend {
	name: BackendName;
	/** The engine's module for this backend, initialised. */
	load: () => Promise<StageModule>;
	watch: Watch;
}

/** What `detect` found: a backend, and whether the device is short of memory (one sample a pixel). */
export interface Detected {
	backend: Backend;
	/** `navigator.deviceMemory` is 2 GiB or less; undefined where the browser does not say. */
	lowMemory?: boolean;
}

/** No WebGPU and no WebGL 2 that a worker can draw with: the stage shows the notice. */
export class NoBackend extends Error {
	constructor(why: string) {
		super(why);
		this.name = "NoBackend";
	}
}

const BACKENDS: Record<BackendName, Backend> = {
	webgpu: { name: "webgpu", load: () => import("@decks/stage").then(started), watch: webgpu.watch },
	// The same calls; only the wasm's own exports (`InitOutput`) differ between the builds.
	webgl2: { name: "webgl2", load: () => import("@decks/stage/gl").then((module) => started(module as unknown as StageModule)), watch: webgl.watch },
};

async function started(module: StageModule): Promise<StageModule> {
	await module.default();
	return module;
}

/** The backend the page chose, by its name, for the worker to load the same. */
export function backendNamed(name: string | undefined): Backend {
	return BACKENDS[name === "webgl2" ? "webgl2" : "webgpu"];
}

/** A WebGPU adapter, asked for without any canvas. False where there is no `navigator.gpu` or no adapter behind it. */
async function hasWebGpu(): Promise<boolean> {
	const gpu = (navigator as { gpu?: GPU }).gpu;
	if (!gpu) return false;
	try {
		return Boolean(await gpu.requestAdapter());
	} catch {
		return false;
	}
}

/** A WebGL 2 context on a canvas of its own, let go at once: browsers keep only a few. */
function hasWebGl2(canvas: HTMLCanvasElement | OffscreenCanvas | undefined): boolean {
	try {
		const gl = canvas?.getContext("webgl2") as WebGL2RenderingContext | null | undefined;
		if (!gl) return false;
		gl.getExtension("WEBGL_lose_context")?.loseContext();
		return true;
	} catch {
		return false;
	}
}

/** `navigator.deviceMemory` at 2 GiB or less, where the browser gives it (Chromium does). */
export function lowMemory(): boolean | undefined {
	const memory = (navigator as { deviceMemory?: number }).deviceMemory;
	return typeof memory === "number" ? memory <= 2 : undefined;
}

/**
 * The backend to open the stage with. WebGPU present but with no adapter (a blocklisted card,
 * WebGPU turned off) is as if it were not there. WebGL 2 counts only where an `OffscreenCanvas`
 * has it too, since the render worker paints there: iOS 16 has WebGL 2 on the page and not in a
 * worker, and gets the notice rather than a stage with no drawing (decision D2).
 */
/** The renderer this browser asked for in a settings page (Studio's), kept in `decks.backend`; else the best there is. */
export const PREFERRED_BACKEND_KEY = "decks.backend";
function preferred(): BackendName | undefined {
	try {
		const want = globalThis.localStorage?.getItem(PREFERRED_BACKEND_KEY);
		return want === "webgl2" || want === "webgpu" ? want : undefined;
	} catch {
		return undefined;
	}
}

export async function detect(): Promise<Detected> {
	const memory = lowMemory();
	// WebGL asked for: tried first, so a machine whose WebGPU misbehaves can be steered off it.
	if (preferred() === "webgl2" && hasWebGl2(typeof document === "undefined" ? undefined : document.createElement("canvas")) && typeof OffscreenCanvas === "function" && hasWebGl2(new OffscreenCanvas(1, 1))) return { backend: BACKENDS.webgl2, lowMemory: memory };
	if (await hasWebGpu()) return { backend: BACKENDS.webgpu, lowMemory: memory };
	const page = hasWebGl2(typeof document === "undefined" ? undefined : document.createElement("canvas"));
	const worker = typeof OffscreenCanvas === "function" && hasWebGl2(new OffscreenCanvas(1, 1));
	if (page && worker) return { backend: BACKENDS.webgl2, lowMemory: memory };
	throw new NoBackend(page ? "WebGL 2 on the page but not in an OffscreenCanvas, where the render worker draws" : "no WebGPU adapter and no WebGL 2");
}
