import type { PenDocument } from "@decks/pen";
import { PenLayer } from "./canvas/pen/layer.ts";

/**
 * One stage, drawn for a picture: the page the server's Chromium loads to take `stage.screenshot`
 * and the drawing's Export (`server/stage/shots.ts`).
 *
 * The same pieces as the canvas, and nothing else: the drawing's two sheets from `PenLayer`, with
 * the boards between them as live frames, framed on the box in the address. No socket, no chrome,
 * no camera to move. When the boards say they are ready and the drawing has stopped redrawing for
 * fonts, icons and images, `window.__shotReady` is set and the picture is taken.
 */

type ShotWindow = Window & { __shotReady?: boolean; __shotFailed?: string };
const shotWindow = window as ShotWindow;

const query = new URLSearchParams(location.search);
const stage = query.get("stage") ?? "";
const box = { x1: Number(query.get("x1")), y1: Number(query.get("y1")), x2: Number(query.get("x2")), y2: Number(query.get("y2")) };
const scheme = query.get("scheme") === "dark" ? "dark" : "light";

/** How long the drawing must go without a redraw before it counts as finished. */
const QUIET_MS = 500;
const BOARD_MS = 10_000;

async function main(): Promise<void> {
	const response = await fetch(`/api/stage-pen/${encodeURIComponent(stage)}`);
	if (!response.ok) throw new Error(`no stage "${stage}" (${response.status})`);
	const { doc, base, boards } = (await response.json()) as { doc: PenDocument; base: string; boards: Array<{ path: string; x: number; y: number; w: number; h: number }> };

	const view = { width: innerWidth, height: innerHeight };
	const zoom = view.width / (box.x2 - box.x1);
	const camera = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2, zoom };
	const world = document.getElementById("world")!;
	world.style.transform = `translate(${view.width / 2}px, ${view.height / 2}px) scale(${zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

	// The boards in the box, as the frames the canvas would show; before the over sheet, so under it.
	const over = world.querySelector("canvas.over")!;
	const inView = boards.filter((b) => b.x < box.x2 && b.x + b.w > box.x1 && b.y < box.y2 && b.y + b.h > box.y1);
	const ready = inView.map(
		(board) =>
			new Promise<void>((resolve) => {
				const frame = document.createElement("iframe");
				frame.src = `/api/board/${board.path.split("/").map(encodeURIComponent).join("/")}`;
				frame.setAttribute("scrolling", "no");
				Object.assign(frame.style, { left: `${board.x}px`, top: `${board.y}px`, width: `${board.w}px`, height: `${board.h}px` });
				world.insertBefore(frame, over);
				const started = performance.now();
				const wait = () => {
					const ready = (frame.contentWindow as (Window & { __boardReady?: boolean }) | null)?.__boardReady;
					if (ready || performance.now() - started > BOARD_MS) resolve();
					else setTimeout(wait, 100);
				};
				frame.addEventListener("load", wait, { once: true });
			}),
	);

	const layer = new PenLayer();
	let lastDrawn = 0;
	let drawnOnce = doc.children.length === 0;
	layer.drawn = () => {
		lastDrawn = performance.now();
		drawnOnce = true;
	};
	layer.attach(document.querySelector("canvas.under")!, "under");
	layer.attach(over as HTMLCanvasElement, "over");
	layer.setView(view);
	layer.setScheme(scheme);
	layer.setBoards(boards);
	layer.setDoc(doc, base);
	layer.setCamera(camera);

	await Promise.all(ready);
	const started = performance.now();
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		if (drawnOnce && performance.now() - lastDrawn > QUIET_MS) break;
		if (performance.now() - started > BOARD_MS) break;
	}
	// Two frames, so the last picture is on the screen and not only recorded.
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	shotWindow.__shotReady = true;
}

main().catch((error: unknown) => {
	shotWindow.__shotFailed = error instanceof Error ? error.message : String(error);
});
