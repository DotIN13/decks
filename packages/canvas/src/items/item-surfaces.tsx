import { mountDocPage } from "@decks/docs/page";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { ownInput } from "./input.ts";
import { APP_BAR } from "../render/types.ts";
import { canvasHost } from "../host.ts";
import { scheme } from "../lib/theme.ts";

/**
 * The two items with no file of their own that the stage places as it places a card (`drawing.ts`'s
 * `itemKind`): a document, edited where it sits, and an app, opened in a tab of its own.
 */

/**
 * A document item (`decks.document`): the document editor (`@decks/docs/page`) in the item's place, its
 * messages carried by the host (`CanvasHost.documents`): in the canvas frame, to the harness on the
 * canvas's token, which answers them only for files a document item on that canvas names. Plain
 * elements, not a shadow root: it is the canvas's own code, and the text selection it follows is the page's.
 */
/**
 * The board tokens a dark board has (`card-host/lib/theme.css`, `[data-theme="dark"]`), as values: the
 * document editor draws in `--b-*`, with light values as its fallbacks, and the frame's page defines none.
 */
const DARK_TOKENS: Record<string, string> = {
	"--b-bg": "#161616",
	"--b-bg-deep": "#0f0f0f",
	"--b-bg-layer": "#242424",
	"--b-fg": "#fafafa",
	"--b-muted": "#aeaeae",
	"--b-faint": "#808080",
	"--b-border": "rgb(255 255 255 / 12%)",
	"--b-border-strong": "rgb(255 255 255 / 24%)",
	"--b-accent-soft": "#1e2a52",
};

export function DocumentSurface(props: { file: string; selected: boolean; onSelect: () => void; ref?: () => void }) {
	let host!: HTMLDivElement;
	// In the canvas's scheme, as a card is (`card-surface.tsx`): its tokens on the item, dark or left to the light fallbacks.
	createEffect(() => {
		const dark = scheme() === "dark";
		for (const [name, value] of Object.entries(DARK_TOKENS)) {
			if (dark) host.style.setProperty(name, value);
			else host.style.removeProperty(name);
		}
		host.style.colorScheme = dark ? "dark" : "light";
		host.dataset.theme = dark ? "dark" : "light";
	});
	onMount(() => {
		props.ref?.();
		// A press, a wheel or a key inside the document: the one rule every awake item follows (`input.ts`).
		ownInput(host, host, { selected: () => props.selected, onSelect: props.onSelect });
		const line = canvasHost().documents;
		if (!line) {
			host.textContent = "Documents open in the canvas frame.";
			return;
		}
		const lib = line.lib;
		const page = mountDocPage(host, {
			path: props.file,
			send: (message) => line.send(message),
			listen: (listener) => line.listen(listener as (message: unknown) => void),
			...(line.file ? { file: line.file } : {}),
			...(lib ? { markdown: (into: HTMLElement, source: string) => markdown(lib, into, source), math: (into: HTMLElement) => maths(lib, into) } : {}),
		});
		onCleanup(() => page.destroy());
	});
	return <div class="document-surface" ref={(element) => (host = element)} style={{ width: "100%", height: "100%", overflow: "auto", background: "var(--b-bg, #fff)" }} />;
}

/** The app items whose window is showing the app itself, by item path: the others are drawn by the sheet as their pictures (`items-layer.tsx`). */
const [shownApps, setShownApps] = createSignal<ReadonlyMap<string, number>>(new Map());
export const appShowing = (path: string) => (shownApps().get(path) ?? 0) > 0;
const markShown = (path: string, on: boolean) =>
	setShownApps((was) => {
		const next = new Map(was);
		const count = (next.get(path) ?? 0) + (on ? 1 : -1);
		if (count > 0) next.set(path, count);
		else next.delete(path);
		return next;
	});

