import { createSignal, onCleanup, onMount } from "solid-js";
import type { BoardPatch } from "@decks/protocol";
import { diffBlocks, type EditBlock } from "./block-edits.ts";

/**
 * A flow document, edited as a document — and saved as ops, not as a file.
 *
 * The whole design is on `boards/editing-a-flow-document-properly-not-as-source`, and the one
 * sentence worth repeating is this: **GrapesJS is the surface a person types on, and
 * `patch.ts` is still the thing that writes.** Nothing here serialises a document. The editor's
 * change events are mapped to the ops that already exist, an untouched byte cannot be reached by
 * a splice, and that is what keeps line breaks, HTML comments and an agent's line numbers intact
 * — where writing the whole file turned 383 lines into 225 and moved every line number in it.
 *
 * ### Three things this file is careful about, all of them measured rather than reasoned about
 *
 * **Read the model, never the element.** The canvas DOM is full of GrapesJS's own furniture —
 * `data-gjs-*`, `draggable`, a minted `id` on every component — and none of it is in the file.
 * `toHTML()` on the model gives back the markup as it was written. The same rule keeps rendered
 * panels out of the file: `board.js` draws a `[data-md]` inside the canvas and the model still
 * holds the markdown, so the two cannot leak into each other.
 *
 * **The snapshot is the model's own serialisation, not the file's bytes.** They differ about
 * whitespace, and that is fine — what matters is that a block nobody touched serialises to
 * exactly what it serialised to when the editor opened, so an untouched document produces *no
 * ops at all* rather than a reformatting diff. Captured at load, compared at commit.
 *
 * **GrapesJS's own canvas.** `board.css` and `board.js` go into it, from `/api/board/lib/` —
 * not `/lib/`, which this server answers with the app's `index.html`. With the right URL a
 * `[data-md]` panel renders in the editor while the model stays clean, so rendering panels and
 * keeping generated content out of the file are not in tension.
 *
 * ### What it refuses
 *
 * Only what `diffBlocks` cannot describe — today that is a payload with two blocks claiming one
 * identity, which the editor cannot produce. A reorder is **not** one of them and used to be:
 * dragging a paragraph past another was read as inexpressible and the file offered in its place,
 * which is what `move-child` was built for. Nothing is reordered by rewriting the document; the
 * op set either describes the edit or the edit is refused, and offering the bytes in the same
 * breath is for the cases that are left.
 *
 * Reachable at any zoom, because the way in is the button in the board's bar rather than a
 * gesture on the board — and the canvas keeps its pointer events whatever the camera is doing,
 * so an editor opened at a fitted deck is still something you can type into.
 */
