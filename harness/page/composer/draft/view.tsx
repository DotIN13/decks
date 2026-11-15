import { onMount } from "solid-js";
import type { Draft, DraftMention, DraftNode } from "./model.ts";
import type { PillHost } from "../pill/card.ts";
import { fieldApi, wireField, type Field } from "./actions.ts";
import { caretOffset, readDraft, writeDraft } from "./dom.ts";

/**
 * The composer's field: a small rich text editor whose only rich thing is a mention. Ported from picone
 * (the draft field, its §57), with the reasoning left as it was written there.
 */

export interface DraftFieldProps {
	draft: Draft;
	onDraft: (draft: Draft) => void;
	/** Where the caret is, as an offset into `draftText`, for the `@` menu. */
	onCaret: (caret: number) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	/** An IME has the keys, or has just let go of them: the composer asks before it sends. */
	onComposing?: (composing: boolean) => void;
	/** The words a pill shows on hover, as a `title`: for a host without `pills`. */
	describe?: (node: DraftMention) => string | undefined;
	/** What each pill is about: its tooltip, and the card a press on it opens (the pill's card). */
	pills?: PillHost;
	placeholder: string;
	/** The field's accessible name. The placeholder is a hint, not a name. */
	label?: string;
	disabled?: boolean;
	ref?: (api: DraftFieldApi) => void;
	/** Files pasted in (a screenshot, a file copied in the Finder): the composer attaches them. Absent: a paste is words only. */
	onPasteFiles?: (files: File[]) => void;
}

export interface DraftFieldApi {
	/** Replace the whole draft, an extension setting the text, or a reset. */
	set(draft: Draft): void;
	/** Put a mention where the caret is, replacing `back` characters before it. */
	insertMention(node: Extract<DraftNode, { type: "mention" }>, back: number): void;
	/** Append, for something kept rather than typed: a comment on a card. */
	append(node: DraftNode): void;
	/** Put plain words where the caret is, spaced from their neighbours: a dropped file's `@path`. */
	insertText(text: string): void;
	/** Add words at the end exactly as given, spaces and all: handwriting, which spaces its own words. */
	appendWords(text: string): void;
	/** Redraw the pills' hover words, after what they describe has changed. */
	retitle(): void;
	/** Put a pill where the caret is when the field has it, else at the end: a file attached or dropped. */
	insertPill(node: DraftMention): void;
	/** Take a pill out: the Remove on its card. */
	remove(node: DraftMention): void;
	focus(): void;
}

/** The field: a contenteditable box whose only rich thing is a pill. Typing never rebuilds it. */
export function DraftField(props: DraftFieldProps) {
	let el: HTMLDivElement | undefined;
	const sync = () => {
		if (!el) return;
		props.onDraft(readDraft(el));
		props.onCaret(caretOffset(el));
	};
	const f: Field = { el: () => el, props, sync };
	props.ref?.(fieldApi(f));
	onMount(() => {
		if (!el) return;
		writeDraft(el, props.draft, props.describe);
		wireField(f, el);
	});
	return (
		<div
			ref={el}
			class="dockfield"
			data-slot="composer-input"
			contentEditable={!props.disabled}
			role="textbox"
			aria-multiline="true"
			aria-label={props.label ?? props.placeholder}
			data-placeholder={props.placeholder}
			data-empty={props.draft.length === 0 ? "" : undefined}
			onInput={sync}
			onKeyUp={() => el && props.onCaret(caretOffset(el))}
			onClick={() => el && props.onCaret(caretOffset(el))}
			onKeyDown={props.onKeyDown}
			onCompositionStart={() => props.onComposing?.(true)}
			onCompositionEnd={() => props.onComposing?.(false)}
		/>
	);
}
