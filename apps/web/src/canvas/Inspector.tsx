import { BOX_CLASSES, CALLOUT_TONES, type BoxClass } from "@decks/protocol";
import BringToFront from "lucide-solid/icons/bring-to-front";
import Copy from "lucide-solid/icons/copy";
import FolderOpen from "lucide-solid/icons/folder-open";
import SendToBack from "lucide-solid/icons/send-to-back";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { inspectorShown } from "../lib/edge.ts";
import { NARROW } from "../lib/panels.ts";
import "../styles/inspector.css";
import { elementOf, frameOf, isPdf, type Edit, type Shape } from "./inspect.ts";
import { scrubbable } from "./scrub.ts";

/**
 * The panel's own vocabulary, as class strings rather than stylesheet rules.
 *
 * Only the shell stays in CSS (`.inspector`): its corner is stated twice, once there and
 * once as a bottom sheet on a narrow screen, in `env()` and `--dock` terms a class
 * attribute says badly. Everything inside it is layout and one wash.
 *
 * Two of these constants are gone, and their absence is the point. The private `FIELD`
 * string is now `.field` in `styles/chrome.css`, and the tone swatch — five copies of a
 * fourteen-utility string, one per colour — is now `.tone` in `styles/inspector.css`. Both
 * are shapes this panel spells more than once and other surfaces spell too, and a shape
 * stated twice is a shape that drifts. What is left here is genuinely local: a row, and the
 * width of a row's label.
 */
const ROW = "row flex items-center gap-1";
const LABEL = "w-[34px] flex-none text-[11px] text-faint";

/**
 * Whether the panel is a bottom sheet rather than a float in the corner.
 *
 * `index.css` already makes it one under 760px and does it properly, in `env()` and
 * `--dock` terms. This signal exists because one thing about a sheet cannot be said in CSS
 * at all: it must not carry this file's `w-[320px]`, because a utility beats the component
 * layer *inside* a media query as well as outside one (see the long note at the top of
 * `index.css`), so the `width: auto` the sheet asks for would silently lose to the width the
 * corner asks for.
 *
 * It used to decide `data-inset` as well — neither arrangement declares one now, so the
 * question does not arise. What is left of that story is worth keeping: subtracting a sheet
 * once fitted a 1600px board into the strip of canvas above it, at 3.7%.
 *
 * At module scope, like `lib/edge.ts`'s signals and for the same reason — one query, read by
 * every mount, and a `createSignal` outside a reactive root is fine where a `createMemo`
 * would have no owner to clean it up.
 */
const [sheet, setSheet] = createSignal(false);
try {
	const query = window.matchMedia(`(max-width: ${NARROW}px)`);
	setSheet(query.matches);
	query.addEventListener("change", (event) => setSheet(event.matches));
} catch {
	// No `matchMedia`, or no `window` at all under a test runner: a corner float, which is
	// what any browser old enough to lack it would want anyway.
}

/** The four numbers, and which inline declaration each one is. */
type GeoKey = "left" | "top" | "width" | "height";

/** What the panel reads off the live document. `height: undefined` is a box sized by content. */
interface Geometry {
	left: number;
	top: number;
	width: number;
	height: number | undefined;
}

/**
 * The four fields, in the order the drawing has them.
 *
 * `min` is per field rather than one number for all four: a component may not be dragged
 * off the top-left of its own board, and a box narrower than the grid is one nobody will
 * find again. It is *lower* than the 40px floor the resize handle enforces, on purpose —
 * that floor exists because a 20px box has nowhere to put a grab handle, which is not a
 * problem a typed number has.
 */
const COORDS: ReadonlyArray<{ key: GeoKey; kicker: string; name: string; min: number }> = [
	{ key: "left", kicker: "X", name: "Left", min: 0 },
	{ key: "top", kicker: "Y", name: "Top", min: 0 },
	{ key: "width", kicker: "W", name: "Width", min: 8 },
	{ key: "height", kicker: "H", name: "Height", min: 8 },
];

/**
 * One unit, and ten of it with shift — for a nudge and for a scrub alike.
 *
 * Not the 8px `GRID` the canvas nudges by, and the difference is deliberate: an arrow key on
 * the canvas is *moving a box* and wants the grid it snaps to, while an arrow key in this
 * field is *correcting a number* and wants the last digit. The multipliers are the ones the
 * design board states for the scrub, and a field whose keyboard and whose drag disagreed
 * about what a unit is would be worse than either.
 */
const STEP = 1;

