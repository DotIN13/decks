import { createResource, createSignal, Match, onCleanup, onMount, Switch } from "solid-js";
import { Markdown } from "../chat/Markdown.tsx";
import { enterFullscreen, exitFullscreen, onFullscreenLeft } from "./fullscreen.ts";
import { embedFamily, embedUrl, pdfUrl } from "../lib/api.ts";

/**
 * One embed, filling the window.
 *
 * An **embed** is a file drawn inside a box on a board — a PDF, an image, a page from
 * somewhere else, a markdown file. It has no address of its own: the board has one, and the
 * box inside it does not. This is that address, mounted as an overlay, and it is the app's
 * job rather than the board's for two reasons:
 *
 * - **The gesture has to belong to the app.** Selecting a box and pressing a button in the
 *   inspector is an app-side affordance, so a board's author does not have to remember to
 *   put one in the markup (`canvas/Inspector.tsx`).
 * - **Foreign content cannot fullscreen itself.** A page from somewhere else sits in a
 *   sandboxed, opaque-origin frame, so `requestFullscreen` in there is refused — always —
 *   which `Present.tsx` already names as the reason it is an overlay first.
 *
 * ### The same families, drawn by the app
 *
 * Six, and `lib/board.js` decides them from the extension of the path the *board* wrote.
 * `lib/api.ts` reads it the same way, and the two ladders have to agree: the overlay and the
 * box are drawing the same file, and two answers to "what is this" is how a fullscreen shows
 * something the board does not.
 *
 * | family | how it is drawn |
 * |---|---|
 * | image | the image, fit to the window |
 * | pdf | the file in the browser's own viewer, with the box's `data-pages` carried as `#page=` |
 * | html | a sandboxed frame on the file's own URL — the same `allow-scripts` and no referrer the board uses |
 * | md | fetched and rendered here, in a document-width column, because a raw `.md` in a frame is plain text |
 * | text | fetched and shown as text |
 * | file | nothing to draw: the name and the file |
 *
 * The PDF row is the one with a decision in it. The board draws pages as pictures through
 * pdf.js; here the file goes to Chrome's own viewer, which is a better viewer than we have
 * (search, zoom, print) and takes the page range as a fragment. A fullscreen that showed the
 * *wrong pages* would be worse than no fullscreen, so the range travels.
 *
 * ### The way out
 *
 * Escape, from wherever the focus is — which needs the listener on the frame's own document
 * as well as on this window, because a keystroke inside a frame never reaches the app. That
 * works for every family whose frame is same-origin; a sandboxed foreign page is the one place
 * it cannot, and there the bar's own button is the way out. Which is honest rather than
 * convenient: being able to click and type inside that page is the reason it is mounted at all.
 */
export function PresentEmbed(props: {
	/** The board the box is on, which is what a relative path is relative to. */
	board: string;
	/** What the box says: `data-embed`, exactly as the file has it. */
	raw: string;
	/** The box's `data-pages`, for the one family where a range means something. */
	pages?: string;
	title: string;
	onExit: () => void;
}) {
	let layerEl: HTMLDivElement | undefined;
	let frameEl: HTMLIFrameElement | undefined;
	const [idle, setIdle] = createSignal(true);

	const family = () => embedFamily(props.raw);
	const url = () => embedUrl(props.board, props.raw);
	/** The bytes, for the two families the app draws itself. */
	const [text] = createResource(
		() => (family() === "md" || family() === "text" ? url() : undefined),
		async (target: string) => {
			const response = await fetch(target);
			if (!response.ok) throw new Error(`${response.status}`);
			return response.text();
		},
	);

	/**
	 * Once, whichever comes first.
	 *
	 * There are three ways out and two of them can arrive together: the person presses Escape
	 * and we call `exitFullscreen`, whose `fullscreenchange` then arrives *after* this has
	 * already run. A flag rather than trusting the order.
	 */
	let left = false;
	const leave = () => {
		if (left) return;
		left = true;
		exitFullscreen(document);
		props.onExit();
	};

	const act = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		leave();
	};

	/*
	 * The chrome hides until the pointer moves, exactly as a deck's does — this is the same
	 * surface in a different mood, and a permanent button on a fullscreen page is furniture.
	 */
	let wakeTimer: number | undefined;
	const wake = () => {
		setIdle(false);
		clearTimeout(wakeTimer);
		wakeTimer = window.setTimeout(() => setIdle(true), 2000);
	};

	let frameListeners: (() => void) | undefined;
	const listenInFrame = () => {
		const doc = frameEl?.contentDocument;
		// `null` for the sandboxed page: an opaque origin is not reachable from here, which is
		// the point of it, so Escape from inside relies on the bar (see the note above).
		if (!doc) return;
		doc.addEventListener("keydown", act, true);
		doc.addEventListener("pointermove", wake);
		frameListeners = () => {
			doc.removeEventListener("keydown", act, true);
			doc.removeEventListener("pointermove", wake);
		};
	};

	onMount(() => {
		layerEl?.focus();
		enterFullscreen(layerEl);
		window.addEventListener("keydown", act, true);
		window.addEventListener("pointermove", wake);
		/*
		 * And the way out that produces no keystroke at all: the browser leaving fullscreen by
		 * itself. Chrome takes Escape for that and never dispatches it here, which is why the
		 * overlay used to need a second press (`canvas/fullscreen.ts`).
		 */
		onCleanup(onFullscreenLeft(document, leave));
		onCleanup(() => {
			window.removeEventListener("keydown", act, true);
			window.removeEventListener("pointermove", wake);
			frameListeners?.();
			clearTimeout(wakeTimer);
		});
	});

	return (
		<div class="present embed-present" data-idle={idle()} data-family={family()} tabIndex={-1} ref={(el) => (layerEl = el)} role="dialog" aria-label={`${props.title} — fullscreen`}>
			<Switch>
				<Match when={family() === "image"}>
					<img class="present-image" src={url()} alt={props.title} />
				</Match>
				{/*
				 * The browser's viewer, and the page range as a fragment. `#page=` is the one
				 * thing Chrome's own viewer reads from a URL, and it is why the range travels
				 * with the address rather than being a property of the board's box.
				 */}
				<Match when={family() === "pdf"}>
					<iframe class="present-frame" title={props.title} src={pdfUrl(url(), props.pages)} ref={(el) => { frameEl = el; el.addEventListener("load", listenInFrame); }} />
				</Match>
				<Match when={family() === "html"}>
					<iframe
						class="present-frame"
						title={props.title}
						src={url()}
						sandbox="allow-scripts"
						referrerpolicy="no-referrer"
						ref={(el) => { frameEl = el; el.addEventListener("load", listenInFrame); }}
					/>
				</Match>
				<Match when={family() === "md"}>
					<div class="present-doc">{text() === undefined ? <p class="muted">loading…</p> : <Markdown text={text() ?? ""} />}</div>
				</Match>
				<Match when={family() === "text"}>
					<pre class="present-text">{text() ?? ""}</pre>
				</Match>
				{/*
				 * Which family is left? A file the browser will not draw — a zip, a sketch, a
				 * name with no extension. There is nothing to fill a window with, so this says
				 * what it is and offers the bytes rather than showing a blank frame.
				 */}
				<Match when={true}>
					<div class="present-file">
						<span class="name">{props.raw.split("/").pop()}</span>
						<a href={url()} download={props.raw.split("/").pop() ?? "file"}>
							download
						</a>
					</div>
				</Match>
			</Switch>
			<div class="present-bar">
				<button type="button" class="present-exit" onClick={leave} aria-label="Leave fullscreen">
					Esc
				</button>
			</div>
		</div>
	);
}
