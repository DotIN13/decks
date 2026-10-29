import { mountDocPage } from "@decks/docs/page";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { scrollsInside } from "./card.ts";
import { canvasHost } from "./host.ts";

/**
 * The two items with no file of their own that the stage places as it places a card (`drawing.ts`'s
 * `itemKind`): a document, edited where it sits, and an app, opened in a tab of its own.
 */

/** What a press, a wheel or a key inside one of these is: the item's own, the way a card's is (`card-surface.tsx`). */
function ownEvents(host: HTMLElement, selected: () => boolean, onSelect: () => void): void {
	host.addEventListener("pointerdown", (event) => {
		if (event.pointerType === "touch") return;
		if (!selected()) onSelect();
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
export function DocumentSurface(props: { file: string; selected: boolean; onSelect: () => void; ref?: () => void }) {
	let host!: HTMLDivElement;
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

/**
 * An app item (`decks.app`): the app's bar on the canvas, and Open, which the host's page does in a tab
 * of its own (`CanvasHost.apps`). An app with a server can do what its server does, so nothing on the
 * canvas reaches it: not the frame, and not a card's script beside it.
 */
export function AppSurface(props: { app: string; selected: boolean; onSelect: () => void; ref?: () => void }) {
	let host!: HTMLDivElement;
	const [about, setAbout] = createSignal<{ title?: string; status?: string }>();
	const open = () => canvasHost().apps?.open(props.app);
	onMount(() => {
		props.ref?.();
		ownEvents(host, () => props.selected, props.onSelect);
		void canvasHost()
			.apps?.status(props.app)
			.then((got) => setAbout(got ?? {}))
			.catch(() => setAbout({}));
	});
	return (
		<div class="app-surface" ref={(element) => (host = element)} on:dblclick={open}>
			<div class="app-surface-bar">
				<span class="app-surface-dot" data-status={about()?.status ?? "unknown"} />
				<b>{about()?.title ?? props.app}</b>
				<span class="app-surface-status">{about()?.status ?? ""}</span>
			</div>
			<div class="app-surface-body">
				<Show when={canvasHost().apps} fallback={<p>This app opens from the Decks app.</p>}>
					<p>{about()?.title ?? props.app} runs in a tab of its own.</p>
					{/* A listener of its own: the item keeps its presses from the canvas, so a page-wide one would never hear it. */}
					<button type="button" class="app-surface-open" on:click={open}>
						Open
					</button>
				</Show>
			</div>
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
