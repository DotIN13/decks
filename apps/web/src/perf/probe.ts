/*
 * A frame probe for measuring a device from outside (`?probe=<url>`): every frame's time, the camera,
 * the pages and the engine's tiles, and the touches and pinches that moved it, sent to `<url>` once a
 * second as one JSON line; and the gestures themselves, as `__pilot` for an inspector to call
 * (`scripts/ipad-profile.mjs`). Nothing runs without the parameter.
 */
const target = new URLSearchParams(location.search).get("probe");

type Frame = { t: number; gap: number; busy: number; top: string[]; zoom: number; x: number; y: number; pages: number; tiles: number; sheet: number; pictures: number };

/** Time spent in each handler and frame callback since the last batch, by what it handles and where it was registered: `key → [calls, total ms, longest ms]`. */
const work = new Map<string, [number, number, number]>();
/** The browser's own, for the probe's frame clock, which is not itself timed. */
const nativeFrame = window.requestAnimationFrame.bind(window);
/** Each frame's handler time, by key, so a slow frame can be named. */
let frameWork = new Map<string, number>();
/** `&handlers=1`: time every handler and frame callback too. Capturing where each was registered costs time of its own, so it is off unless asked for. */
if (target && new URLSearchParams(location.search).get("handlers")) {
	const TIMED = new Set(["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel", "scroll", "scrollend", "wheel", "gesturestart", "gesturechange", "gestureend", "message", "keydown"]);
	const site = () => {
		const lines = String(new Error().stack ?? "").split("\n").slice(3).filter((line) => line && !/\b(site|timed|addEventListener|requestAnimationFrame)\b|^\s*at (site|EventTarget|window)/.test(line));
		return lines.slice(0, 4).map((line) => line.replace(/https?:\/\/[^/]+\/assets\//, "").replace(/-[\w]{8}\.js/, "")).join(" < ").slice(0, 220);
	};
	const timed = (key: string, run: () => unknown) => {
		const start = performance.now();
		try {
			return run();
		} finally {
			const ms = performance.now() - start;
			const was = work.get(key) ?? [0, 0, 0];
			work.set(key, [was[0] + 1, was[1] + ms, Math.max(was[2], ms)]);
			frameWork.set(key, (frameWork.get(key) ?? 0) + ms);
		}
	};
	const wrapped = new WeakMap<object, Map<string, EventListener>>();
	const add = EventTarget.prototype.addEventListener;
	const remove = EventTarget.prototype.removeEventListener;
	EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
		const owner: EventTarget = this ?? window;
		if (!listener || !TIMED.has(type)) return add.call(owner, type, listener, options);
		const name = owner instanceof Worker ? "worker" : owner === window ? "window" : owner === document ? "document" : String((owner as Element).className ?? "").split(" ")[0] || (owner as Node).nodeName || "?";
		const key = `${type} ${name} ${site()}`;
		const run: EventListener = (event) => {
			timed(key, () => (typeof listener === "function" ? listener.call(owner, event) : listener.handleEvent(event)));
			// What the handler left for the browser to lay out, paid here rather than at the next frame.
			if (type === "pointerdown") timed(`layout after ${key}`, () => document.body.offsetHeight);
		};
		let byType = wrapped.get(listener);
		if (!byType) wrapped.set(listener, (byType = new Map()));
		byType.set(type + String(typeof options === "boolean" ? options : !!options?.capture), run);
		return add.call(owner, type, run, options);
	};
	EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
		const run = listener ? wrapped.get(listener)?.get(type + String(typeof options === "boolean" ? options : !!options?.capture)) : undefined;
		return remove.call(this ?? window, type, run ?? listener, options);
	};
	const raf = window.requestAnimationFrame.bind(window);
	window.requestAnimationFrame = (callback: FrameRequestCallback) => {
		const key = `frame ${site()}`;
		return raf((t) => timed(key, () => callback(t)));
	};
	const onmessage = Object.getOwnPropertyDescriptor(Worker.prototype, "onmessage");
	if (onmessage?.set) {
		Object.defineProperty(Worker.prototype, "onmessage", {
			...onmessage,
			set(this: Worker, handler: ((event: MessageEvent) => void) | null) {
				const key = `message worker.onmessage ${site()}`;
				onmessage.set!.call(this, handler ? (event: MessageEvent) => timed(key, () => handler.call(this, event)) : null);
			},
		});
	}
}