/**
 * An app item (`decks.app`): the app itself, running in a sandboxed iframe below the window bar the
 * engine paints (`engine.rs`, `paint_window`: the bar, lights, name and status, the same in every
 * state), where the host can open it here (`CanvasHost.apps.inCanvas`: on a canvas that is yours
 * alone, its pass in its address). Mounted only while the item is awake (`items/awake.ts`: near the
 * screen, within the device's budget of apps, or selected), and its picture on the sheet otherwise.
 * It takes the pointer once the item is selected, as a card does once entered; before that a press
 * selects it and a wheel pans the canvas. Its cards' scripts may reach it: they are yours. Where the
 * host cannot open it here, its body says so and offers Open, which the host's page does in a tab of
 * its own; the pill's New tab does the same.
 */
export function AppSurface(props: { app: string; path: string; visible: boolean; selected: boolean; onSelect: () => void; ref?: () => void }) {
	let host!: HTMLDivElement;
	let frame: HTMLIFrameElement | undefined;
	const [about, setAbout] = createSignal<{ title?: string; status?: string }>();
	const [address, setAddress] = createSignal<{ url: string } | { tab: string }>();
	const open = () => canvasHost().apps?.open(props.app);
	const inCanvas = () => canvasHost().apps?.inCanvas;
	// Running here whenever mounted: which apps are mounted is the chooser's (`items/awake.ts`), and a kept one stays until it is let go of.
	const live = () => !!inCanvas();
	createEffect(() => {
		const ask = inCanvas();
		if (!ask || address()) return;
		void ask(props.app).then(setAddress);
	});
	// What the app's own iframe says: what it saved in its browser storage, and a wheel it had no use for (`decks-canvas.js`).
	const onMessage = (event: MessageEvent) => {
		if (!frame || event.source !== frame.contentWindow) return;
		const data = event.data as { type?: unknown; key?: unknown; value?: unknown } | null;
		if (data?.type === "decks-wheel") return forwardWheel(frame, data as unknown as ForwardedWheel);
		if (data?.type !== "decks-storage" || typeof data.key !== "string") return;
		canvasHost().apps?.store?.(props.app, data.key, typeof data.value === "string" ? data.value : null);
	};
	// Whether it runs: read once, then heard from the harness as it changes (`apps.watch`), never polled.
	const readStatus = () =>
		void canvasHost()
			.apps?.status(props.app)
			.then((got) => setAbout(got ?? {}))
			.catch(() => setAbout((was) => was ?? {}));
	let unwatch: (() => void) | undefined;
	onMount(() => {
		props.ref?.();
		unwatch = canvasHost().apps?.watch?.(props.app, (state) => setAbout((was) => ({ ...was, ...state })));
		/*
		 * The same rule on the window's bar and body (`input.ts`); the app's own page inside the iframe is the
		 * exception, by choice: it takes the pointer only once the item is selected (`pointer-events` below),
		 * so a press on an unselected app selects it first, and the next one is the app's.
		 */
		ownInput(host, host, { selected: () => props.selected, onSelect: props.onSelect });
		addEventListener("message", onMessage);
		readStatus();
	});
	// The window shows the app once its frame has loaded; until then, and when it runs elsewhere, the sheet shows its picture.
	let saidShown = false;
	const [loaded, setLoaded] = createSignal(false);
	createEffect(() => {
		const on = !!url() && loaded();
		if (on === saidShown) return;
		saidShown = on;
		markShown(props.path, on);
		if (on) readStatus();
	});
	onCleanup(() => {
		unwatch?.();
		if (saidShown) markShown(props.path, false);
		removeEventListener("message", onMessage);
	});
	const url = () => {
		const got = address();
		return got && "url" in got ? got.url : undefined;
	};
	return (
		<div class="app-surface" ref={(element) => (host = element)} data-live={url() ? "true" : undefined} style={{ top: `${APP_BAR}px` }} on:dblclick={() => !url() && open()}>
			<Show
				when={url()}
				fallback={
					<div class="app-surface-body">
						<Show when={canvasHost().apps} fallback={<p>This app opens from the Decks app.</p>}>
							<p>{(() => {
								const got = address();
								if (got && "tab" in got) return got.tab;
								if (live()) return `Opening ${about()?.title ?? props.app}…`;
								return `${about()?.title ?? props.app} runs in a tab of its own.`;
							})()}</p>
							<button type="button" class="app-surface-open" on:click={open}>
								Open
							</button>
						</Show>
					</div>
				}
			>
				<iframe
					ref={(element) => (frame = element)}
					class="app-surface-frame"
					title={about()?.title ?? props.app}
					src={url()}
					sandbox="allow-scripts allow-forms allow-modals allow-downloads"
					allow="clipboard-read; clipboard-write; fullscreen"
					style={{ "pointer-events": props.selected ? "auto" : "none" }}
					on:load={() => setLoaded(true)}
				/>
			</Show>
		</div>
	);
}

