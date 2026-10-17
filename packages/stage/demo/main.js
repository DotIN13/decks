// The page: owns the document through the Rust page engine, sends the render worker numbered
// batches and the camera, and in one animation frame moves the boards' pages and lays the tiles.
import init, { PageEngine, openCanvas } from "./pkg/stage_web.js";

const params = new URLSearchParams(location.search);
const name = params.get("stage") ?? "herobrine";
const dark = params.get("dark") === "1";
const stageUrl = `/deck/stages/${name}/stage.pen`;

const canvas = document.getElementById("stage");
const world = document.getElementById("world");
const hud = document.getElementById("hud");

const camera = { x: Number(params.get("x") ?? 0), y: Number(params.get("y") ?? 0), zoom: Number(params.get("zoom") ?? 0.25) };
const stats = { frames: 0, pageMs: [], tiles: 0, painted: 0, lastFrame: 0, fps: 0, errors: [] };
let engine;
let worker;
let dirty = true;
let moving = false;
let settle = 0;

function size() {
	const dpr = devicePixelRatio || 1;
	return { dpr, width: innerWidth, height: innerHeight };
}

function sendCamera() {
	const { dpr, width, height } = size();
	worker.postMessage({ type: "camera", camera: { ...camera, dpr, width, height, moving } });
}

function changed(isMoving = true) {
	dirty = true;
	moving = isMoving;
	clearTimeout(settle);
	// At rest a little after the last move: the worker then paints tiles at the exact scale.
	settle = setTimeout(() => {
		moving = false;
		sendCamera();
	}, 160);
}

/** Apply a batch made here, and hand the same batch, numbered, to the worker. */
function edit(changes) {
	const text = JSON.stringify(changes);
	const generation = engine.apply(text, true);
	worker.postMessage({ type: "changes", changes: text, generation });
	dirty = true;
}

function forward(result) {
	if (!result || result === "null") return;
	const { changes, generation } = JSON.parse(result);
	worker.postMessage({ type: "changes", changes: JSON.stringify(changes), generation });
	dirty = true;
}

function placeBoards() {
	world.textContent = "";
	for (const b of JSON.parse(engine.boards())) {
		if (!b.url) continue;
		const frame = document.createElement("iframe");
		frame.dataset.id = b.id;
		frame.src = new URL(b.url, new URL(stageUrl, location.href)).href;
		Object.assign(frame.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
		world.append(frame);
	}
}

/** One frame: the same camera moves the boards' pages and lays the tiles. */
function frame(now) {
	requestAnimationFrame(frame);
	if (stats.lastFrame) stats.fps = stats.fps * 0.9 + (1000 / (now - stats.lastFrame)) * 0.1;
	stats.lastFrame = now;
	if (!dirty || !engine) return;
	dirty = false;
	const t0 = performance.now();
	const { dpr, width, height } = size();
	const w = Math.round(width * dpr);
	const h = Math.round(height * dpr);
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	// Whole device pixels, as the tiles are laid.
	const tx = Math.round(-camera.x * camera.zoom * dpr) / dpr;
	const ty = Math.round(-camera.y * camera.zoom * dpr) / dpr;
	world.style.transform = `translate(${tx}px, ${ty}px) scale(${camera.zoom})`;
	stats.tiles = engine.frame(camera.x, camera.y, camera.zoom, dpr, width, height);
	const ms = performance.now() - t0;
	stats.pageMs.push(ms);
	if (stats.pageMs.length > 120) stats.pageMs.shift();
	stats.frames++;
	sendCamera();
	const sorted = [...stats.pageMs].sort((a, b) => a - b);
	hud.textContent = `${name}  zoom ${camera.zoom.toFixed(3)}\npage thread ${ms.toFixed(2)} ms (p95 ${(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2)})\n${stats.fps.toFixed(0)} fps · tiles on screen ${stats.tiles} · held ${engine.tileCount()}\npainted ${stats.painted}${stats.errors.length ? `\n${stats.errors.at(-1)}` : ""}`;
}

// --- input -----------------------------------------------------------------------------------

function toStage(e) {
	return { x: camera.x + e.clientX / camera.zoom, y: camera.y + e.clientY / camera.zoom };
}

let drag;
canvas.addEventListener("pointerdown", (e) => {
	canvas.setPointerCapture(e.pointerId);
	const p = toStage(e);
	const hit = JSON.parse(engine.pick(p.x, p.y, 4 / camera.zoom));
	const top = hit?.path?.[0];
	const box = top && JSON.parse(engine.boxOf(top));
	if (top && box && !e.altKey) drag = { kind: "item", id: top, start: p, from: { x: box[0], y: box[1] } };
	else drag = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y };
});
canvas.addEventListener("pointermove", (e) => {
	if (!drag) return;
	if (drag.kind === "pan") {
		camera.x = drag.cx - (e.clientX - drag.sx) / camera.zoom;
		camera.y = drag.cy - (e.clientY - drag.sy) / camera.zoom;
		changed();
	} else {
		const p = toStage(e);
		edit([
			{ op: "set", id: drag.id, key: "x", value: Math.round(drag.from.x + p.x - drag.start.x) },
			{ op: "set", id: drag.id, key: "y", value: Math.round(drag.from.y + p.y - drag.start.y) },
		]);
	}
});
canvas.addEventListener("pointerup", () => (drag = undefined));
canvas.addEventListener(
	"wheel",
	(e) => {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			const before = toStage(e);
			camera.zoom = Math.min(8, Math.max(0.02, camera.zoom * Math.exp(-e.deltaY * 0.01)));
			camera.x = before.x - e.clientX / camera.zoom;
			camera.y = before.y - e.clientY / camera.zoom;
		} else {
			camera.x += e.deltaX / camera.zoom;
			camera.y += e.deltaY / camera.zoom;
		}
		changed();
	},
	{ passive: false },
);
addEventListener("keydown", (e) => {
	if ((e.metaKey || e.ctrlKey) && e.key === "z") {
		e.preventDefault();
		forward(e.shiftKey ? engine.redo() : engine.undo());
	}
});
addEventListener("resize", () => changed(false));

