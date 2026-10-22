/**
 * The render worker: the Rust worker engine (`@decks/stage`), holding the same drawing as the page
 * by the same edits, painting the stage as 512-pixel tiles on its own device (the page's backend,
 * from the same build: `backends/detect.ts`) and handing each to the page as a picture. It never shows anything itself: the page lays the tiles in the
 * same frame as the board pages, so the two cannot drift (`engine.ts`).
 */
import type { WorkerEngine } from "@decks/stage";
import { backendNamed } from "./backends/detect.ts";
import { cardReader, mathTypesetter } from "./reader.ts";
import type { FromWorker, ToWorker } from "./types.ts";

interface Scope {
	postMessage(message: FromWorker, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as Scope;

let engine: WorkerEngine | undefined;
let camera: Extract<ToWorker, { type: "camera" }> | undefined;
let painting = false;
/** Messages taken from the page, every kind: the page compares it with what it posted (`sharpAt` in `engine.ts`). */
let got = 0;
const early: ToWorker[] = [];

/** Paint what the view needs, a few tiles at a time, and come back for more after the page has had a turn. */
function paint(): void {
	if (painting || !engine || !camera) return;
	painting = true;
	try {
		const c = camera;
		const tiles = engine.paint(c.x, c.y, c.zoom, c.dpr, c.width, c.height, c.moving, c.moving ? 4 : 12) as Array<{ scale: number; x: number; y: number; bitmap: ImageBitmap }>;
		if (tiles.length) {
			const left = engine.viewLeft(c.x, c.y, c.zoom, c.dpr, c.width, c.height, c.moving);
			scope.postMessage({ type: "tiles", tiles, left, got }, tiles.map((t) => t.bitmap));
		}
		report();
		painting = false;
		if (tiles.length) setTimeout(paint, 0);
	} catch (error) {
		painting = false;
		scope.postMessage({ type: "error", message: String((error as Error)?.message ?? error) });
	}
}

/** What the page needs to hear after a change: tiles let go of, items landed, pictures wanted. */
function report(): void {
	if (!engine) return;
	const discarded = JSON.parse(engine.discarded()) as Array<[number, number, number]>;
	if (discarded.length) scope.postMessage({ type: "discarded", keys: discarded });
	const landed = JSON.parse(engine.landed()) as string[];
	if (landed.length) scope.postMessage({ type: "landed", ids: landed });
	const wanted = JSON.parse(engine.wantedPictures()) as string[];
	if (wanted.length) scope.postMessage({ type: "wanted", urls: wanted });
}

async function start(message: Extract<ToWorker, { type: "init" }>): Promise<void> {
	const chosen = backendNamed(message.backend);
	const stage = await chosen.load();
	const size = stage.WorkerEngine.tileSize();
	const canvas = new OffscreenCanvas(size, size);
	const gpu = await stage.openOffscreen(canvas, size, size, chosen.name, message.lowMemory);
	const backend = gpu.backend();
	engine = new stage.WorkerEngine(message.doc, message.dark);
	engine.setGpu(gpu, canvas);
	// A lost device or context: the page starts the worker again, with a new canvas.
	chosen.watch(canvas, { lost: () => scope.postMessage({ type: "lost" }), restored: () => {}, isLost: () => engine?.lost() ?? false });
	engine.setMarkdownReader(cardReader(message.dark ? "dark" : "light"));
	engine.setMath(mathTypesetter());
	for (const one of early.splice(0)) take(one);
	scope.postMessage({ type: "ready", backend });
	paint();
}

function take(message: ToWorker): void {
	if (!engine) {
		if (message.type !== "init") early.push(message);
		return;
	}
	switch (message.type) {
		case "doc":
			engine.reload(message.doc, message.dark);
			engine.setMarkdownReader(cardReader(message.dark ? "dark" : "light"));
			break;
		case "edits":
			try {
				engine.applyEdits(message.edits);
			} catch {
				scope.postMessage({ type: "resync" });
			}
			break;
		case "font":
			engine.addFont(message.name, message.bytes, message.fallback);
			break;
		case "picture":
			engine.putPicture(message.url, message.bitmap, message.width, message.height);
			break;
		case "icon":
			engine.putIcon(message.key, message.shape);
			break;
		case "view":
			engine.setView(message.view);
			break;
		case "lift":
			engine.lift(JSON.stringify(message.ids));
			break;
		case "drop":
			engine.dropItems(JSON.stringify(message.ids));
			break;
		case "dropped":
			for (const [s, x, y] of message.keys) engine.dropped(s, x, y);
			break;
		case "camera":
			camera = message;
			break;
		case "init":
			break;
	}
	report();
	paint();
}

scope.onmessage = ({ data }) => {
	got++;
	if (data.type === "init") {
		void start(data).catch((error: unknown) => scope.postMessage({ type: "failed", message: `the render worker did not start: ${String((error as Error)?.message ?? error)}` }));
		return;
	}
	take(data);
};
