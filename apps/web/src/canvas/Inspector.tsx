import { BOX_CLASSES, CALLOUT_TONES, LINK_TONES, type BoxClass } from "@decks/protocol";
import BringToFront from "lucide-solid/icons/bring-to-front";
import Copy from "lucide-solid/icons/copy";
import FolderOpen from "lucide-solid/icons/folder-open";
import SendToBack from "lucide-solid/icons/send-to-back";
import Trash2 from "lucide-solid/icons/trash-2";
import { createMemo, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { isPdf, type Edit, type Shape } from "./inspect.ts";

/**
 * The selection's properties, floating beside the stage.
 *
 * Everything about a component that is not its position, its size or a run of its
 * text — what kind of box it is, its tone, what an embed points at, where a
 * connector ends, its name, its order, a copy of it, its removal. Position and size
 * are the drag handles' job and text is typed in place; this is the rest of §6.5.
 *
 * It appears for the selection and only above `INTERACT_ZOOM`, the same rule the
 * palette follows: below that a board is a tile on a map, its frame takes no pointer
 * events, and there is nothing to select. Top right rather than beside the palette,
 * because the notices land under the palette — and just inside the chat panel's
 * reach, so hovering the inspector does not pull the transcript over it.
 *
 * **The rows are the stylesheet's vocabulary, not an invented one.** `board.css` has
 * five interchangeable box classes and a `data-tone`; `board.js` reads `data-embed`,
 * `data-pages`, `data-from`, `data-to` and `data-label`. A deck's `lib/` is a copy
 * taken when the deck was created, so a colour this build invented would be an
 * unstyled box in every deck that already exists (see `inspect.ts`). Anything an
 * agent can write that this cannot edit is left to the agent, which is the fallback
 * editor and a good one.
 */
export function Inspector(props: {
	shape: Shape | undefined;
	visible: boolean;
	onEdit: (edit: Edit) => void;
	/** The file picker, for what an embed points at. Resolves to a board-relative path. */
	pickFile: () => Promise<string | undefined>;
}) {
	/** The tones `board.css` styles for this component, or none for the rest. */
	const tones = createMemo(() => {
		const shape = props.shape;
		if (!shape) return [];
		if (shape.family === "link") return [...LINK_TONES];
		return shape.box === "callout" ? [...CALLOUT_TONES] : [];
	});

	const source = () => props.shape?.attrs["data-embed"] ?? "";

	/**
	 * What a connector's ends can be, plus whatever it currently names.
	 *
	 * The current value is included even when nothing on the board has that id, because
	 * a dangling end is precisely when somebody opens this panel: a `<select>` that
	 * silently displays its first option instead would say the arrow points somewhere it
	 * does not, and then write that as an edit nobody asked for.
	 */
	const ends = (current: string) => {
		const shape = props.shape;
		const others = (shape?.ids ?? []).filter((id) => id !== shape?.id);
		return current && !others.includes(current) ? [current, ...others] : others;
	};

	/**
	 * A field that commits on Enter or on leaving, and abandons on Escape.
	 *
	 * Per keystroke would be a patch per keystroke — coalesced, but still a write and
	 * a revision per letter, and the revision list is the undo history (§6.7).
	 */
	const field = (name: string, value: () => string, commit: (next: string) => void, placeholder?: string) => (
		<input
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
					<header>
						{/* What it is, said in the board's own words: the class an agent would
						    have written, or the tag when there is no class we know. */}
						<span class="what">{shape().box ?? (shape().family === "link" ? "connector" : shape().family === "embed" ? "embed" : shape().classes[0] ?? shape().tag)}</span>
						{field("name", () => shape().id, (next) => next && props.onEdit({ kind: "rename", to: next }))}
					</header>

					<Show when={shape().family === "box"}>
						<div class="row boxes">
							<For each={BOX_CLASSES}>
								{(box) => (
									<button
										type="button"
										data-box={box}
										data-active={shape().box === box}
										title={`Make this a ${box}`}
										onClick={() => props.onEdit({ kind: "box", to: box as BoxClass })}
									>
										{box}
									</button>
								)}
							</For>
						</div>
					</Show>

					<Show when={tones().length > 0}>
						<div class="row tones">
							<span class="label">tone</span>
							{/* The default is a tone too — it is the absence of the attribute, and
							    saying so is what makes going back possible. */}
							<button
								type="button"
								data-tone="default"
								data-active={!shape().attrs["data-tone"]}
								title="Default"
								aria-label="Default tone"
								onClick={() => props.onEdit({ kind: "attr", name: "data-tone", value: null })}
							/>
							<For each={tones()}>
								{(tone) => (
									<button
										type="button"
										data-tone={tone}
										data-active={shape().attrs["data-tone"] === tone}
										title={tone}
										aria-label={`${tone} tone`}
										onClick={() => props.onEdit({ kind: "attr", name: "data-tone", value: tone })}
									/>
								)}
							</For>
						</div>
					</Show>

					<Show when={shape().family === "embed"}>
						<div class="row file">
							<span class="label">file</span>
							<span class="value" title={source()}>
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
							<div class="row">
								<span class="label">pages</span>
								{field(
									"pages",
									() => shape().attrs["data-pages"] ?? "",
									(next) => props.onEdit({ kind: "attr", name: "data-pages", value: next }),
									"all",
								)}
							</div>
						</Show>
					</Show>

					<Show when={shape().family === "link"}>
						<div class="row">
							<span class="label">from</span>
							<select
								name="from"
								value={shape().attrs["data-from"] ?? ""}
								onChange={(event) => props.onEdit({ kind: "attr", name: "data-from", value: event.currentTarget.value })}
							>
								<For each={ends(shape().attrs["data-from"] ?? "")}>{(id) => <option value={id}>{id}</option>}</For>
							</select>
						</div>
						<div class="row">
							<span class="label">to</span>
							<select
								name="to"
								value={shape().attrs["data-to"] ?? ""}
								onChange={(event) => props.onEdit({ kind: "attr", name: "data-to", value: event.currentTarget.value })}
							>
								<For each={ends(shape().attrs["data-to"] ?? "")}>{(id) => <option value={id}>{id}</option>}</For>
							</select>
						</div>
						<div class="row">
							<span class="label">label</span>
							{field("label", () => shape().attrs["data-label"] ?? "", (next) =>
								props.onEdit({ kind: "attr", name: "data-label", value: next }),
							)}
						</div>
					</Show>

					<div class="row acts">
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
						<span class="spacer" />
						<button
							type="button"
							data-act="remove"
							class="danger"
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
