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
 * A reorder of the blocks, and anything else `diffBlocks` cannot describe. The refusal is shown
 * with a way to the source textarea rather than swallowed: the design's last step is to refuse
 * what the ops cannot express and offer the file in the same breath, because the alternative —
 * a document quietly rewritten into a shape the author did not choose — is the failure all of
 * this exists to prevent.
 *
 * Not reachable below half zoom, because that is where a board stops taking pointer events at
 * all — the double-click that opens this cannot happen down there.
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
	/** The retry that names the canvas frame. Cleared when the editor goes. */
	let naming: ReturnType<typeof setInterval> | undefined;
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
			 * Name the canvas's frame.
			 *
			 * GrapesJS gives it no id, and there is more than one frame inside this panel — so
			 * without a name there is nothing outside this component that can address the document
			 * it is showing: not the stylesheet, not the browser check. It arrives with the canvas,
			 * so the name is set both now and when the frame announces itself.
			 */
			/*
			 * Retried, because the frame is empty when it first appears: GrapesJS creates it, then
			 * renders the components into it, and only then is there anything to recognise it by. The
			 * first attempt is always too early, which is how a name that looks deterministic ends up
			 * on the wrong frame.
			 */
			const name = () => {
				for (const frame of host?.querySelectorAll("iframe") ?? []) {
					// The one holding the document, not whichever came first: there is more than one
					// frame in here, and the canvas is not the first of them.
					const document = frame.contentDocument;
					if (!document?.querySelector("[data-id]")) continue;
					frame.id = "decks-document-canvas";
					/*
					 * The board's own page, in the canvas.
					 *
					 * `board.css` draws a document through `body.board` — margins, type scale, the grid
					 * — and GrapesJS's canvas body carries nothing at all. Without this the content sat
					 * flush in the corner: the missing margins, and half the reason it looked unlike
					 * the board it stands in for.
					 */
					for (const [name, value] of root.body) document.body.setAttribute(name, value);
					/*
					 * And the canvas is the board's size in **board pixels**, not the container's in
					 * screen pixels.
					 *
					 * GrapesJS measures its canvas and writes the result inline, and what it measured
					 * was a panel that the camera had scaled — so the document was laid out wider than
					 * the frame it was in and ran off the right edge, clipped mid-sentence, with a
					 * horizontal scrollbar whose arrow sat in the bottom-left corner. That arrow is
					 * what the screenshot asks about; it is the symptom, not the fault.
					 */
					for (const element of host?.querySelectorAll(".gjs-cv-canvas__frames, .gjs-frame-wrapper, .gjs-frame, iframe") ?? []) {
						(element as HTMLElement).style.setProperty("width", `${props.w}px`, "important");
						(element as HTMLElement).style.setProperty("height", `${props.h}px`, "important");
					}
					if (naming) clearInterval(naming);
					naming = undefined;
					return;
				}
			};
			name();
			naming = setInterval(name, 200);
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

			commit = () =>
				finish(() => {
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
				});

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
function rootOf(source: string): { id: string; inner: string; body: [string, string][] } | undefined {
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
	return { id, inner: doc.innerHTML, body: [...parsed.body.attributes].map((a) => [a.name, a.value]) };
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
