import { ALLOW, SANDBOX } from "@decks/frame";
import type { Accessor, Setter } from "solid-js";
import { createEffect, createSignal, For, on, onCleanup, untrack, type JSX } from "solid-js";
import { type PageEnd } from "../protocol.ts";
import { type FramedEditorOptions, } from "./host.tsx";

const frameAddress = (): string => {
	const page = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
	const passed = new URLSearchParams();
	for (const name of PASSED_ON) if (page.has(name)) passed.set(name, page.get(name)!);
	const query = passed.toString();
	return query ? `/canvas-frame.html?${query}` : "/canvas-frame.html";
};

/**
 * The frame's address, with the page's measuring parameters passed on: the frame probe (`?probe=<collector>`,
 * the app's `perf/probe.ts`) and its companions, and the device, engine, picture and card-picture overrides (`render/device.ts`,
 * `stage/items-layer.tsx`), run in the frame, where the stage is.
 */
const PASSED_ON = ["probe", "handlers", "autopilot", "pictures-per-frame", "picture-mb", "skip-levels", "device", "pictures", "card-pictures", "engine", "tiles"];

/** What `createSurface` reads of `createFramedEditor` (`host.tsx`), each read when it is used. */
export interface SurfaceNeeds {
	readonly keepInStep: () => void;
	readonly startFrame: (frame: HTMLIFrameElement, canvas: string, cancelled: () => boolean, started: (page: PageEnd, selected: string | undefined) => void) => (() => void);
	readonly end: Accessor<PageEnd | undefined>;
	/** Make a frame's line the one the page talks on, or none: `again` when that frame was in front before (`host.tsx`, `attach`). */
	readonly attach: (page: PageEnd | undefined, how: { again: boolean; selected?: string | undefined }) => void;
	readonly options: FramedEditorOptions;
	readonly frameAt: Accessor<HTMLIFrameElement | undefined>;
	readonly setFrameAt: Setter<HTMLIFrameElement | undefined>;
}

/** One frame the page holds, and the canvas it shows or is being started on. */
interface Held {
	/** Which frame this is, for as long as it is on the page. */
	n: number;
	canvas: string;
	frame?: HTMLIFrameElement;
	/** The page's end of its line, once it has started on this canvas. */
	end?: PageEnd;
	/** Its line has been the page's before: coming forward again, it is told what changed while it was behind. */
	seen?: true;
	/** Stops the canvas it shows now: its start, its port, its renewals. */
	leave?: () => void;
}