/**
 * The selection's properties, floating beside the stage.
 *
 * What kind of box it is, its tone, what an embed points at, its name, its order, a copy of
 * it, its removal — and now, in one 24px row of four, **where it is and how big it is.**
 *
 * That last row reverses what this comment used to say. It read "position and size are the
 * drag handles' job", which was right for as long as this panel was only the editor for
 * things a gesture could not reach. What changed is the observation in
 * `boards/the-polish-pass-seven-changes`: a component's position *is* an inline
 * `left`/`top`/`width` in an HTML file, this app has rewritten those exact bytes since the
 * first drag, and there was still no way to read the number, let alone type one. A handle
 * can nudge a box; only a number can place it — on the 8px grid a board is authored to,
 * level with the card above it, or at the 640 the board's own `<meta>` implies. So the row
 * stays and the rule it broke is retired: position and size are the drag handles' job *and*
 * this panel's, because they are one fact stated two ways and both ways send the same patch
 * (`Edit`'s `geometry`, which is byte-for-byte what `Editor.ts` sends).
 *
 * The panel's height is the other half of that argument. Everything the big three-tab
 * properties panel grew is cut: the Board/Component tabs (the selection says which), the
 * collapsible sections (four rows do not need folding), the background and theme segments
 * (board meta, not a selection's properties), the file path and revision (the ⋯ menu's job),
 * the left panel's list. 424px becomes about 140px, and a small inspector is *why*
 * the right edge is free for the conversation — the same change wearing its second hat.
 *
 * It appears for the selection and only above `INTERACT_ZOOM`, the same rule the palette
 * follows: below that a board is a tile on a map, its frame takes no pointer events, and
 * there is nothing to select. Whether it is actually *on* the edge is `lib/edge.ts`'s to
 * say and not this file's — the conversation wants the same 320px and only one of the two
 * may have it, so this renders on `inspectorShown()` and never asks who else is there.
 *
 * **The rows are the stylesheet's vocabulary, not an invented one.** `board.css` has
 * four interchangeable box classes and a `data-tone`; `board.js` reads `data-embed`
 * and `data-pages`. A deck's `lib/` is a copy taken when the deck was created, so a
 * colour this build invented would be an unstyled box in every deck that already
 * exists (see `inspect.ts`). Anything an agent can write that this cannot edit is left
 * to the agent, which is the fallback editor and a good one.
 *
 * There were three more rows here — a connector's `from`, `to` and label. They went
 * with the connector itself: a line whose ends are named rather than placed has no
 * position the file states, so neither the agent that wrote it nor the person editing
 * it could say where it went. A diagram is a component with its own coordinates now,
 * and those coordinates are the four fields at the top of this panel.
 */
