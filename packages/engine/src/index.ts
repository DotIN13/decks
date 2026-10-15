/**
 * The stage engine, from the page's side.
 *
 * `createEngine` picks the graphics backend (WebGPU where the browser has it, WebGL 2 otherwise),
 * loads the C++ engine (`cpp/engine.cpp`, built to `wasm/` by `build.sh`), and gives back a small
 * interface: say where things are, hand over pictures, and draw when the page draws. The page keeps
 * the clock: `render` is called in the same animation frame that moves the live board pages, so the
 * two never disagree about where the camera is.
 *
 * Two canvases, because live boards are still page elements here: `under` sits beneath them and
 * `over` above. With HTML-in-Canvas the boards will move into the engine and the canvases into one.
 */
import createEngineModule from "../wasm/engine.mjs";

export type Backend = "webgpu" | "webgl2";
/** 0 is under the board pages, 1 is over them. */
export type Layer = 0 | 1;

export interface Item {
	layer: Layer;
	/** Drawing order within the layer, lowest first. */
	order: number;
	/** Where it is on the stage, in stage pixels. */
	x: number;
	y: number;
	w: number;
	h: number;
	/** A texture handed over with `texture`, by its name; without one the item is a colour. */
	texture?: string;
	/** The part of the texture shown, 0 to 1; the whole of it when left out. */
	uv?: [number, number, number, number];
	/** Red, green and blue from 0 to 255 and alpha from 0 to 1; for a texture, only alpha is read. */
	color?: [number, number, number, number];
	/** Corner radius, stage pixels. */
	radius?: number;
	/** An outline this many screen pixels wide instead of a fill. */
	stroke?: number;
}

export interface Engine {
	readonly backend: Backend;
	/** The window, in CSS pixels, and device pixels per CSS pixel. Sizes both canvases. */
	view(width: number, height: number, dpr: number): void;
	/** The stage point at the middle of the window, and the zoom. */
	camera(x: number, y: number, zoom: number): void;
	set(id: string, item: Item): void;
	remove(id: string): void;
	clear(): void;
	/** Hand over a picture, for items that name it. A WebGL 2 texture belongs to one layer. */
	texture(name: string, source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement, layer?: Layer): void;
	forget(name: string): void;
	/** Draw the layers that changed. Returns how many items each drew, or -1 for one left as it was. */
	render(force?: boolean): [number, number];
	/** Bytes of picture held on the graphics card, as the engine counts them. */
	textureBytes(): number;
	/**
	 * Draw a layer again and read back the colours at some device-pixel points, as RGBA. For tests
	 * and diagnosis: it does not touch what is on screen with WebGPU, and costs a GPU round trip.
	 */
	readPixels(layer: Layer, points: Array<[number, number]>): Promise<Array<[number, number, number, number]>>;
	dispose(): void;
}

interface Module {
	_engine_init_webgpu(format: number): number;
	_engine_init_webgl(under: number, over: number): number;
	_engine_view(w: number, h: number, dpr: number): void;
	_engine_camera(x: number, y: number, zoom: number): void;
	_engine_item(id: number, layer: number, order: number, x: number, y: number, w: number, h: number, texture: number, u0: number, v0: number, u1: number, v1: number, rgba: number, radius: number, stroke: number): void;
	_engine_remove(id: number): void;
	_engine_clear(): void;
	_engine_texture_gpu(id: number, view: number): void;
	_engine_texture_gl(id: number, layer: number, glTexture: number): void;
	_engine_forget_texture(id: number): void;
	_engine_target(layer: number, view: number): void;
	_engine_dirty(layer: number): number;
	_engine_frame(layer: number): number;
	_engine_stat(which: number): number;
	engineBridge(): {
		importView(view: GPUTextureView): number;
		glContext(handle: number): WebGL2RenderingContext | undefined;
		glRegister(texture: WebGLTexture): number;
		glForget(id: number): void;
	};
	GL: { registerContext(ctx: WebGL2RenderingContext, attributes: Record<string, unknown>): number };
}

const FORMAT: Record<string, number> = { rgba8unorm: 0x16, bgra8unorm: 0x1b };
const wasmUrl = new URL("../wasm/engine.wasm", import.meta.url).href;

