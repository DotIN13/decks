import { measureFrame } from "./board/extent.ts";

/**
 * One board, measured for `stage.fit` when no canvas has measured it (`server/stage/shots.ts`).
 *
 * A board is measured in the frame that shows it, and a board nobody is looking at has no frame:
 * an agent writing on its own stage while the person looks at another one was told "nothing has
 * measured" on most fits. This page is the frame instead, in the server's own Chromium: the board
 * at its own width and height, and the canvas's own `measureFrame`, so the numbers are the ones a
 * canvas would have sent.
 */

type MeasureWindow = Window & { __measured?: ReturnType<typeof measureFrame> | null; __measureFailed?: string };
const measureWindow = window as MeasureWindow;

const query = new URLSearchParams(location.search);
const path = query.get("path") ?? "";
const w = Number(query.get("w")) || 1000;
const h = Number(query.get("h")) || 240;
const READY_MS = 10_000;

const frame = document.createElement("iframe");
frame.src = `/api/board/${path.split("/").map(encodeURIComponent).join("/")}`;
frame.setAttribute("scrolling", "no");
Object.assign(frame.style, { width: `${w}px`, height: `${h}px` });
document.body.append(frame);

const started = performance.now();
const attempt = () => {
	const measured = measureFrame(frame);
	if (measured) {
		measureWindow.__measured = measured;
		return;
	}
	if (performance.now() - started > READY_MS) {
		measureWindow.__measureFailed = "the board never said it was ready";
		return;
	}
	setTimeout(attempt, 100);
};
frame.addEventListener("load", attempt, { once: true });
