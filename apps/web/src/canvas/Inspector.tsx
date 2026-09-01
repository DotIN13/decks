import { BOX_CLASSES, CALLOUT_TONES, type BoxClass } from "@decks/protocol";
import BringToFront from "lucide-solid/icons/bring-to-front";
import Copy from "lucide-solid/icons/copy";
import FolderOpen from "lucide-solid/icons/folder-open";
import SendToBack from "lucide-solid/icons/send-to-back";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { createMemo, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { isPdf, type Edit, type Shape } from "./inspect.ts";

/**
 * The panel's own vocabulary, as class strings rather than stylesheet rules.
 *
 * Only the shell stays in CSS (`.inspector`): its corner is stated twice, once here and
 * once as a bottom sheet on a narrow screen, in `env()` and `--dock` terms a class
 * attribute says badly. Everything inside it is layout and one wash.
 */
const ROW = "row flex items-center gap-1";
const LABEL = "w-[34px] flex-none text-[11px] text-faint";

/*
 * Quiet until it is being used, like everything else in this panel.
 *
 * A 1px box around a name that is usually just read is a border earning nothing; the wash
 * says "editable" and the accent ring says "being edited", which is the only moment the
 * distinction matters.
 */
const FIELD =
	"min-w-0 flex-1 rounded-control border-0 bg-line px-1.5 py-[3px] font-mono text-[11px] text-fg transition-[background-color] duration-[120ms] ease-[ease] hover:bg-line-strong focus:bg-bg focus:outline-2 focus:-outline-offset-1 focus:outline-accent pointer-coarse:min-h-9 pointer-coarse:text-[13px]";

/*
 * A tone is a colour, so the control is the colour.
 *
 * "Default" is the absence of `data-tone`, and the swatch says what the board will draw
 * rather than what the control is called — a callout with no tone is accent. Only a
 * callout has tones at all, which is why there is one default colour and not a rule per
 * family.
 */
const TONE =
	"size-[15px] cursor-pointer rounded-full border border-line-strong p-0 data-[tone=default]:bg-accent data-[tone=ok]:bg-ok data-[tone=warn]:bg-warn data-[tone=danger]:bg-danger data-[active=true]:shadow-[0_0_0_2px_var(--panel),0_0_0_3px_var(--fg)] pointer-coarse:min-h-[38px] pointer-coarse:min-w-[38px]";

/**
 * The selection's properties, floating beside the stage.
 *
 * Everything about a component that is not its position, its size or a run of its
 * text — what kind of box it is, its tone, what an embed points at, its name, its
 * order, a copy of it, its removal. Position and size are the drag handles' job and
 * text is typed in place; this is the rest of §6.5.
 *
 * It appears for the selection and only above `INTERACT_ZOOM`, the same rule the
 * palette follows: below that a board is a tile on a map, its frame takes no pointer
 * events, and there is nothing to select. Top right rather than beside the palette,
 * because the notices land under the palette — and just inside the timeline spine, which
 * is the one thing on that edge that has to stay aimable.
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
 * and coordinates are the drag handles' job rather than this panel's.
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
	 * A field that commits on Enter or on leaving, and abandons on Escape.
	 *
	 * Per keystroke would be a patch per keystroke — coalesced, but still a write and
	 * a revision per letter, and the revision list is the undo history (§6.7).
	 */
	const field = (name: string, value: () => string, commit: (next: string) => void, placeholder?: string) => (
		<input
			class={FIELD}
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

	return (
		<Show when={props.visible && props.shape}>
			{(shape) => (
				<aside class="panel-float inspector" data-family={shape().family}>
					<header class="flex items-center gap-1.5 border-b border-line pb-1.5">
						{/* What it is, said in the board's own words: the class an agent would
						    have written, or the tag when there is no class we know. */}
						<span class="what text-[10px] tracking-[0.06em] text-faint uppercase">{shape().box ?? (shape().family === "embed" ? "embed" : shape().classes[0] ?? shape().tag)}</span>
						{field("name", () => shape().id, (next) => next && props.onEdit({ kind: "rename", to: next }))}
						{/*
							Escape clears the selection and a tap on bare canvas does too — but on a
							narrow screen this panel is a sheet across the top, and "tap the canvas"
							is advice about a part of the screen the sheet is covering.
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
						A segmented control, and the palette is already one.

						Four mutually exclusive choices with exactly one active is the same control
						as the tool row, so it is drawn the same way: no borders, a wash under the
						cursor, and the accent filling the one that is on. It used to be four
						bordered pills — the same information in a shape the rest of the app does
						not use anywhere. Named rather than drawn, too: an icon for "callout" is a
						guess the user has to decode, and the words are what an agent would have
						written in the file anyway.
					*/}
					<Show when={shape().family === "box"}>
						<div class={`${ROW} boxes flex-wrap gap-[3px]`}>
							<For each={BOX_CLASSES}>
								{(box) => (
									<button
										class="cursor-pointer rounded-control border-0 bg-transparent px-[7px] py-1 text-[11px] text-muted transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-line hover:text-fg data-[active=true]:bg-accent data-[active=true]:text-white pointer-coarse:min-h-[38px] pointer-coarse:min-w-[38px]"
										type="button"
										data-box={box}
										data-active={shape().box === box}
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
								class={TONE}
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
										class={TONE}
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
