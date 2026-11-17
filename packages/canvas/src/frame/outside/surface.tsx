import type { Accessor, Setter } from "solid-js";
import { createEffect, createSignal, on, onCleanup, Show, untrack, type JSX } from "solid-js";
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
	readonly startFrame: (frame: HTMLIFrameElement, canvas: string, cancelled: () => boolean) => (() => void);
	readonly end: Accessor<PageEnd | undefined>;
	readonly setEnd: Setter<PageEnd | undefined>;
	readonly options: FramedEditorOptions;
	readonly frameAt: Accessor<HTMLIFrameElement | undefined>;
	readonly setFrameAt: Setter<HTMLIFrameElement | undefined>;
}

export function createSurface(d: SurfaceNeeds) {
	/**
	 * The frame for the canvas on screen. Moving to another canvas ends the one it showed (its port, its
	 * pass's renewals) and either moves the same frame in place (`reset`, both canvases yours alone,
	 * `inPlace`), which keeps the code and the engine's module it loaded, or makes a new frame.
	 */
	const surface = (): JSX.Element => {
		d.keepInStep();
		/** Which frame is made: a new one each time this changes. */
		const [made, setMade] = createSignal<{ n: number } | undefined>();
		/** The canvas the frame shows, or is being started on. */
		let holds: string | undefined;
		/** Stops the canvas the frame shows now: its start, its port, its renewals. */
		let leave: (() => void) | undefined;
		const show = (frame: HTMLIFrameElement, canvas: string) => {
			leave?.();
			let cancelled = false;
			const stopWaiting = d.startFrame(frame, canvas, () => cancelled);
			leave = () => {
				cancelled = true;
				stopWaiting();
				d.end()?.close();
				d.setEnd(undefined);
			};
		};
		createEffect(
			on(
				() => d.options.canvasName?.(),
				(canvas) => {
					if (canvas === holds) return;
					const was = holds;
					holds = canvas;
					const frame = untrack(d.frameAt);
					if (canvas && was && frame && untrack(d.end) && d.options.frame.inPlace?.(was, canvas)) {
						show(frame, canvas);
						frame.contentWindow?.postMessage({ t: "reset" }, "*");
						return;
					}
					leave?.();
					leave = undefined;
					setMade(canvas ? { n: (untrack(made)?.n ?? 0) + 1 } : undefined);
				},
			),
		);
		onCleanup(() => leave?.());
		return (
			<Show when={made()} keyed>
				{(_made) => {
					onCleanup(() => d.setFrameAt(undefined));
					return (
						<iframe
							ref={(frame) => {
								d.setFrameAt(frame);
								if (holds) show(frame, holds);
							}}
							class="canvas-frame"
							title="Canvas"
							/*
							 * For the apps inside it (`AppSurface`), which can have no more than this frame has: what asks for no prompt and
							 * reaches nothing of Decks's (a popup stays sandboxed; autoplay lets a film play with sound after a click on the page).
							 * Never allow-same-origin, allow-popups-to-escape-sandbox, allow-top-navigation or payment and passkeys: an app is
							 * served from Decks's own address, so each would hand it Decks's page or your login.
							 */
							sandbox="allow-scripts allow-downloads allow-forms allow-modals allow-popups allow-pointer-lock allow-top-navigation-to-custom-protocols"
							allow="clipboard-read; clipboard-write; fullscreen; autoplay; picture-in-picture; screen-wake-lock; web-share; gamepad; encrypted-media; accelerometer; gyroscope; xr-spatial-tracking"
							src={frameAddress()}
							style={{ position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", display: "block" }}
						/>
					);
				}}
			</Show>
		);
	};

	return {
		surface,
	};
}