if (target) {
	const frames: Frame[] = [];
	const inputs: Array<{ t: number; kind: string; scale?: number }> = [];
	const marks: Array<{ t: number; mark: string; ms?: number }> = [];
	let last = performance.now();
	const camera = () => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.e-]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(String((globalThis as { __decksCameraTransform?: () => string }).__decksCameraTransform?.() ?? ""));
		const stage = document.querySelector<HTMLElement>(".stage");
		return { zoom: m ? Number(m[3]) : 0, x: stage?.scrollLeft ?? 0, y: stage?.scrollTop ?? 0 };
	};
	const tick = (t: number) => {
		const cam = camera();
		const engine = (globalThis as { __decksEngine?: { stats: () => { tiles: number; pictures: number } } }).__decksEngine?.stats();
		const sheet = (globalThis as { __decksSheet?: { tiles?: number } }).__decksSheet;
		const top = [...frameWork].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, ms]) => `${Math.round(ms * 10) / 10} ${key}`);
		const busy = Math.round([...frameWork.values()].reduce((a, b) => a + b, 0) * 10) / 10;
		frameWork = new Map();
		frames.push({ t: Math.round(t), gap: Math.round((t - last) * 10) / 10, busy, top, ...cam, pages: document.querySelectorAll("iframe.plain-board-page").length, tiles: engine?.tiles ?? 0, sheet: sheet?.tiles ?? 0, pictures: engine?.pictures ?? 0 });
		last = t;
		nativeFrame(tick);
	};
	nativeFrame(tick);
	const note = (kind: string) => (event: Event) => inputs.push({ t: Math.round(performance.now()), kind, ...("scale" in event ? { scale: Math.round((event as { scale: number }).scale * 1000) / 1000 } : {}) });
	for (const kind of ["touchstart", "touchend", "gesturestart", "gestureend", "scrollend"]) window.addEventListener(kind, note(kind), { passive: true, capture: true });
	let moves = 0;
	window.addEventListener("touchmove", () => moves++, { passive: true, capture: true });
	window.addEventListener("gesturechange", note("gesturechange"), { passive: true, capture: true });
	/** Sent only to an address; `probe=1` keeps the gestures for an inspector and sends nothing. */
	const posting = /^https?:/.test(target);
	const send = () => {
		if (!posting) {
			frames.length = inputs.length = marks.length = 0;
			work.clear();
			return;
		}
		if (frames.length === 0 && inputs.length === 0) return;
		const batch = { at: Date.now(), ua: navigator.userAgent.slice(0, 60), w: innerWidth, h: innerHeight, dpr: devicePixelRatio, moves, frames: frames.splice(0), inputs: inputs.splice(0), marks: marks.splice(0), work: Object.fromEntries([...work].map(([k, [n, ms, max]]) => [k, [n, Math.round(ms * 10) / 10, Math.round(max * 10) / 10]])) };
		work.clear();
		moves = 0;
		void fetch(target, { method: "POST", body: JSON.stringify(batch), keepalive: true }).catch(() => {});
	};
	setInterval(send, 1000);
	/*
	 * `&autopilot=1`: the gestures, run by the page itself, for a device whose automation cannot lift a
	 * finger (Safari's WebDriver never ends a touch on this canvas). Pans are smooth scrolls of the
	 * stage, which the browser animates as it does a finger's; pinches are Safari's gesture events,
	 * handed to the stage's own pinch handlers.
	 */
	{
		const frame = () => new Promise<number>((done) => requestAnimationFrame(done));
		const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
		const stage = () => document.querySelector<HTMLElement>(".stage")!;
		const mark = (name: string, ms?: number) => marks.push({ t: Math.round(performance.now()), mark: name, ...(ms !== undefined ? { ms: Math.round(ms) } : {}) });
		const gesture = (type: string, scale: number) => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.assign(event, { scale, clientX: innerWidth / 2, clientY: innerHeight / 2 });
			stage().dispatchEvent(event);
		};
		const pinch = async (to: number, ms: number) => {
			const start = performance.now();
			gesture("gesturestart", 1);
			for (;;) {
				const t = Math.min(1, (performance.now() - start) / ms);
				gesture("gesturechange", 1 + (to - 1) * t);
				if (t >= 1) break;
				await frame();
			}
			gesture("gestureend", to);
			return performance.now() - start;
		};
		const pan = async (dx: number, dy: number) => {
			const start = performance.now();
			stage().scrollBy({ left: dx, top: dy, behavior: "smooth" });
			await new Promise<void>((done) => {
				const off = () => { stage().removeEventListener("scrollend", off); done(); };
				stage().addEventListener("scrollend", off);
				setTimeout(off, 3000);
			});
			return performance.now() - start;
		};
		/** The gestures, from the start: `__autopilot()` from an inspector, or `&autopilot=1` after the page settles. */
		const autopilot = async (settle = 0) => {
			await wait(settle);
			mark("pan-low");
			for (let i = 0; i < 4; i++) { mark("pan", await pan(1400, 600)); await wait(300); mark("pan", await pan(-1400, -600)); await wait(300); }
			await wait(1500);
			mark("pinch-in", await pinch(2.4, 800));
			await wait(3000);
			mark("pan-high");
			for (let i = 0; i < 4; i++) { mark("pan", await pan(1400, 600)); await wait(300); mark("pan", await pan(-1400, -600)); await wait(300); }
			await wait(1500);
			mark("pinch-cross");
			for (let i = 0; i < 3; i++) { mark("pinch-out", await pinch(0.55, 700)); await wait(1500); mark("pinch-in", await pinch(1.8, 700)); await wait(1500); }
			mark("rest");
			await wait(4000);
			mark("end");
		};
		(globalThis as { __autopilot?: unknown }).__autopilot = () => void autopilot();
		/** The steps one at a time, for an inspector recording each phase on its own. */
		(globalThis as { __pilot?: unknown }).__pilot = {
			pans: async (n: number) => {
				for (let i = 0; i < n; i++) { await pan(1400, 600); await wait(300); await pan(-1400, -600); await wait(300); }
			},
			pinch: (to: number, ms: number) => pinch(to, ms),
			cross: async (n: number) => {
				for (let i = 0; i < n; i++) { await pinch(0.55, 700); await wait(1500); await pinch(1.8, 700); await wait(1500); }
			},
		};
		if (new URLSearchParams(location.search).get("autopilot")) void autopilot(12000);
	}
	window.addEventListener("pagehide", send);
}

export {};
