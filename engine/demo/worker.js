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
		const discarded = JSON.parse(engine.discarded());
		if (discarded.length) postMessage({ type: "discarded", keys: discarded });
		const landed = JSON.parse(engine.landed());
		if (landed.length) postMessage({ type: "landed", ids: landed });
		const wanted = JSON.parse(engine.wantedPictures());
		if (wanted.length) postMessage({ type: "wanted", urls: wanted });
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
	} else if (data.type === "lift") {
		engine.lift(JSON.stringify(data.ids));
		busy = false;
		paint();
	} else if (data.type === "drop") {
		engine.dropItems(JSON.stringify(data.ids));
		paint();
	} else if (data.type === "picture") {
		engine.putPicture(data.url, data.bitmap);
		paint();
	} else if (data.type === "font") {
		engine.addFont(data.name, data.bytes, data.fallback);
		paint();
	} else if (data.type === "dropped") {
		for (const [s, x, y] of data.keys) engine.dropped(s, x, y);
	}
};