/** A wheel the app's page could not scroll with, as `decks-canvas.js` hands it up: the app page's viewport pixels. */
type ForwardedWheel = { dx: number; dy: number; mode?: number; x: number; y: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };

/**
 * A wheel from inside an app's iframe, replayed on the stage where the pointer is: the canvas pans or
 * zooms with it as it does over a card whose insides cannot scroll (`input.ts`, `ownInput`). The point
 * is the app page's, turned into the frame's through the iframe's box on the screen, which is scaled by
 * the camera's zoom.
 */
function forwardWheel(frame: HTMLIFrameElement, wheel: ForwardedWheel): void {
	const stage = frame.closest(".stage") ?? document.querySelector(".stage");
	if (!stage) return;
	const box = frame.getBoundingClientRect();
	const scale = frame.clientWidth > 0 ? box.width / frame.clientWidth : 1;
	const clientX = box.left + Number(wheel.x || 0) * scale;
	const clientY = box.top + Number(wheel.y || 0) * scale;
	stage.dispatchEvent(new WheelEvent("wheel", { deltaX: Number(wheel.dx) || 0, deltaY: Number(wheel.dy) || 0, deltaMode: Number(wheel.mode) || 0, clientX, clientY, ctrlKey: !!wheel.ctrlKey, metaKey: !!wheel.metaKey, shiftKey: !!wheel.shiftKey, bubbles: true, cancelable: true }));
}

const scripts = new Map<string, Promise<void>>();
/** A classic script from `lib/`, once for the page: the UMD builds set a global. */
function script(lib: string, name: string): Promise<void> {
	const href = new URL(name, lib).href;
	let got = scripts.get(href);
	if (!got) {
		got = new Promise<void>((resolve, reject) => {
			const tag = document.createElement("script");
			tag.src = href;
			tag.onload = () => resolve();
			tag.onerror = () => reject(new Error(`${name} did not load`));
			document.head.append(tag);
		});
		scripts.set(href, got);
	}
	return got;
}

async function markdown(lib: string, into: HTMLElement, source: string): Promise<void> {
	await script(lib, "marked.umd.js");
	const marked = (window as unknown as { marked: { parse(text: string, o: unknown): string } }).marked;
	into.innerHTML = marked.parse(source, { gfm: true, breaks: false });
	await maths(lib, into);
}

async function maths(lib: string, into: HTMLElement): Promise<void> {
	if (!/\$|\\\(|\\\[/.test(into.textContent ?? "")) return;
	const href = new URL("katex.min.css", lib).href;
	if (!document.querySelector(`link[href="${href}"]`)) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
	await script(lib, "katex.min.js");
	await script(lib, "katex-auto-render.min.js");
	(window as unknown as { renderMathInElement?: (el: Element, options: unknown) => void }).renderMathInElement?.(into, {
		delimiters: [
			{ left: "$$", right: "$$", display: true },
			{ left: "$", right: "$", display: false },
			{ left: "\\(", right: "\\)", display: false },
			{ left: "\\[", right: "\\]", display: true },
		],
		throwOnError: false,
	});
}
