// A test page: the engine on two stacked canvases, driven from Playwright through `window.t`.
import { createEngine, type Engine } from "../src/index.ts";

declare global {
	interface Window {
		t: {
			engine?: Engine;
			start(prefer: "webgpu" | "webgl2", width: number, height: number, dpr: number): Promise<string | undefined>;
			picture(name: string, w: number, h: number, hue: number, layer: 0 | 1): Promise<void>;
		};
	}
}

const host = document.getElementById("host")!;
window.t = {
	async start(prefer, width, height, dpr) {
		host.innerHTML = "";
		host.style.cssText = `position:relative;width:${width}px;height:${height}px`;
		const make = () => {
			const c = document.createElement("canvas");
			c.style.cssText = "position:absolute;left:0;top:0";
			host.append(c);
			return c;
		};
		const under = make();
		const page = document.createElement("div");
		page.id = "page";
		page.style.cssText = "position:absolute;left:300px;top:100px;width:200px;height:150px;background:rgb(0,0,255)";
		host.append(page);
		const over = make();
		over.style.pointerEvents = "none";
		const engine = await createEngine({ under, over, prefer });
		if (!engine) return undefined;
		engine.view(width, height, dpr);
		engine.camera(width / 2, height / 2, 1);
		window.t.engine = engine;
		return engine.backend;
	},
	async picture(name, w, h, hue, layer) {
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext("2d")!;
		ctx.fillStyle = `hsl(${hue} 80% 50%)`;
		ctx.fillRect(0, 0, w, h);
		const bitmap = await createImageBitmap(canvas);
		window.t.engine!.texture(name, bitmap, layer);
		bitmap.close();
	},
};
