// The render worker: keeps the same document by the same numbered batches, and paints tiles.
import init, { WorkerEngine, openOffscreen } from "./pkg/stage_web.js";

let engine;
let camera;
let busy = false;
const queue = [];

async function paint() {
	if (busy || !engine || !camera) return;
	busy = true;
	try {
		const tiles = engine.paint(camera.x, camera.y, camera.zoom, camera.dpr, camera.width, camera.height, camera.moving, camera.moving ? 4 : 12);
		if (tiles.length) postMessage({ type: "tiles", tiles }, tiles.map((t) => t.bitmap));
		// More to paint: carry on after the page has had a turn.
		if (tiles.length) setTimeout(() => { busy = false; paint(); }, 0);
		else busy = false;
	} catch (e) {
		busy = false;
		postMessage({ type: "error", message: String(e) });
	}
}

onmessage = async ({ data }) => {
	if (data.type === "init") {
		await init();
		const size = WorkerEngine.tileSize();
		const canvas = new OffscreenCanvas(size, size);
		const gpu = await openOffscreen(canvas, size, size);
		engine = new WorkerEngine(data.text, data.dark);
		engine.setGpu(gpu, canvas);
		for (const m of queue.splice(0)) onmessage({ data: m });
		postMessage({ type: "ready" });
		return;
	}
	if (!engine) return void queue.push(data);
	if (data.type === "camera") {
		camera = data.camera;
		paint();
	} else if (data.type === "changes") {
		try {
			engine.apply(data.changes, data.generation);
		} catch {
			postMessage({ type: "resync" });
		}
		paint();
	} else if (data.type === "reload") {
		engine.reload(data.text, data.dark);
		paint();
	} else if (data.type === "font") {
		engine.addFont(data.name, data.bytes, data.fallback);
		paint();
	} else if (data.type === "dropped") {
		for (const [s, x, y] of data.keys) engine.dropped(s, x, y);
	}
};
