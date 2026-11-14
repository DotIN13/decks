import { createSignal, onCleanup, Show } from "solid-js";

/**
 * A frame-rate meter over the canvas, for judging a pan by eye and by number (Settings, Boards).
 *
 * It counts the page's animation frames, which is what a pan has to keep up with: frames a second
 * over the last second, the slowest frame in it, and the share of frames over 12 ms, which at
 * 120 Hz is a frame missed (16.7 ms is one missed at 60 Hz). Read four times a second, so the meter
 * itself costs nothing a pan would notice.
 */
const FPS_KEY = "decks.showFps";
const read = (key: string) => (typeof localStorage !== "undefined" && localStorage.getItem(key) === "1");
const [showFps, setShowFps] = createSignal(read(FPS_KEY));
export { showFps };
export function chooseShowFps(on: boolean): void {
	setShowFps(on);
	if (on) localStorage.setItem(FPS_KEY, "1");
	else localStorage.removeItem(FPS_KEY);
}

/** How many frames the plot keeps: about four seconds at 120 Hz. */
const KEEP = 480;
/** The plot's height stands for this many ms a frame; slower frames are drawn at the top. */
const TOP_MS = 50;

export function FpsMeter() {
	const [shown, setShown] = createSignal({ fps: 0, worst: 0, missed: 0 });
	let canvas!: HTMLCanvasElement;
	/** Each frame's gap from the one before, newest last. */
	const gaps: number[] = [];
	/** Frame times over the last second, for the frames a second. */
	const second: number[] = [];
	let raf = 0;
	let prev = 0;
	let lastText = 0;
	let lastDraw = 0;
	const draw = () => {
		const g = canvas?.getContext("2d");
		if (!g) return;
		const dpr = Math.min(2, devicePixelRatio || 1);
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (canvas.width !== Math.round(w * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, w, h);
		const y = (ms: number) => h - (Math.min(ms, TOP_MS) / TOP_MS) * h;
		// Guides: every frame at 120 Hz, and at 60 Hz.
		g.lineWidth = 1;
		g.setLineDash([3, 3]);
		for (const [ms, colour] of [[8.3, "rgba(46, 160, 67, 0.7)"], [16.7, "rgba(210, 153, 34, 0.8)"]] as const) {
			g.strokeStyle = colour;
			g.beginPath();
			g.moveTo(0, Math.round(y(ms)) + 0.5);
			g.lineTo(w, Math.round(y(ms)) + 0.5);
			g.stroke();
		}
		g.setLineDash([]);
		// The frames, newest at the right edge: per column of pixels the slowest frame in it, so a missed
		// frame always shows and the line does not turn into a comb of single frames.
		const columns = Math.max(1, Math.floor(w));
		const per = KEEP / columns;
		const slowest = new Array<number>(columns).fill(-1);
		gaps.forEach((gap, i) => {
			const column = Math.min(columns - 1, Math.floor((KEEP - gaps.length + i) / per));
			slowest[column] = Math.max(slowest[column]!, gap);
		});
		g.strokeStyle = getComputedStyle(canvas).color;
		g.lineWidth = 1.5;
		g.lineJoin = "round";
		g.beginPath();
		let started = false;
		slowest.forEach((gap, x) => {
			if (gap < 0) return;
			if (!started) g.moveTo(x + 0.5, y(gap));
			else g.lineTo(x + 0.5, y(gap));
			started = true;
		});
		g.stroke();
	};
	const tick = (t: number) => {
		if (prev) {
			gaps.push(t - prev);
			if (gaps.length > KEEP) gaps.shift();
		}
		prev = t;
		second.push(t);
		while (second.length && t - second[0]! > 1000) second.shift();
		// The numbers four times a second; the plot about thirty, so the meter is never what a pan waits on.
		if (t - lastText > 250) {
			lastText = t;
			const recent = gaps.slice(-Math.max(1, second.length - 1));
			const worst = recent.reduce((a, b) => Math.max(a, b), 0);
			const missed = recent.filter((gap) => gap > 12).length;
			setShown({ fps: second.length, worst: Math.round(worst), missed: Math.round((missed / Math.max(1, recent.length)) * 100) });
		}
		if (t - lastDraw > 33) {
			lastDraw = t;
			draw();
		}
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);
	onCleanup(() => cancelAnimationFrame(raf));
	const level = () => (shown().missed > 20 ? "bad" : shown().missed > 5 ? "meh" : "good");
	return (
		<div class="fps-meter" data-level={level()} aria-live="off">
			<div class="fps-head">
				<span class="fps-n">{shown().fps}</span>
				<span class="fps-u">fps</span>
			</div>
			<canvas class="fps-plot" ref={canvas} aria-label="Time each frame took over the last four seconds" />
			<div class="fps-d">
				slowest {shown().worst} ms · {shown().missed}% over 12 ms
			</div>
			<div class="fps-key">
				<span class="k120">8.3 ms, 120 Hz</span>
				<span class="k60">16.7 ms, 60 Hz</span>
			</div>
		</div>
	);
}