export function GrapesEditor(props: {
	path: string;
	/** The file's own text, read from the server: the root is found here and nowhere else. */
	source: string;
	/** The board's own size, so the editor is exactly the board it is standing in for. */
	w: number;
	h: number;
	onPatches: (patches: BoardPatch[]) => void;
	/** Refused: hand the bytes over instead. */
	onSource: () => void;
	onCancel: () => void;
}) {
	const [refusals, setRefusals] = createSignal<string[]>([]);
	const [ready, setReady] = createSignal(false);
	let host: HTMLDivElement | undefined;
	let panel: HTMLDivElement | undefined;
	/** The retry that names the canvas frame and keeps it the board's page. Cleared when the editor goes. */
	let naming: ReturnType<typeof setInterval> | undefined;
	/**
	 * One observer per canvas document, watching it while GrapesJS is still building it.
	 *
	 * The interval alone is too slow to be *right*: GrapesJS writes its frame's document more
	 * than once, and between the write and the next tick the document is an undressed page — the
	 * class without `flow`, the 1200px default width. A reader would call that a flicker; a check
	 * read it as a failure, once, which is how this was found. The observer fires on the write
	 * itself, so the page is dressed in the same turn.
	 */
	const watchers: MutationObserver[] = [];
	const watched = new WeakSet<Document>();
	const bound = new WeakSet<HTMLIFrameElement>();
	/** GrapesJS's editor, once it has loaded. */
	let editor: { destroy(): void } | undefined;
	/** Everything the commit needs, filled in when the editor is built. */
	let commit: () => void = () => {};
	let cancel: () => void = () => {};

	/*
	 * `settled` guards the same double-run `SourceEditor` guards: Escape moves the focus, which
	 * fires the click-outside handler, which would commit the very edit Escape was abandoning.
	 */
	let settled = false;
	const finish = (act: () => void) => {
		if (settled) return;
		settled = true;
		act();
	};

	onMount(() => {
		let stopped = false;
		onCleanup(() => {
			stopped = true;
			/*
			 * `destroy` off, and the container emptied by hand as well.
			 *
			 * GrapesJS removes its own chrome on destroy but leaves the canvas frame it made
			 * inside the container — and because the container is this component's own div, what
			 * came out was two editor frames on the second open: the new one with the document in
			 * it, and a stale one beside it that the canvas's own lookups could find first. The
			 * empty box was the visible half; the invisible half is a frame nobody destroys.
			 */
			if (naming) clearInterval(naming);
			for (const watcher of watchers) watcher.disconnect();
			watchers.length = 0;
			editor?.destroy();
			if (host) host.innerHTML = "";
			host = undefined;
		});

		void (async () => {
			try {
				await start();
			} catch (error) {
				/*
				 * Nothing here is supposed to throw, and when it did the failure was invisible: the panel
				 * drew, the canvas came up empty, and the only sign was that typing did nothing. Reported
				 * as a refusal — which is the same shape as every other thing this editor cannot do — and
				 * logged, because a page error is what the browser check reads.
				 */
				const message = error instanceof Error ? error.message : String(error);
				console.error("the document editor failed to start", error);
				setRefusals([`The document editor could not start (${message})`]);
			}
		})();

		async function start() {
			/*
			 * Imported here rather than at the top of the file: this is a megabyte of editor, and the
			 * app's whole startup budget is a second and a bit. It loads when somebody opens a document
			 * to edit it, which is twice in a session for most people.
			 */
			const { default: grapesjs } = await import("grapesjs");
			if (stopped || !host) return;

			const root = rootOf(props.source);
			if (!root) {
				setRefusals([`${props.path} has no .doc component to edit as a document — edit its source instead.`]);
				return;
			}

			const instance = grapesjs.init({
				container: host,
				height: `${props.h}px`,
				width: `${props.w}px`,
				storageManager: false,
				// The design's measured config: no inline styles invented for the author, and the
				// app's own stylesheet left alone.
				avoidInlineStyle: true,
				protectedCss: "",
				// Nothing of GrapesJS's own chrome: no blocks palette, no device switcher, no style
				// manager. The inline formatting toolbar over a selection is all of the UI, which is
				// what "text and marks" means and what a document needs.
				panels: { defaults: [] },
				showOffsets: false,
				canvas: {
					styles: ["/api/board/lib/board.css"],
					scripts: ["/api/board/lib/board.js"],
				},
			});
			editor = instance;
			/*
			 * The document goes in *after* `init`, by the API rather than as an init option. The option
			 * looked tidier and left the canvas empty: `init` returned an editor whose frame had no
			 * components in it, with nothing thrown and nothing logged, which is the sort of silence
			 * that costs an afternoon.
			 */
			instance.setComponents(`<div class="doc" data-id="${root.id}">${root.inner}</div>`);

			/*
			 * Every block is a sibling, so a drag can only mean one thing.
			 *
			 * The document is flat: the mapper addresses the root's element children and nothing below
			 * them. A drop *into* a block is therefore not an edit this editor can express — it arrives
			 * as that block's inner HTML having changed, which the server refuses unless the block is a
			 * run of words, and writes as a silent replacement of its content when it is. Taking blocks
			 * out of the sorter's list of containers is what leaves "move this block here" as the only
			 * outcome, which is the gesture somebody dragging one actually made.
			 */
			const flat = () => {
				const root = instance.getComponents().at(0);
				for (const child of root?.components().models ?? []) child.set("droppable", false);
			};
			flat();

			/*
			 * Name the canvas's frame, and make it the board's own page.
			 *
			 * GrapesJS gives the frame no id, and there is more than one frame inside this panel — so
			 * without a name there is nothing outside this component that can address the document
			 * it is showing: not the stylesheet, not the browser check.
			 *
			 * **Run on every tick, and never stopped.** This used to apply the page once and clear the
			 * interval, and GrapesJS writes its frame's document more than once: a second document
			 * arrived after the first had been dressed, `board.js` re-ran on it, and what was left was
			 * a body with `class="board"` and none of the board's own attributes — the missing
			 * `flow`, the 1200px default width, and a document laid out in a 64px column. Re-applying
			 * is a handful of idempotent attribute writes a few times a second while the editor is open,
			 * which is not a render loop; being wrong about *when* the document is final is what cost.
			 */
			const page = (canvas: Document) => {
				const body = canvas.body;
				if (!body) return;
				/*
				 * The board's own `<body>` attributes first.
				 *
				 * `board.css` keys the whole page off them — `body.board` is where the document's margins,
				 * its type scale and the grid background live — and GrapesJS's canvas body carries nothing
				 * at all. Without this the content sat flush in the corner: the missing margins, and half
				 * the reason it looked unlike the board it stands in for.
				 */
				for (const [attribute, value] of root.body) {
					if (body.getAttribute(attribute) !== value) body.setAttribute(attribute, value);
				}
				/*
				 * And the board's own size, which is the file's `<meta name="board">` and not the
				 * 1200x800 `board.css` declares for every board. `board.js` would apply the meta itself
				 * if the canvas had one, and the canvas is GrapesJS's document — so this is the meta, as
				 * the app already knows it: `props.w`/`props.h` are the board's own numbers.
				 */
				if (body.style.width !== `${props.w}px`) body.style.width = `${props.w}px`;
				if (body.style.height !== `${props.h}px`) body.style.height = `${props.h}px`;
				const bg = typeof root.meta.bg === "string" ? root.meta.bg : "grid";
				if (body.dataset.bg !== bg) body.dataset.bg = bg;
				if (typeof root.meta.theme === "string") canvas.documentElement.dataset.theme = root.meta.theme;
				/*
				 * GrapesJS's wrapper, taken out of the layout.
				 *
				 * It is the `.doc`'s parent and not the body: an anonymous `<div>` that `board.css`'s
				 * `body.board > *` makes `position: absolute`, so it became the containing block for the
				 * document. A `<div class="doc">` with `width: 100%` then resolved against a box whose
				 * width was 0, and the whole document laid out as a 64px column of wrapped words — the
				 * paragraphs were there, invisible, and every click into one went nowhere because there
				 * was nothing to click. `display: contents` deletes the wrapper's box, so the document
				 * measures against the page it is on, exactly as it does outside the editor.
				 */
				const wrapper = canvas.querySelector(".doc")?.parentElement;
				if (wrapper && wrapper !== body && wrapper.style.display !== "contents") wrapper.style.display = "contents";
			};

			/*
			 * Retried, because the frame is empty when it first appears: GrapesJS creates it, then
			 * renders the components into it, and only then is there anything to recognise it by.
			 *
			 * Three ways in, because GrapesJS writes its frame's document more than once and not
			 * always with an event: the frame's own `load`, GrapesJS's `canvas:frame:load`, an
			 * observer on whichever document is there now, and — under all of them — the interval,
			 * which is the only one that survives a document being replaced by `document.write`.
			 */
			const name = () => {
				for (const frame of host?.querySelectorAll("iframe") ?? []) {
					// The frame's own load, once per frame element: a written document fires it, and
					// the components are in by then.
					if (!bound.has(frame)) {
						bound.add(frame);
						frame.addEventListener("load", () => name());
					}
					// The one holding the document, not whichever came first: there is more than one
					// frame in here, and the canvas is not the first of them.
					const canvas = frame.contentDocument;
					if (!canvas?.querySelector("[data-id]")) continue;
					if (frame.id !== "decks-document-canvas") frame.id = "decks-document-canvas";
					page(canvas);
					/*
					 * And again the moment the document changes, because that is when it is wrong. A
					 * document GrapesJS writes is dressed as it is written rather than at the next tick;
					 * a document it replaces gets a new observer.
					 */
					if (!watched.has(canvas)) {
						watched.add(canvas);
						const watcher = new MutationObserver(() => name());
						watcher.observe(canvas.documentElement, { childList: true, subtree: true, attributes: true });
						watchers.push(watcher);
					}
					/*
					 * And the canvas is the board's size in **board pixels**, not the container's in
					 * screen pixels.
					 *
					 * GrapesJS measures its canvas and writes the result inline, and what it measured
					 * was a panel that the camera had scaled — so the document was laid out wider than
					 * the frame it was in and ran off the right edge, clipped mid-sentence, with a
					 * horizontal scrollbar whose arrow sat in the bottom-left corner.
					 *
					 * Written only when it is not already right. This runs a few times a second, and an
					 * unguarded `setProperty` re-serialises the element's style attribute on every
					 * tick — which is a DOM write in the middle of somebody's typing, on the very
					 * element the caret is in.
					 */
					for (const element of host?.querySelectorAll(".gjs-cv-canvas__frames, .gjs-frame-wrapper, .gjs-frame, iframe") ?? []) {
						const styled = (element as HTMLElement).style;
						if (styled.getPropertyValue("width") !== `${props.w}px`) styled.setProperty("width", `${props.w}px`, "important");
						if (styled.getPropertyValue("height") !== `${props.h}px`) styled.setProperty("height", `${props.h}px`, "important");
					}
					return;
				}
			};
			name();
			naming = setInterval(name, 120);
			instance.on("canvas:frame:load", name);

			/*
			 * The keys, again — from inside the canvas this time.
			 *
			 * The panel's own listener below never sees a key pressed while the caret is in the
			 * document: the canvas is a frame of its own and its events do not cross. So the two
			 * gestures are registered with GrapesJS as well, which is where keys in the frame are
			 * handled. Returning `false` stops GrapesJS acting on them itself — Escape would
			 * otherwise just deselect the component under the caret.
			 */
			instance.Keymaps.add("decks:save", "⌘s", () => {
				commit();
				return false;
			});
			instance.Keymaps.add("decks:save-win", "ctrl+s", () => {
				commit();
				return false;
			});
			instance.Keymaps.add("decks:discard", "esc", () => {
				cancel();
				return false;
			});

			const blocks = () => {
				const first = instance.getComponents().at(0);
				if (!first) return [];
				return (first.components().models ?? []).filter((child) => !!child.get("tagName"));
			};
			const snapshot = (): EditBlock[] => blocks().map((block) => ({ id: block.cid ?? "", ...inner(block) }));

			// The document as the editor loaded it. `before` and `html` are both read from the
			// model, so an untouched block is byte-identical to itself and produces no op.
			const was = snapshot();

			/*
			 * The commit, and the one thing it has to do before it looks at anything.
			 *
			 * **GrapesJS's RTE does not write to the model as you type.** The words live in the
			 * canvas element while a component is being edited, and are folded back into the
			 * component only when editing ends — `ComponentTextView.disableEditing()` reads the
			 * element and `resetFromString`s the model. So a snapshot taken while the caret is still
			 * in a paragraph reads the document *as it was when the editor opened*, and every commit
			 * would be an empty one: the diff says nothing changed, the editor closes as though it
			 * had been cancelled, and the words are lost. That is exactly what happened — the
			 * retype read back as "nothing moved", and the error the browser reported came from the
			 * blur that the teardown caused, syncing a live document into a destroyed editor.
			 *
			 * So the first thing a commit does is end the edit, and it waits for that: the promise is
			 * resolved after the model has the new content in it. Only then is anything diffed.
			 */
			const flush = async () => {
				const editing = instance.getEditing();
				const view = editing?.getCurrentView?.() as { disableEditing?: () => Promise<void> } | undefined;
				if (!view?.disableEditing) return;
				try {
					await view.disableEditing();
				} catch (error) {
					// Nothing to fold in is not a failure to commit what is already there.
					console.warn("the document editor could not close its edit", error);
				}
			};

			commit = () => {
				if (settled) return;
				settled = true;
				void (async () => {
					await flush();
					const { patches, refusals: trouble } = diffBlocks(was, snapshot(), root.id);
					if (trouble.length > 0) {
						// Refused, and said so: the caller is offered the bytes in the same breath.
						setRefusals(trouble);
						settled = false;
						return;
					}
					// Nothing changed is not a write. An editor that records a revision for opening a
					// board and closing it is one whose history nobody can read.
					if (patches.length > 0) props.onPatches(patches);
					else props.onCancel();
				})();
			};

			cancel = () => finish(props.onCancel);
			setReady(true);
		}
	});

	/*
	 * A press outside the panel commits — which, because the canvas is a frame of its own, can
	 * only happen outside the editor: a click *inside* the canvas never reaches this document,
	 * so the frame cannot fire this by accident.
	 */
	const onOutside = (event: PointerEvent) => {
		/*
		 * The editor's own button is not "outside".
		 *
		 * A press anywhere else commits and, when nothing changed, closes — which is what makes
		 * clicking away a way out. The button in the board's bar that *opened* this is not
		 * clicking away: it sits outside the panel, so without this a second press on it tore the
		 * editor down and built a new one, and anything typed into the first one went with it.
		 */
		if ((event.target as Element | null)?.closest?.('[data-act="document"]')) return;
		if (!panel || panel.contains(event.target as Node)) return;
		commit();
	};

	/*
	 * The keys, while this is open, from anywhere in the app — and taken first.
	 *
	 * The panel cannot rely on having focus: what opens the editor is a button in the board's
	 * title bar, so the first key after that arrives with the button still focused, and a
	 * listener on the panel never hears it. Escape not closing was exactly this. Captured, so
	 * the app's own Escape (leaving the focus view, clearing a selection) does not fire as well.
	 */
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			cancel();
			return;
		}
		if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			event.stopPropagation();
			commit();
		}
	};
	document.addEventListener("pointerdown", onOutside, true);
	document.addEventListener("keydown", onKey, true);
	onCleanup(() => {
		document.removeEventListener("pointerdown", onOutside, true);
		document.removeEventListener("keydown", onKey, true);
	});

	return (
		<div
			class="grapes-editor"
			style={{ width: `${props.w}px`, height: `${props.h}px` }}
			ref={(element) => {
				panel = element;
			}}
		>
			<div
				class="grapes-canvas"
				ref={(element) => {
					host = element;
				}}
			/>
			{/*
				A refusal is not a failure to hide. It is the one case where this editor cannot say
				what the person did, and the honest answer is to hand them the file — which is the
				design's last step, and the reason the op set is allowed to be small.
			*/}
			{refusals().length > 0 ? (
				<div class="grapes-refusal">
					<p>{refusals().join("; ")}.</p>
					<button type="button" onClick={() => finish(props.onSource)}>
						Edit the source instead
					</button>
				</div>
			) : (
				<div class="source-hint">
					<span>⌘S saves</span>
					<span>Esc discards</span>
					{ready() ? <span>a document — text, marks, paragraphs</span> : <span>loading the editor…</span>}
				</div>
			)}
		</div>
	);
}

