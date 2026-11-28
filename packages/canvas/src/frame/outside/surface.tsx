import { ALLOW, SANDBOX, spareFrame } from "@decks/frame";
import { getLocale, m } from "@decks/i18n";
import type { Accessor, Setter } from "solid-js";
import { createEffect, createSignal, For, on, onCleanup, untrack, type JSX } from "solid-js";
import { type PageEnd } from "../protocol.ts";
import { type FramedEditorOptions, } from "./host.tsx";
import { keepForFrames } from "./kept.ts";
import { scheme } from "../../base/theme.ts";
import { chooseFrame, type Held } from "./held.ts";

const frameAddress = (): string => {
	const page = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
	const passed = new URLSearchParams();
	for (const name of PASSED_ON) if (page.has(name)) passed.set(name, page.get(name)!);
	// Which kind this frame is for, so its code is asked for at once (`inside/frame.tsx`).
	passed.set("kind", "canvas");
	// The page's language, which a sandboxed frame cannot read for itself (`canvas-frame.html` keeps it).
	passed.set("lang", getLocale());
	// And its light or dark, so the frame's first paint is the canvas's ground, not a white page (`canvas-frame.html`).
	passed.set("scheme", untrack(scheme));
	return `/canvas-frame.html?${passed.toString()}`;
};

/**
 * The frame's address, with the page's measuring parameters passed on: the frame probe (`?probe=<collector>`,
 * the app's `perf/probe.ts`) and its companions, and the device, engine, picture and card-picture overrides (`render/device.ts`,
 * `view/items-layer.tsx`), run in the frame, where the canvas is.
 */
const PASSED_ON = ["probe", "handlers", "autopilot", "pictures-per-frame", "picture-mb", "skip-levels", "device", "pictures", "card-pictures", "engine", "tiles"];

/** What `createSurface` reads of `createFramedEditor` (`host.tsx`), each read when it is used. */
export interface SurfaceNeeds {
	readonly keepInStep: () => void;
	readonly startFrame: (frame: HTMLIFrameElement, canvas: string, cancelled: () => boolean, started: (page: PageEnd, selected: string | undefined) => void, said?: boolean) => (() => void);
	readonly end: Accessor<PageEnd | undefined>;
	/** Make a frame's line the one the page talks on, or none: `again` when that frame was in front before (`host.tsx`, `attach`). */
	readonly attach: (page: PageEnd | undefined, how: { again: boolean; selected?: string | undefined }) => void;
	readonly options: FramedEditorOptions;
	readonly frameAt: Accessor<HTMLIFrameElement | undefined>;
	readonly setFrameAt: Setter<HTMLIFrameElement | undefined>;
}

/** How long after the page has gone quiet a spare frame is made: not while the canvas on screen is still loading what it needs. */
const SPARE_AFTER_MS = 1500;

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
	 * - else the spare frame takes it, when the page keeps one (`FrameHostOptions.spare`): a frame made
	 *   a moment after the page went quiet, its code loaded and its drawing engine started, on no canvas;
	 * - else a new frame is made.
	 *
	 * Every other frame nothing wants is taken off the page. The frame in front is `iframe.canvas-frame`;
	 * one kept behind is `iframe.canvas-frame-kept`, hidden but not taken out of the layout, so it
	 * keeps its size and is drawn as it was the moment it shows.
	 */
	const surface = (): JSX.Element => {
		d.keepInStep();
		// What never changes is fetched once by this page for all its frames (`kept.ts`).
		keepForFrames();
		const [held, setHeld] = createSignal<Held[]>([]);
		const [front, setFront] = createSignal<Held>();
		/** The frame kept spare, on no canvas: on the page beside the others, out of sight. */
		const [spare, setSpare] = createSignal<Held>();
		let made = 0;

		/** The page talks on this frame's line now, or on none while it has not started. */
		const bring = (one: Held | undefined, selected?: string) => {
			d.setFrameAt(one?.frame);
			d.attach(one?.end, { again: one?.seen === true, selected });
			if (one?.end) one.seen = true;
		};
		/** Start a frame on its canvas, ending what it showed before. */
		const start = (one: Held) => {
			if (!one.frame || one.canvas === undefined) return;
			one.leave?.();
			let cancelled = false;
			delete one.seen;
			// A frame that was the spare has said hello with nobody starting it, or will: heard either way.
			const said = one.waiting?.said() === true;
			one.waiting?.stop();
			delete one.waiting;
			const stopWaiting = d.startFrame(one.frame, one.canvas, () => cancelled, (page, selected) => {
				one.end = page;
				if (untrack(front) === one) bring(one, selected);
			}, said);
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
					const { next, how, gone } = chooseFrame({ held: all, front: was, spare: untrack(spare), canvas, kept, inPlace: (from, to) => d.options.frame.inPlace?.(from, to) === true, make: (on) => ({ n: ++made, canvas: on }) });
					const moved = how === "moved" ? next : undefined;
					if (next && canvas && (how === "moved" || how === "spare")) {
						// The spare has its code loaded and its engine started, so it begins at once; a frame moved in place ends the canvas it showed first.
						if (how === "spare") setSpare(undefined);
						next.canvas = canvas;
						start(next);
						if (how === "moved") next.frame!.contentWindow?.postMessage({ t: "reset" }, "*");
					}
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
		/*
		 * The spare: made once the frame in front has started and the page has been quiet a moment, and
		 * again a moment after one was taken, so starting it never competes with the canvas being opened.
		 */
		createEffect(() => {
			if (!d.options.frame.spare?.() || spare() || !d.end()) return;
			const timer = setTimeout(() => {
				const idle = (globalThis as { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
				const make = () => untrack(spare) === undefined && setSpare({ n: ++made, canvas: undefined });
				if (idle) idle(make, { timeout: 2000 });
				else make();
			}, SPARE_AFTER_MS);
			onCleanup(() => clearTimeout(timer));
		});
		onCleanup(() => {
			for (const one of untrack(held)) one.leave?.();
			untrack(spare)?.waiting?.stop();
		});
		return (
			<For each={[...held(), ...(spare() ? [spare()!] : [])]}>
				{(one) => (
					<iframe
						ref={(frame) => {
							one.frame = frame;
							if (untrack(front) === one) d.setFrameAt(frame);
							if (one.canvas === undefined) one.waiting = spareFrame(frame);
							else start(one);
						}}
						class={front() === one ? "canvas-frame" : one.canvas === undefined && spare() === one ? "canvas-frame-spare" : "canvas-frame-kept"}
						title={m.canvas_frame_title()}
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