export function createSurface(d: SurfaceNeeds) {
	/**
	 * The frames for the canvas on screen and the canvases kept behind it (`FrameHostOptions.kept`).
	 *
	 * A frame is a canvas ready to look at: its code loaded, its drawing engine running, its drawing,
	 * its cards and their pictures in hand, its line to the harness open. Making one takes a second or
	 * so from a far device, so the page keeps the frames of the canvases it is told to, out of sight,
	 * each still following its canvas, and coming back to one is showing it.
	 *
	 * When the canvas on screen changes:
	 *
	 * - a frame already held for it comes forward, and the one that was in front goes behind;
	 * - else a frame nothing wants any more, neither on screen nor kept, moves to it in place (`reset`,
	 *   both canvases yours alone, `inPlace`): it ends the canvas it showed and keeps the code and the
	 *   engine's module it loaded. With nothing kept this is every move, as it was before frames were kept;
	 * - else a new frame is made.
	 *
	 * Every other frame nothing wants is taken off the page. The frame in front is `iframe.canvas-frame`;
	 * one kept behind is `iframe.canvas-frame-kept`, hidden but not taken out of the layout, so it
	 * keeps its size and is drawn as it was the moment it shows.
	 */
	const surface = (): JSX.Element => {
		d.keepInStep();
		const [held, setHeld] = createSignal<Held[]>([]);
		const [front, setFront] = createSignal<Held>();
		let made = 0;

		/** The page talks on this frame's line now, or on none while it has not started. */
		const bring = (one: Held | undefined, selected?: string) => {
			d.setFrameAt(one?.frame);
			d.attach(one?.end, { again: one?.seen === true, selected });
			if (one?.end) one.seen = true;
		};
		/** Start a frame on its canvas, ending what it showed before. */
		const start = (one: Held) => {
			if (!one.frame) return;
			one.leave?.();
			let cancelled = false;
			delete one.seen;
			const stopWaiting = d.startFrame(one.frame, one.canvas, () => cancelled, (page, selected) => {
				one.end = page;
				if (untrack(front) === one) bring(one, selected);
			});
			one.leave = () => {
				cancelled = true;
				stopWaiting();
				const page = one.end;
				one.end = undefined;
				if (page && untrack(d.end) === page) d.attach(undefined, { again: false });
				page?.close();
			};
		};
		/** A frame going behind holds no selection: what was selected is the page's to keep with the view it parks, and to give back. */
		const park = (one: Held) => one.end?.emit("select", { ids: [] });
		/*
		 * The frames behind know which chat is on screen too, as the one in front is told (`sync.ts`): the
		 * agent of that chat showing something on a canvas kept behind moves that canvas's view at once,
		 * out of sight, and it is there when the canvas comes forward (`wire.ts` keeps it for the page).
		 */
		createEffect(() => {
			const agent = d.options.frame.focused?.();
			if (agent === undefined) return;
			for (const one of untrack(held)) if (one !== untrack(front)) one.end?.emit("look", { agent });
		});

		createEffect(
			on(
				() => [d.options.canvasName?.(), d.options.frame.kept?.() ?? []] as const,
				([canvas, kept]) => {
					const was = untrack(front);
					const all = untrack(held);
					const wanted = new Set<string>(canvas ? [canvas, ...kept] : kept);
					const spare = all.filter((one) => !wanted.has(one.canvas));
					let next = canvas ? all.find((one) => one.canvas === canvas) : undefined;
					let moved: Held | undefined;
					if (canvas && !next) {
						// The one that was in front first: its place on the page is where the eye is.
						moved = [...spare].sort((a, b) => Number(b === was) - Number(a === was)).find((one) => one.frame && one.end && d.options.frame.inPlace?.(one.canvas, canvas));
						if (moved) {
							moved.canvas = canvas;
							start(moved);
							moved.frame!.contentWindow?.postMessage({ t: "reset" }, "*");
							next = moved;
						} else next = { n: ++made, canvas };
					}
					const gone = spare.filter((one) => one !== moved);
					for (const one of gone) one.leave?.();
					const now = [...all.filter((one) => !gone.includes(one)), ...(next && !all.includes(next) ? [next] : [])];
					if (now.length !== all.length || now.some((one, at) => one !== all[at])) setHeld(now);
					if (next === was) return;
					if (was && was !== moved && now.includes(was)) park(was);
					setFront(next);
					// The keyboard goes with what is on screen: a frame behind would go on taking keys nobody sees land.
					const focused = was?.frame && document.activeElement === was.frame;
					bring(next);
					if (focused) next?.frame?.focus({ preventScroll: true });
				},
			),
		);
		onCleanup(() => {
			for (const one of untrack(held)) one.leave?.();
		});
		return (
			<For each={held()}>
				{(one) => (
					<iframe
						ref={(frame) => {
							one.frame = frame;
							if (untrack(front) === one) d.setFrameAt(frame);
							start(one);
						}}
						class={front() === one ? "canvas-frame" : "canvas-frame-kept"}
						title="Canvas"
						/* What every frame may do, and why no more (`@decks/frame`, `sandbox.ts`): the apps inside this one can have no more than it has. */
						sandbox={SANDBOX}
						allow={ALLOW}
						src={frameAddress()}
						style={{ position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", display: "block", visibility: front() === one ? undefined : "hidden", "pointer-events": front() === one ? undefined : "none" }}
					/>
				)}
			</For>
		);
	};

	return {
		surface,
	};
}