/**
 * The `.doc` component's `data-id` and its content, read out of the file's own text.
 *
 * From the file and not from the frame, deliberately. The frame's DOM is what `board.js` drew
 * *and* what the app put there, and a document built from it is exactly the "serialise the live
 * frame" mistake the design's second board is about: a `[data-md]` panel would arrive holding
 * its rendered HTML *and* its markdown attribute, and a mirror would arrive holding a
 * conversation frozen at that second.
 */
function rootOf(source: string): { id: string; inner: string; body: [string, string][]; meta: Record<string, unknown> } | undefined {
	const parsed = new DOMParser().parseFromString(source, "text/html");
	const doc = parsed.querySelector(".doc");
	const id = doc?.getAttribute("data-id");
	if (!doc || !id) return undefined;
	/*
	 * The board's own `<body>` attributes travel with it.
	 *
	 * `board.css` keys the whole page off them — `body.board` is where the document's margins,
	 * its type scale and the grid background live — and GrapesJS's canvas body has neither the
	 * class nor the attribute. What arrived was the document with the page's styling missing:
	 * text flush against the top-left corner, which is the margins the screenshot is about.
	 */
	const body = [...parsed.body.attributes].map((a) => [a.name, a.value] as [string, string]);
	/*
	 * And the board's own `<meta name="board">`, which is the page's *size* and its background.
	 *
	 * `board.js` applies it to whatever document it runs in, and the editor's canvas is not the
	 * board's document — there is no meta tag in it for `readMeta()` to find. So the same map is
	 * read here and applied by `page()`, or the canvas keeps the 1200x800 `board.css` declares
	 * for every board and the document is laid out at a size the board is not.
	 */
	let meta: Record<string, unknown> = {};
	try {
		meta = JSON.parse(parsed.querySelector('meta[name="board"]')?.getAttribute("content") ?? "{}") as Record<string, unknown>;
	} catch {
		meta = {};
	}
	return { id, inner: doc.innerHTML, body, meta };
}

/**
 * A block's payload and its words, both from the model.
 *
 * Inner HTML, because `op: "html"` replaces the range *between* the addressed element's tags —
 * sending the outer markup would nest a paragraph inside a paragraph. The words are what the
 * server compares against the file, and it compares them as text with tags taken out, so a
 * payload carrying markup could never match.
 *
 * The words are extracted by parsing the string, not by reading the canvas: the component's own
 * element is GrapesJS's rendering of it, and asking it anything is how the editor's furniture
 * would find its way into an op.
 */
function inner(block: { components(): { models?: unknown[] }; toHTML(): string }): { html: string; text: string } {
	const html = ((block.components().models ?? []) as { toHTML(): string }[]).map((child) => child.toHTML()).join("");
	const scratch = document.createElement("div");
	scratch.innerHTML = html;
	return { html, text: scratch.textContent ?? "" };
}
