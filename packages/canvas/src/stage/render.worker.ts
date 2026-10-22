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
/** The scheme the engine's markdown reader reads in. */
let dark = false;
const EMPTY = '{"version":"2.14","children":[]}';
let camera: Extract<ToWorker, { type: "camera" }> | undefined;
let painting = false;
/** A paint is coming (`paintSoon`). */
let soon: ReturnType<typeof setTimeout> | undefined;
/**
 * The page is fetching the drawing's fonts (`fontsDue`), or has no drawing yet (`docDue`), and the
 * first view is not painted yet: the worker waits for them, up to `WAIT_MS` from when it could
 * first paint (`waitBy`), since tiles painted in a stand-in font, or of an empty stage, are all
 * painted again when they come.
 */
let fontsWaited = false;
let docWaited = false;
let waitBy = 0;
const WAIT_MS = 300;
/** The first view has been painted whole: fonts that come after are painted when they come. */
let viewDone = false;
const waitForFonts = () => {
	if (!viewDone) fontsWaited = true;
};
/** Messages taken from the page, every kind: the page compares it with what it posted (`sharpAt` in `engine.ts`). */
let got = 0;
/** `got` when the page was last sent tiles, or told there were none to paint. */
let told = -1;
const early: ToWorker[] = [];
/** Taking the messages that came before the engine was up (`start`). */
let replaying = false;

/**
 * Paint once the messages already here are taken (or in `ms`): fonts, pictures and icons that come
 * together are laid out and painted for once (the engine settles them at its next paint), not once each.
 */
function paintSoon(ms = 0): void {
	// A paint asked for sooner than the one coming (the fonts waited for have come) moves it up.
	const at = performance.now() + ms;
	if (soon !== undefined) {
		if (at >= soonAt) return;
		clearTimeout(soon);
	}
	soonAt = at;
	soon = setTimeout(() => {
		soon = undefined;
		paint();
	}, ms);
}
let soonAt = 0;

/** Paint what the view needs, a few tiles at a time, and come back for more after the page has had a turn. */
function paint(): void {
	if (painting || !engine || !camera) return;
	if (fontsWaited || docWaited) {
		waitBy ||= performance.now() + WAIT_MS;
		const wait = waitBy - performance.now();
		if (wait > 0) return paintSoon(wait);
		fontsWaited = docWaited = false;
	}
	painting = true;
	try {
		const c = camera;
		const tiles = engine.paint(c.x, c.y, c.zoom, c.dpr, c.width, c.height, c.moving, c.moving ? 4 : 12) as Array<{ scale: number; x: number; y: number; bitmap: ImageBitmap }>;
		if (tiles.length) {
			const left = engine.viewLeft(c.x, c.y, c.zoom, c.dpr, c.width, c.height, c.moving);
			if (left === 0) viewDone = true;
			const rest = c.moving ? engine.viewLeft(c.x, c.y, c.zoom, c.dpr, c.width, c.height, false) : left;
			told = got;
			scope.postMessage({ type: "tiles", tiles, left, got, rest }, tiles.map((t) => t.bitmap));
		} else {
			viewDone = true;
			// Nothing to paint, the window whole at its resting scale, and the page not told since its last message: it is told, for `settledAt`.
			if (told !== got && engine.viewLeft(c.x, c.y, c.zoom, c.dpr, c.width, c.height, false) === 0) {
				told = got;
				scope.postMessage({ type: "tiles", tiles: [], left: 0, got, rest: 0 });
			}
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

/** The engine loaded and the worker's device open (`boot`), before the drawing comes. */
let booted: ReturnType<typeof boot> | undefined;
function boot(message: { backend?: string; lowMemory?: boolean; module?: WebAssembly.Module }) {
	const opening = (async () => {
		const chosen = backendNamed(message.backend);
		const stage = await chosen.load(message.module);
		const size = stage.WorkerEngine.tileSize();
		const canvas = new OffscreenCanvas(size, size);
		const gpu = await stage.openOffscreen(canvas, size, size, chosen.name, message.lowMemory);
		return { chosen, stage, canvas, gpu };
	})();
	// Said when the drawing comes (`start`), which the page is listening for.
	opening.catch(() => {});
	return opening;
}

async function start(message: Extract<ToWorker, { type: "init" }>): Promise<void> {
	// A page that sent no `boot` (one from before it) says the backend here.
	const { chosen, stage, canvas, gpu } = await (booted ??= boot(message));
	const backend = gpu.backend();
	// Made empty and given its readers first, then the drawing: each reader given lays the drawing out again.
	engine = new stage.WorkerEngine(EMPTY, message.dark);
	engine.setGpu(gpu, canvas);
	// A lost device or context: the page starts the worker again, with a new canvas.
	chosen.watch(canvas, { lost: () => scope.postMessage({ type: "lost" }), restored: () => {}, isLost: () => engine?.lost() ?? false });
	engine.setMarkdownReader(cardReader(message.dark ? "dark" : "light"));
	engine.setMath(mathTypesetter());
	dark = message.dark;
	engine.reload(message.doc, message.dark);
	if (message.fontsDue) waitForFonts();
	docWaited = !!message.docDue;
	// All of them before anything is painted: the drawing, the fonts it names and the camera come in
	// any order while the engine starts, and a paint after the first would be painted again after the next.
	replaying = true;
	for (const one of early.splice(0)) take(one);
	replaying = false;
	scope.postMessage({ type: "ready", backend });
	paintSoon();
}

function take(message: ToWorker): void {
	if (!engine) {
		if (message.type !== "init" && message.type !== "boot") early.push(message);
		return;
	}
	switch (message.type) {
		case "doc":
			docWaited = false;
			// The reader first, and only for a new scheme: given, it lays out the drawing it has.
			if (message.dark !== dark) engine.setMarkdownReader(cardReader(message.dark ? "dark" : "light"));
			dark = message.dark;
			engine.reload(message.doc, message.dark);
			break;
		case "edits":
			try {
				engine.applyEdits(message.edits);
			} catch {
				scope.postMessage({ type: "resync" });
			}
			break;
		case "fontsDue":
			waitForFonts();
			break;
		case "fonts":
			for (const font of message.fonts) engine.addFont(font.name, font.bytes, font.fallback);
			if (message.due === 0) fontsWaited = false;
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
		case "boot":
			break;
	}
	report();
	if (replaying) return;
	// What arrives in bursts waits for the rest of the burst; anything else (the camera above all) is painted for at once.
	if (message.type === "icon" || message.type === "picture" || message.type === "fonts" || message.type === "fontsDue") paintSoon();
	else paint();
}

scope.onmessage = ({ data }) => {
	got++;
	if (data.type === "boot") {
		booted ??= boot(data);
		return;
	}
	if (data.type === "init") {
		void start(data).catch((error: unknown) => scope.postMessage({ type: "failed", message: `the render worker did not start: ${String((error as Error)?.message ?? error)}` }));
		return;
	}
	take(data);
};