export function Inspector(props: {
	shape: Shape | undefined;
	visible: boolean;
	onEdit: (edit: Edit) => void;
	/** The file picker, for what an embed points at. Resolves to a board-relative path. */
	pickFile: () => Promise<string | undefined>;
	/** Let the selection go, which is what Escape does and a finger cannot. */
	onClose: () => void;
}) {
	/** The tones `board.css` styles for this component, or none for the rest. */
	const tones = createMemo(() => (props.shape?.box === "callout" ? [...CALLOUT_TONES] : []));

	const source = () => props.shape?.attrs["data-embed"] ?? "";

	/**
	 * Where the selection is, measured rather than remembered.
	 *
	 * `Shape` deliberately does not carry the geometry, and this is why: the numbers change
	 * without anything the app would call an edit. Drag the box, nudge it with an arrow key,
	 * add a line of text to a card that sizes from its content — a copy kept in a signal
	 * would be stale after every one of those, and a field showing a stale number is worse
	 * than no field, because it invites you to type next to it.
	 *
	 * So the panel watches the element instead: `MutationObserver` on `style` for the drags
	 * and the nudges, `ResizeObserver` for the height a box works out for itself. Both built
	 * from the *frame's* own constructors, the same trick `Editor.ts` uses for its handle, so
	 * the callbacks land in the frame's rendering lifecycle rather than the app's.
	 *
	 * `offset*` rather than `getBoundingClientRect`, because the camera is a transform on the
	 * frame and a client rect would report what the box measures on screen at 35% zoom. It is
	 * also exactly what `Editor.ts` measures, which is what keeps a typed number and a
	 * dragged one from disagreeing about the same box.
	 */
	let live: HTMLElement | undefined;
	const [box, setBox] = createSignal<Geometry | undefined>(undefined);

	const measure = (element: HTMLElement): Geometry => ({
		left: element.offsetLeft,
		top: element.offsetTop,
		width: element.offsetWidth,
		// The *inline* height, not the rendered one: a card with no `height` declaration is
		// `auto`, and reporting the 96px it happens to occupy would be reporting a
		// consequence as though it were the file's instruction.
		height: element.style.height ? element.offsetHeight : undefined,
	});

	const refresh = () => setBox(live ? measure(live) : undefined);

	createEffect(() => {
		const shape = props.shape;
		live = undefined;
		const frame = shape && frameOf(shape.path);
		const element = shape && elementOf(shape.path, shape.id);
		if (!frame || !element) {
			setBox(undefined);
			return;
		}
		live = element;
		refresh();

		const win = frame.win as Window & {
			MutationObserver?: typeof MutationObserver;
			ResizeObserver?: typeof ResizeObserver;
		};
		const styles = win.MutationObserver ? new win.MutationObserver(() => refresh()) : undefined;
		styles?.observe(element, { attributeFilter: ["style"] });
		const sizes = win.ResizeObserver ? new win.ResizeObserver(() => refresh()) : undefined;
		sizes?.observe(element);
		onCleanup(() => {
			styles?.disconnect();
			sizes?.disconnect();
		});
	});

	/**
	 * A number on its way to the board, but not to the file.
	 *
	 * Every step of a scrub comes through here. It writes the one declaration and nothing
	 * else, which is what makes dragging a label feel like dragging the box — and it writes
	 * *no patch*, because a patch is a revision and the revision list is the undo history
	 * (§6.7). One drag is one entry; the long note in `scrub.ts` is the whole argument.
	 */
	const preview = (key: GeoKey, value: number) => {
		live?.style.setProperty(key, `${value}px`);
		refresh();
	};

	/** The same number, and this time the file hears about it. */
	const write = (key: GeoKey, value: number) => {
		preview(key, value);
		const to: Partial<Record<GeoKey, number>> = { [key]: value };
		props.onEdit({ kind: "geometry", to });
	};

	/**
	 * A field that commits on Enter or on leaving, and abandons on Escape.
	 *
	 * Per keystroke would be a patch per keystroke — coalesced, but still a write and
	 * a revision per letter, and the revision list is the undo history (§6.7).
	 */
	const field = (name: string, value: () => string, commit: (next: string) => void, placeholder?: string) => (
		<input
			class="field min-w-0 flex-1 font-mono"
			name={name}
			type="text"
			spellcheck={false}
			value={value()}
			placeholder={placeholder ?? ""}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					(event.currentTarget as HTMLInputElement).blur();
				}
				if (event.key === "Escape") {
					event.preventDefault();
					event.currentTarget.value = value();
					(event.currentTarget as HTMLInputElement).blur();
				}
			}}
			onChange={(event) => {
				const next = event.currentTarget.value.trim();
				if (next !== value()) commit(next);
			}}
		/>
	);

	/**
	 * One of the four coordinates: a label you can drag, and a number you can type.
	 *
	 * A real `<input>` and not a span you click to edit, which is the whole difference
	 * between this and a readout — it is in the tab order, it takes a caret, and `560` can be
	 * selected and replaced. `type="text"` rather than `type="number"` for one reason worth
	 * stating: `auto` is a legal thing for the height field to be showing, and a number input
	 * cannot hold a word. The spinners would have been the second reason.
	 *
	 * Up and Down nudge, not Left and Right, because Left and Right are how a caret moves
	 * inside a field and a control that fights the platform's text editing is a control
	 * people stop typing into. Each nudge commits, which is a patch per key repeat — and
	 * affordable only because `patches.ts` coalesces consecutive edits to the same component
	 * into one, which is the case it exists for.
	 */
	const coord = (spec: (typeof COORDS)[number]) => {
		/** The number the file states, or nothing at all for an `auto` height. */
		const current = () => box()?.[spec.key];
		/** What a nudge or a scrub counts from — for `auto`, the height it currently occupies. */
		const from = () => current() ?? live?.offsetHeight ?? 0;
		const shown = () => (current() === undefined ? "auto" : String(current()));
		const clamp = (value: number) => Math.max(spec.min, Math.round(value));

		return (
			<div class="field">
				{/*
					The label is the handle. `aria-hidden` because the input beside it is already
					named the same thing for a screen reader, and a scrub is not a gesture that
					reads out — the arrow keys are this control's keyboard, and they are on the
					input, where a keyboard user already is.
				*/}
				<span
					class="k"
					data-scrub="true"
					aria-hidden="true"
					title={`${spec.name} — drag to change, ⇧ for ×10, ⌥ for finer`}
					ref={(el) =>
						onCleanup(
							scrubbable(el, {
								value: from,
								onPreview: (value) => preview(spec.key, value),
								onCommit: (value) => write(spec.key, value),
								step: STEP,
								min: spec.min,
							}),
						)
					}
				>
					{spec.kicker}
				</span>
				<input
					name={spec.key}
					type="text"
					inputmode="numeric"
					autocomplete="off"
					spellcheck={false}
					aria-label={`${spec.name}, in pixels`}
					data-auto={current() === undefined}
					value={shown()}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.blur();
							return;
						}
						if (event.key === "Escape") {
							event.preventDefault();
							event.currentTarget.value = shown();
							event.currentTarget.blur();
							return;
						}
						const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
						if (!direction) return;
						event.preventDefault();
						write(spec.key, clamp(from() + direction * STEP * (event.shiftKey ? 10 : 1)));
					}}
					onChange={(event) => {
						// `640`, `640px` and ` 640 ` are all the same intention. Anything else —
						// including the word `auto`, which no patch can write back (see `Edit`) —
						// puts the field back to what the file says, and writes nothing.
						const typed = Number.parseFloat(event.currentTarget.value.trim().replace(/px$/i, ""));
						const next = Number.isFinite(typed) ? clamp(typed) : undefined;
						if (next === undefined || next === current()) {
							event.currentTarget.value = shown();
							return;
						}
						write(spec.key, next);
					}}
				/>
			</div>
		);
	};

	return (
		<Show when={props.visible && inspectorShown() && props.shape}>
			{(shape) => (
				<aside
					class={`panel-float inspector ${sheet() ? "" : "w-[320px]"}`}
					data-family={shape().family}
					/*
					 * No `data-inset`, in either arrangement.
					 *
					 * It used to declare `right`, and `lib/insets.ts` subtracted its width: the
					 * panel was a full-height column beside the canvas, so the dock centred on
					 * what was left and `fit` framed into it. It is a card in the top-right
					 * corner now — under the tool cluster, 320px by about 200 — and subtracting
					 * that width slid the input bar 160px sideways every time you clicked a
					 * component, which is a whole canvas reflowing to report a selection.
					 *
					 * Nothing else in that corner insets either: the cluster above it declares
					 * `top`, and its popovers declare nothing. The right edge is still *yielded*
					 * to this panel — the conversation stands down for it, in `lib/edge.ts` —
					 * which is the arrangement that actually needed enforcing, and it is a
					 * different mechanism from the one that moves the canvas.
					 */
				>
					<header class="flex items-center gap-1.5">
						{/*
							What it is, said in the board's own words: the class an agent would have
							written, or the tag when there is no class we know. It used to be a 10px
							uppercase kicker at 0.06em tracking, reading as an eyebrow *over* the
							panel; it is the panel's title now, in `.label` — 11.5px, weight 500, no
							tracking. At that tracking the eye reads letters rather than words, and
							some screen readers announce a long uppercase run letter by letter. Lower
							case rather than `Card`, because the word is a value out of the file and
							not a heading of ours: it should read as the class the markup carries.
						*/}
						<span class="what label max-w-[104px] flex-none truncate">
							{shape().box ?? (shape().family === "embed" ? "embed" : shape().classes[0] ?? shape().tag)}
						</span>
						{field("name", () => shape().id, (next) => next && props.onEdit({ kind: "rename", to: next }))}
						{/*
							Escape clears the selection and a tap on bare canvas does too — but on a
							narrow screen this panel is a sheet across the bottom, and "tap the
							canvas" is advice about a part of the screen the sheet is covering.
						*/}
						<button
							// Pushed to the far end of the header, which is the only thing it needs of its own.
							class="close ml-auto pointer-coarse:size-[38px]"
							type="button"
							title="Done (Esc)"
							aria-label="Close the inspector"
							onClick={() => props.onClose()}
						>
							<Icon of={X} size={15} />
						</button>
					</header>

					{/*
						Four fields in one 24px row, and the row is a grid rather than a flex line so
						that `1920` and `48` get the same width. Columns that measured themselves
						would put a wide field beside a narrow one and the numbers would not line up
						down the panel — which is what tabular figures are for in the first place.

						Only for a component whose position the document actually states. A top-level
						`<svg>` has no `offsetLeft` at all, which is why the authoring skill has a
						hand-drawn diagram sit inside a box; the measurement is missing here for the
						same reason, so the row is too rather than showing four zeroes.
					*/}
					<Show when={box()}>
						<div class="fields grid grid-cols-4 gap-1">
							<For each={COORDS}>{(spec) => coord(spec)}</For>
						</div>
					</Show>

					{/*
						A segmented control, and the palette is already one.

						Four mutually exclusive choices with exactly one active is `.seg` in
						`styles/chrome.css` — the same shape the dock's controls and the boards
						panel's footer spell — so this asks for it by name instead of keeping a
						private copy of a fourteen-utility string. It used to be four bordered pills:
						the same information in a shape the rest of the app does not use anywhere.
						Named rather than drawn, too: an icon for "callout" is a guess the user has to
						decode, and the words are what an agent would have written in the file anyway.
					*/}
					<Show when={shape().family === "box"}>
						{/* `row` carries no styling of its own — `.seg` is the whole drawing — but it
						    is how the panel's rows are addressed from outside, by the end-to-end
						    checks among others, and the class is cheaper to keep than the hook is to
						    move. */}
						<div class="row seg boxes">
							<For each={BOX_CLASSES}>
								{(box) => (
									<button
										class="focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent pointer-coarse:min-h-9"
										type="button"
										data-box={box}
										data-on={shape().box === box}
										title={`Make this a ${box}`}
										/* The one it already is does nothing at all: an edit is a revision, and
										   the revision list is the undo history (§6.7). A finger lands on the
										   wrong button often enough that "no-op" had to mean no write. */
										onClick={() => shape().box !== box && props.onEdit({ kind: "box", to: box as BoxClass })}
									>
										{box}
									</button>
								)}
							</For>
						</div>
					</Show>

					<Show when={tones().length > 0}>
						<div class={`${ROW} tones`}>
							<span class={LABEL}>tone</span>
							{/* The default is a tone too — it is the absence of the attribute, and
							    saying so is what makes going back possible. */}
							<button
								class="tone"
								type="button"
								data-tone="default"
								data-active={!shape().attrs["data-tone"]}
								title="Default"
								aria-label="Default tone"
								onClick={() => shape().attrs["data-tone"] && props.onEdit({ kind: "attr", name: "data-tone", value: null })}
							/>
							<For each={tones()}>
								{(tone) => (
									<button
										class="tone"
										type="button"
										data-tone={tone}
										data-active={shape().attrs["data-tone"] === tone}
										title={tone}
										aria-label={`${tone} tone`}
										onClick={() =>
											shape().attrs["data-tone"] !== tone && props.onEdit({ kind: "attr", name: "data-tone", value: tone })
										}
									/>
								)}
							</For>
						</div>
					</Show>

					<Show when={shape().family === "embed"}>
						<div class={`${ROW} file`}>
							<span class={LABEL}>file</span>
							<span class="flex-1 overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap" title={source()}>
								{source().split("/").pop() || "nothing"}
							</span>
							<button
								type="button"
								data-act="pick"
								title="Point this embed at another file"
								aria-label="Point this embed at another file"
								onClick={() =>
									void props.pickFile().then((picked) => {
										if (picked) props.onEdit({ kind: "attr", name: "data-embed", value: picked });
									})
								}
							>
								<Icon of={FolderOpen} size={15} />
							</button>
						</div>
						{/* Page ranges are a PDF's, and board.js already understands "3-5" and
						    "1,4-6" — this is the one embed property that was in the runtime
						    from the start with no way to set it. */}
						<Show when={isPdf(source())}>
							<div class={ROW}>
								<span class={LABEL}>pages</span>
								{field(
									"pages",
									() => shape().attrs["data-pages"] ?? "",
									(next) => props.onEdit({ kind: "attr", name: "data-pages", value: next }),
									"all",
								)}
							</div>
						</Show>
					</Show>

					<div class={`${ROW} acts border-t border-line pt-1.5`}>
						<button
							type="button"
							data-act="front"
							title="Bring to front (]) — paint order is document order"
							aria-label="Bring to front"
							onClick={() => props.onEdit({ kind: "order", to: "front" })}
						>
							<Icon of={BringToFront} size={15} />
						</button>
						<button
							type="button"
							data-act="back"
							title="Send to back ([)"
							aria-label="Send to back"
							onClick={() => props.onEdit({ kind: "order", to: "back" })}
						>
							<Icon of={SendToBack} size={15} />
						</button>
						<button
							type="button"
							data-act="duplicate"
							title="Duplicate (⌘D)"
							aria-label="Duplicate"
							onClick={() => props.onEdit({ kind: "duplicate" })}
						>
							<Icon of={Copy} size={15} />
						</button>
						<span class="flex-1" />
						<button
							type="button"
							data-act="remove"
							class="hover:bg-danger/[0.18] hover:text-danger"
							title="Delete (⌫)"
							aria-label="Delete"
							onClick={() => props.onEdit({ kind: "remove" })}
						>
							<Icon of={Trash2} size={15} />
						</button>
					</div>
				</aside>
			)}
		</Show>
	);
}
