import type { PenDocument } from "@decks/pen";
import { StageEngine } from "@decks/canvas/host";

/**
 * One stage, drawn for a picture: the page the server's Chromium loads to take `decks.canvas.screenshot`
 * and the drawing's Export (`server/stage/shots.ts`).
 *
 * The same pieces as the canvas, and nothing else: the stage's engine (`render/engine.ts`) on its
 * canvas, over the boards as live frames, framed on the box in the address. No socket, no chrome,
 * no camera to move. When the boards say they are ready and the drawing has stopped redrawing for
 * fonts, icons and images, `window.__shotReady` is set and the picture is taken.
 */

type ShotWindow = Window & { __shotReady?: boolean; __shotFailed?: string };
const shotWindow = window as ShotWindow;

const query = new URLSearchParams(location.search);
const stage = query.get("stage") ?? "";
/** A .pen file to draw instead of a stage: a saved frame, by its path (`/api/pen-file`). */
const penPath = query.get("pen");
const box = { x1: Number(query.get("x1")), y1: Number(query.get("y1")), x2: Number(query.get("x2")), y2: Number(query.get("y2")) };
const scheme = query.get("scheme") === "dark" ? "dark" : "light";
document.documentElement.dataset.colorScheme = scheme;

/** How long the drawing must go without a redraw before it counts as finished. */
const QUIET_MS = 500;
const BOARD_MS = 10_000;

async function main(): Promise<void> {
	// The harness's canvas pass for the canvas this page draws (`server/src/auth/passes.ts`).
	const pass = query.get("pass");
	const headers: Record<string, string> = pass ? { Authorization: `Bearer ${pass}` } : {};
	const response = penPath ? await fetch(`/api/pen-file?path=${encodeURIComponent(penPath)}`, { headers }) : await fetch(`/api/stage-pen/${encodeURIComponent(stage)}`, { headers });
	if (!response.ok) throw new Error(penPath ? `no pen file "${penPath}" (${response.status}): ${await response.text()}` : `no stage "${stage}" (${response.status})`);
	const { doc, base, boards } = (await response.json()) as { doc: PenDocument; base: string; boards: Array<{ path: string; x: number; y: number; w: number; h: number }> };

	const view = { width: innerWidth, height: innerHeight };
	const zoom = view.width / (box.x2 - box.x1);
	const camera = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2, zoom };
	const world = document.getElementById("world")!;
	world.style.transform = `translate(${view.width / 2}px, ${view.height / 2}px) scale(${zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

	// The boards in the box, as the frames the canvas would show, under the engine's canvas.
	const inView = boards.filter((b) => b.x < box.x2 && b.x + b.w > box.x1 && b.y < box.y2 && b.y + b.h > box.y1);
	const ready = inView.map(
		(board) =>
			new Promise<void>((resolve) => {
				const frame = document.createElement("iframe");
				frame.src = `/api/board/${board.path.split("/").map(encodeURIComponent).join("/")}`;
				frame.setAttribute("scrolling", "no");
				Object.assign(frame.style, { left: `${board.x}px`, top: `${board.y}px`, width: `${board.w}px`, height: `${board.h}px` });
				world.append(frame);
				const started = performance.now();
				const wait = () => {
					const ready = (frame.contentWindow as (Window & { __boardReady?: boolean }) | null)?.__boardReady;
					if (ready || performance.now() - started > BOARD_MS) resolve();
					else setTimeout(wait, 100);
				};
				frame.addEventListener("load", wait, { once: true });
			}),
	);

	const engine = new StageEngine();
	let lastDrawn = performance.now();
	engine.drawn = () => {
		lastDrawn = performance.now();
	};
	// A frame drawn is drawing too: the picture is taken once fonts, tiles and pictures have all gone quiet.
	engine.presented = () => {
		lastDrawn = performance.now();
	};
	let failed: string | undefined;
	engine.failed = (why) => (failed = why);
	engine.setView(view);
	engine.setScheme(scheme);
	// Placeholder frames as the canvas marks them: in the canvas's last writer's colour, with its name.
	const writerColor = query.get("writerColor");
	const writerName = query.get("writerName");
	engine.setWriter({ color: writerColor ?? (getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#3b5cf6"), ...(writerName ? { name: writerName } : {}) });
	engine.attachCanvas(document.querySelector("canvas.over") as HTMLCanvasElement);
	// Every card is live here, so the engine leaves a hole over each and fetches no pictures.
	engine.setCards(boards.map((board) => ({ ...board, live: true })));
	engine.setDoc(doc, base);
	engine.setCamera(camera);

	await Promise.all(ready);
	const started = performance.now();
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		if (failed) throw new Error(`the stage engine did not start: ${failed}`);
		const drawingShown = doc.children.length === 0 || engine.tileCount() > 0;
		if (drawingShown && performance.now() - lastDrawn > QUIET_MS) break;
		if (performance.now() - started > BOARD_MS) break;
	}
	// Two frames, so the last picture is on the screen and not only recorded.
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	shotWindow.__shotReady = true;
}

main().catch((error: unknown) => {
	shotWindow.__shotFailed = error instanceof Error ? error.message : String(error);
});
