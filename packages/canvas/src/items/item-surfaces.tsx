import { mountDocPage } from "@decks/docs/page";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { INTERACTIVE, scrollsInside } from "./card.ts";
import { canvasHost } from "../host.ts";
import { APPS, DEVICE } from "../render/device.ts";
import { scheme } from "../lib/theme.ts";

/**
 * The two items with no file of their own that the stage places as it places a card (`drawing.ts`'s
 * `itemKind`): a document, edited where it sits, and an app, opened in a tab of its own.
 */

/** What a press, a wheel or a key inside one of these is: the item's own, the way a card's is (`card-surface.tsx`). */
function ownEvents(host: HTMLElement, selected: () => boolean, onSelect: () => void): void {
	host.addEventListener("pointerdown", (event) => {
		if (event.pointerType === "touch") return;
		// A press on one of its own controls is that control's: selecting first would take the click it makes.
		const control = event.composedPath().some((target) => target instanceof Element && target.matches?.(INTERACTIVE));
		if (!control && !selected()) onSelect();
		event.stopPropagation();
	});
	for (const type of ["pointerup", "click", "dblclick", "contextmenu"]) host.addEventListener(type, (event) => (event as PointerEvent).pointerType !== "touch" && event.stopPropagation());
	host.addEventListener("wheel", (event) => !event.ctrlKey && scrollsInside(event.composedPath(), host, event.deltaX, event.deltaY) && event.stopPropagation(), { passive: true });
	for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (event) => event.stopPropagation());
}

/**
 * A document item (`decks.document`): the document editor (`@decks/docs/page`) in the item's place, its
 * messages carried by the host (`CanvasHost.documents`): in the canvas frame, to the harness on the
 * canvas's token, which answers them only for files a document item on that canvas names. Plain
 * elements, not a shadow root: it is the canvas's own code, and the text selection it follows is the page's.
 */
/**
 * The board tokens a dark board has (`board-host/lib/theme.css`, `[data-theme="dark"]`), as values: the
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
		ownEvents(host, () => props.selected, props.onSelect);
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

/** The apps running inside the canvas now, by surface: at most `APPS[DEVICE].live`, the selected one always. */
const [liveApps, setLiveApps] = createSignal<ReadonlySet<number>>(new Set());
let surfaces = 0;

/**
 * An app item (`decks.app`): the app's bar on the canvas, and below it the app itself, running in a
 * sandboxed iframe, where the host can open it here (`CanvasHost.apps.inCanvas`: on a canvas that is yours
 * alone, its pass in its address). It takes the pointer once the item is selected, as a card does once
 * entered; before that a press selects it and a wheel pans the canvas. Its cards' scripts may reach it:
 * they are yours. Elsewhere, or past the device's budget of running apps, it is the bar and Open, which
 * the host's page does in a tab of its own. The green light opens a tab either way.
 */
export function AppSurface(props: { app: string; selected: boolean; onSelect: () => void; ref?: () => void }) {
	let host!: HTMLDivElement;
	let frame: HTMLIFrameElement | undefined;
	const me = ++surfaces;
	const [about, setAbout] = createSignal<{ title?: string; status?: string }>();
	const [address, setAddress] = createSignal<{ url: string } | { tab: string }>();
	const open = () => canvasHost().apps?.open(props.app);
	const inCanvas = () => canvasHost().apps?.inCanvas;
	// Running here: once it has a place in the budget, kept until the item goes, so it never reloads under you.
	const live = () => liveApps().has(me);
	createEffect(() => {
		if (!inCanvas() || live()) return;
		const now = liveApps();
		if (props.selected || now.size < APPS[DEVICE].live) setLiveApps(new Set([...now, me]));
	});
	createEffect(() => {
		const ask = inCanvas();
		if (!live() || !ask || address()) return;
		void ask(props.app).then(setAddress);
	});
	// What the app saves in its browser storage (`decks-storage.js`), from its own iframe only.
	const onMessage = (event: MessageEvent) => {
		if (!frame || event.source !== frame.contentWindow) return;
		const data = event.data as { type?: unknown; key?: unknown; value?: unknown } | null;
		if (data?.type !== "decks-storage" || typeof data.key !== "string") return;
		canvasHost().apps?.store?.(props.app, data.key, typeof data.value === "string" ? data.value : null);
	};
	onMount(() => {
		props.ref?.();
		ownEvents(host, () => props.selected, props.onSelect);
		addEventListener("message", onMessage);
		void canvasHost()
			.apps?.status(props.app)
			.then((got) => setAbout(got ?? {}))
			.catch(() => setAbout({}));
	});
	onCleanup(() => {
		removeEventListener("message", onMessage);
		const now = new Set(liveApps());
		if (now.delete(me)) setLiveApps(now);
	});
	const url = () => {
		const got = address();
		return got && "url" in got ? got.url : undefined;
	};
	return (
		<div class="app-surface" ref={(element) => (host = element)} data-live={url() ? "true" : undefined} on:dblclick={() => !url() && open()}>
			{/* A window's title bar, as macOS draws one: the lights, the name in the middle, whether it runs. */}
			<div class="app-surface-bar">
				<span class="app-surface-lights">
					<span class="app-light" data-light="close" aria-hidden="true" />
					<span class="app-light" data-light="min" aria-hidden="true" />
					{/* The green one opens it in a tab, as a window's grows: a listener of its own, since the item keeps its presses from the canvas. */}
					<button type="button" class="app-light" data-light="zoom" title="Open in a tab" aria-label={`Open ${about()?.title ?? props.app} in a tab`} on:click={open} />
				</span>
				<span class="app-surface-title">{about()?.title ?? props.app}</span>
				<span class="app-surface-status" data-status={about()?.status ?? "unknown"}>
					{about()?.status ?? ""}
				</span>
			</div>
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
				/>
			</Show>
		</div>
	);
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