/** Names to the integers the engine keys things by. */
class Ids {
	private next = 1;
	private byName = new Map<string, number>();
	get(name: string): number {
		let id = this.byName.get(name);
		if (id === undefined) {
			id = this.next++;
			this.byName.set(name, id);
		}
		return id;
	}
	peek(name: string): number | undefined {
		return this.byName.get(name);
	}
	drop(name: string): void {
		this.byName.delete(name);
	}
	clear(): void {
		this.byName.clear();
	}
}

const packColour = (c: [number, number, number, number] | undefined): number => {
	const [r, g, b, a] = c ?? [255, 255, 255, 1];
	return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | Math.round(Math.max(0, Math.min(1, a)) * 255)) >>> 0;
};

export async function createEngine(options: { under: HTMLCanvasElement; over: HTMLCanvasElement; prefer?: Backend }): Promise<Engine | undefined> {
	const { under, over } = options;
	const canvases = [under, over] as const;
	const wantGpu = options.prefer !== "webgl2" && typeof navigator !== "undefined" && "gpu" in navigator;
	let device: GPUDevice | undefined;
	/**
	 * Held for as long as the engine is, not just while the device is requested. Chrome destroys a
	 * device whose adapter has been garbage-collected ("A valid external Instance reference no longer
	 * exists"), which left the canvas blank with no error until something read the device back.
	 */
	let adapter: GPUAdapter | null = null;
	let format: GPUTextureFormat = "bgra8unorm";
	if (wantGpu) {
		try {
			adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
			device = adapter ? await adapter.requestDevice() : undefined;
			// What WebGPU refuses it says only here, so it is said where a developer will see it.
			device?.lost.then((info) => console.error(`stage engine: the graphics device was lost (${info.reason}): ${info.message}`));
			device?.addEventListener("uncapturederror", (event) => console.error(`stage engine: ${(event as GPUUncapturedErrorEvent).error.message}`));
			format = navigator.gpu.getPreferredCanvasFormat();
		} catch {
			device = undefined;
		}
	}
	const module = (await createEngineModule({
		locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path),
		...(device ? { preinitializedWebGPUDevice: device } : {}),
	})) as Module;
	const bridge = module.engineBridge();
	const items = new Ids();
	const textures = new Ids();
	/** What each texture costs, and how to let it go. */
	const held = new Map<number, { bytes: number; release: () => void; layer: Layer }>();

	let backend: Backend;
	let contexts: [GPUCanvasContext, GPUCanvasContext] | undefined;
	let gl: [WebGL2RenderingContext | undefined, WebGL2RenderingContext | undefined] = [undefined, undefined];
	if (device) {
		contexts = canvases.map((canvas) => {
			const context = canvas.getContext("webgpu") as GPUCanvasContext;
			context.configure({ device: device!, format, alphaMode: "premultiplied" });
			return context;
		}) as [GPUCanvasContext, GPUCanvasContext];
		if (!module._engine_init_webgpu(FORMAT[format] ?? FORMAT.bgra8unorm!)) return undefined;
		backend = "webgpu";
	} else {
		const attributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, majorVersion: 2, minorVersion: 0 };
		const handles = canvases.map((canvas) => {
			const context = canvas.getContext("webgl2", attributes) as WebGL2RenderingContext | null;
			return context ? module.GL.registerContext(context, attributes) : 0;
		});
		if (!handles[0] && !handles[1]) return undefined;
		gl = [bridge.glContext(handles[0]!), bridge.glContext(handles[1]!)];
		module._engine_init_webgl(handles[0]!, handles[1]!);
		backend = "webgl2";
	}

	const uploadGpu = (source: Parameters<Engine["texture"]>[1]) => {
		const width = "width" in source ? source.width : 0;
		const height = "height" in source ? source.height : 0;
		const texture = device!.createTexture({
			size: [Math.max(1, width), Math.max(1, height)],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		device!.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: true }, [width, height]);
		return { texture, bytes: width * height * 4 };
	};

	const uploadGl = (context: WebGL2RenderingContext, source: Parameters<Engine["texture"]>[1]) => {
		const texture = context.createTexture()!;
		context.bindTexture(context.TEXTURE_2D, texture);
		context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, source as TexImageSource);
		// Smaller copies, so a board seen far away is sampled rather than shimmering: a third more memory.
		context.generateMipmap(context.TEXTURE_2D);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR_MIPMAP_LINEAR);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
		context.bindTexture(context.TEXTURE_2D, null);
		const width = (source as { width: number }).width;
		const height = (source as { height: number }).height;
		return { texture, bytes: Math.round(width * height * 4 * 4 / 3) };
	};

	let disposed = false;
	const engine: Engine & { adapter?: GPUAdapter | null } = {
		backend,
		adapter,
		view(width, height, dpr) {
			for (const canvas of canvases) {
				const w = Math.max(1, Math.round(width * dpr));
				const h = Math.max(1, Math.round(height * dpr));
				if (canvas.width !== w) canvas.width = w;
				if (canvas.height !== h) canvas.height = h;
				canvas.style.width = `${width}px`;
				canvas.style.height = `${height}px`;
			}
			module._engine_view(width, height, dpr);
		},
		camera(x, y, zoom) {
			module._engine_camera(x, y, zoom);
		},
		set(id, item) {
			const uv = item.uv ?? [0, 0, 1, 1];
			const texture = item.texture ? textures.get(item.texture) : 0;
			module._engine_item(items.get(id), item.layer, item.order, item.x, item.y, item.w, item.h, texture, uv[0], uv[1], uv[2], uv[3], packColour(item.color), item.radius ?? 0, item.stroke ?? 0);
		},
		remove(id) {
			const known = items.peek(id);
			if (known === undefined) return;
			module._engine_remove(known);
			items.drop(id);
		},
		clear() {
			module._engine_clear();
			items.clear();
		},
		texture(name, source, layer = 0) {
			engine.forget(name);
			const id = textures.get(name);
			if (backend === "webgpu") {
				const { texture, bytes } = uploadGpu(source);
				module._engine_texture_gpu(id, bridge.importView(texture.createView()));
				held.set(id, { bytes, layer, release: () => texture.destroy() });
			} else {
				const context = gl[layer];
				if (!context) return;
				const { texture, bytes } = uploadGl(context, source);
				const glId = bridge.glRegister(texture);
				module._engine_texture_gl(id, layer, glId);
				held.set(id, { bytes, layer, release: () => (bridge.glForget(glId), context.deleteTexture(texture)) });
			}
		},
		forget(name) {
			const id = textures.peek(name);
			if (id === undefined) return;
			module._engine_forget_texture(id);
			held.get(id)?.release();
			held.delete(id);
		},
		render(force = false) {
			const drawn: [number, number] = [-1, -1];
			if (disposed) return drawn;
			for (const layer of [0, 1] as const) {
				if (!force && !module._engine_dirty(layer)) continue;
				if (contexts) module._engine_target(layer, bridge.importView(contexts[layer].getCurrentTexture().createView()));
				drawn[layer] = module._engine_frame(layer);
			}
			return drawn;
		},
		async readPixels(layer, points) {
			const canvas = canvases[layer];
			if (backend === "webgl2") {
				const context = gl[layer];
				if (!context) return points.map(() => [0, 0, 0, 0] as [number, number, number, number]);
				module._engine_frame(layer);
				const pixel = new Uint8Array(4);
				return points.map(([x, y]) => {
					context.readPixels(x, canvas.height - 1 - y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
					return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
				});
			}
			const width = canvas.width;
			const height = canvas.height;
			const target = device!.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			module._engine_target(layer, bridge.importView(target.createView()));
			module._engine_frame(layer);
			const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
			const buffer = device!.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			const encoder = device!.createCommandEncoder();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device!.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const data = new Uint8Array(buffer.getMappedRange());
			const bgra = format === "bgra8unorm";
			const out = points.map(([x, y]) => {
				const i = y * bytesPerRow + x * 4;
				return (bgra ? [data[i + 2], data[i + 1], data[i], data[i + 3]] : [data[i], data[i + 1], data[i + 2], data[i + 3]]) as [number, number, number, number];
			});
			buffer.unmap();
			buffer.destroy();
			target.destroy();
			return out;
		},
		textureBytes() {
			let total = 0;
			for (const one of held.values()) total += one.bytes;
			return total;
		},
		dispose() {
			disposed = true;
			for (const one of held.values()) one.release();
			held.clear();
			contexts?.forEach((context) => context.unconfigure());
			device?.destroy();
		},
	};
	return engine;
}