// --- start -----------------------------------------------------------------------------------

// The fonts the app's chain starts with, from the same CDN (`font-files.ts`); the app proper asks
// `font-files.ts` for exactly the files a stage's words need.
const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
const FONTS = [
	["Inter", "inter@latest/latin-400-normal", false],
	["Inter", "inter@latest/latin-500-normal", false],
	["Inter", "inter@latest/latin-600-normal", false],
	["Inter", "inter@latest/latin-700-normal", false],
	["Inter", "inter@latest/latin-400-italic", false],
	["JetBrains Mono", "jetbrains-mono@latest/latin-400-normal", false],
	["Noto Sans SC", "noto-sans-sc@latest/chinese-simplified-400-normal", true],
];

async function loadFonts() {
	await Promise.all(
		FONTS.map(async ([name, file, fallback]) => {
			const bytes = new Uint8Array(await (await fetch(`${CDN}/${file}.ttf`)).arrayBuffer());
			engine.addFont(name, bytes, fallback);
			worker.postMessage({ type: "font", name, bytes, fallback });
			dirty = true;
		}),
	);
}

async function start() {
	await init();
	const text = await (await fetch(stageUrl)).text();
	engine = new PageEngine(text, dark, `s${Math.random().toString(36).slice(2, 6)}`);
	if (!params.has("zoom")) {
		// The whole stage in the window.
		const [ex, ey, ew, eh] = JSON.parse(engine.extent());
		camera.zoom = Math.min(innerWidth / ew, innerHeight / eh) * 0.95;
		camera.x = ex - (innerWidth / camera.zoom - ew) / 2;
		camera.y = ey - (innerHeight / camera.zoom - eh) / 2;
	}
	const { dpr, width, height } = size();
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	engine.setGpu(await openCanvas(canvas, canvas.width, canvas.height));
	worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
	worker.onmessage = ({ data }) => {
		if (data.type === "tiles") {
			for (const t of data.tiles) engine.putTile(t.scale, t.x, t.y, t.bitmap);
			stats.painted += data.tiles.length;
			const gone = JSON.parse(engine.evict());
			if (gone.length) worker.postMessage({ type: "dropped", keys: gone });
			dirty = true;
		} else if (data.type === "resync") {
			worker.postMessage({ type: "reload", text: engine.text(), dark });
		} else if (data.type === "error") {
			stats.errors.push(data.message);
			dirty = true;
		} else if (data.type === "ready") {
			sendCamera();
		}
	};
	worker.postMessage({ type: "init", text, dark });
	loadFonts();
	if (params.get("boards") !== "0") placeBoards();
	requestAnimationFrame(frame);
	window.__stage = { engine, camera, stats, edit, changed: () => changed(false), pick: (x, y) => engine.pick(x, y, 0) };
}

start().catch((e) => {
	hud.textContent = `failed: ${e?.message ?? e}`;
	console.error(e);
});
