/**
 * Typing on the stage: a drawn item's words, a shape's, or a card's markdown, typed in an editor
 * laid over the item (`TextEditor`, the `.pen-text`), set exactly as the canvas sets them so the
 * words do not move when it opens or closes (`core/text.ts`, `textLook`).
 *
 * The session is the editor's state (`EditorState.text`); this opens it, draws the words as they
 * are typed (a copy of the drawing shown through the seam, `EngineSeam.showDoc`), and on the way
 * out writes what changed (`core/text.ts`, `commitOf`), leaving a still copy of the editor where it
 * was until the canvas has a frame with the words in it.
 *
 * Also the openers a double-click or a double tap reaches for that are not words: a file's chip.
 */
import { isCard, type Op, type PenDocument, type PenNode } from "@decks/pen";
import { isScribbleCatch, ScribbleCatch } from "@decks/ui";
import { createEffect, createMemo, onCleanup, Show } from "solid-js";
import { setPenTyping } from "../pen-tools.ts";
import { cardMarkdown, CARD_PAD } from "../../model/card-frame.ts";
import { CardEditor } from "../../cards/CardEditor.tsx";
import { CARD_PALETTE, NOTE_RADIUS, pageFont } from "../../look/look.ts";
import type { NextId } from "../core/ops.ts";
import type { EngineSeam, SceneQuery } from "../core/scene.ts";
import { cancelOps, cardInner as cardInnerOf, escapeKeeps, cardLook as cardLookOf, cardOf as cardOfIn, shapeOf as shapeOfIn, textLook, type TextLook, type TextSession } from "../core/text.ts";
import type { Editor } from "./controller.ts";
import { createPictureSizes } from "./picture-sizes.ts";
import { createTextCommit } from "./text-commit.ts";
import { createTextGhost } from "./text-ghost.ts";
import { createTypedPreview } from "./typed-preview.ts";
import { createTextOpen } from "./text-open.ts";

export type TextHost = {
	scene: SceneQuery;
	engine: EngineSeam;
	/** The stage's drawing and the folder its files are read against. */
	pen: () => { doc: PenDocument; base: string } | undefined;
	scheme: () => "light" | "dark";
	/** The stage's world: the editor is in it, and its still copy goes beside it. */
	world: () => HTMLElement | undefined;
	/** Counted up each time the engine lays the drawing out: where a made item is, once it is placed. */
	redrawn: () => number;
	/** Whether the drawing can be edited here (`CanvasView`'s `onPenEdit`). */
	editable: () => boolean;
	edit: (ops: Op[]) => void;
	/** An id no item has. */
	freshId: () => string;
	nextIds: () => NextId;
};

export function createTextEditing(editor: Editor, host: TextHost) {
	const doc = () => host.pen()?.doc;
	const open = editor.text;
	const setOpen = editor.setText;

	/** How the canvas sets an item's words, for the editor that types over them (`core/text.ts`, `textLook`). */
	const textLookOf = (node: PenNode, placed: Parameters<typeof textLook>[2]): TextLook => textLook(doc(), node, placed, host.scheme(), CARD_PALETTE[host.scheme()], pageFont);
	/** The shape an item is, or is part of (its outline or its words): the frame, by id. */
	const shapeOf = (id: string): string | undefined => shapeOfIn(doc(), id);
	/** The card an item is a block of, if it is one. */
	const cardOf = (id: string): PenNode | undefined => cardOfIn(doc(), id);
	/** A card's words, its padding and its paper, for the editor laid over it. */
	const cardLook = (card: PenNode): TextLook => cardLookOf(doc(), card, host.scheme(), CARD_PALETTE[host.scheme()], pageFont, CARD_PAD);
	/** How wide a card's words are: its width less its padding. */
	const cardInner = (card: PenNode) => cardInnerOf(card, host.scene.item(card.id)?.box.w, CARD_PAD);

	const { openPenText, openShapeWords, openCardAt, openFileOf } = createTextOpen({
		doc,
		host,
		editor,
		cardOf,
		setOpen,
		textLookOf,
		cardLook,
	});
	// While a card is typed into its toolbar is the panel, so the properties stand aside.
	createEffect(() => setPenTyping(!!open() && !!open()!.card));
	onCleanup(() => setPenTyping(false));
	// The editor's font, fetched before it is first needed so the words never open in a stand-in.
	createEffect(() => {
		if (!host.pen()) return;
		pageFont("Inter", 400, false);
		pageFont("Inter", 600, false);
	});

	const { pictureSize, measurePictures } = createPictureSizes({ host });
	const typedPreview = createTypedPreview({
		doc,
		cardInner,
		pictureSize,
		host,
	});
	const { dropTyped, showTyped, previewTyped } = typedPreview;
	onCleanup(() => {
		if (typedPreview.typedFrame !== undefined) cancelAnimationFrame(typedPreview.typedFrame);
	});
	/** Where the item being typed into is now: a made item is placed once the server answers. */
	const penTextBox = createMemo(() => {
		host.redrawn();
		const now = open();
		return now ? (host.scene.item(now.id)?.box ?? now.box) : undefined;
	});
	/*
	 * The canvas leaves the words out until it draws the new ones: taking the editor away before the
	 * server's answer has been drawn shows the old words for a moment, and then the new.
	 */
	let unmute: { id: string; value: string; timer: ReturnType<typeof setTimeout> } | undefined;
	const unmuteNow = () => {
		if (unmute) clearTimeout(unmute.timer);
		unmute = undefined;
		host.engine.muteText(undefined);
		// The canvas draws the words on its next frame: the editor's still copy goes then, not before.
		if (textGhost.editorGhost) textGhost.ghostUntil = host.engine.mark();
	};
	const textGhost = createTextGhost({ host });
	const { leaveGhost, dropGhost } = textGhost;

	const { commitPenText } = createTextCommit({
		open,
		leaveGhost,
		setOpen,
		host,
		unmuteNow,
		dropTyped,
		get unmute() { return unmute; },
		get typedValue() { return typedPreview.typedValue; },
		set typedValue(next) { typedPreview.typedValue = next; },
		showTyped,
		measurePictures,
		cardInner,
		pictureSize,
	});
	/**
	 * Escape: the words go back as they were, and a fresh text never typed into goes. An item a tool
	 * has just made keeps what was typed (`escapeKeeps`), given as `value`.
	 */
	const cancel = (value?: string) => {
		const now = open();
		if (value !== undefined && escapeKeeps(now)) return commitPenText(value);
		setOpen(undefined);
		unmuteNow();
		dropTyped();
		const ops = cancelOps(now);
		if (ops.length) host.edit(ops);
	};
	/** The words an item holds, for telling when the canvas has drawn a save: a card's are its blocks'. */
	const wordsOf = (node: PenNode | undefined) => (!node ? undefined : isCard(node) ? cardMarkdown(node.children ?? []) : node.content);

	return {
		/** The words open for typing, if any. */
		open,
		openPenText,
		openShapeWords,
		openCardAt,
		openFileOf,
		shapeOf,
		cardOf,
		/** How an item's words are set (`core/text.ts`, `textLook`): the grip lines up with a block's first line by it. */
		lookOf: textLookOf,
		cardInner,
		/** Where the item being typed into is now. */
		box: penTextBox,
		preview: previewTyped,
		commit: commitPenText,
		cancel,
		base: () => host.pen()?.base ?? "",
		/** The engine laid the drawing out: words saved and drawn are the canvas's to draw again. */
		drawn: () => {
			if (unmute && wordsOf(host.scene.item(unmute.id)?.node) === unmute.value) unmuteNow();
		},
		/** The sheet put a frame on screen: the still copy goes once the words are in one. */
		presented: () => {
			if (textGhost.ghostUntil !== undefined && host.engine.shows(textGhost.ghostUntil)) dropGhost();
		},
	};
}
export type TextEditing = ReturnType<typeof createTextEditing>;

/**
 * The editor laid over the item whose words are typed, in the world, in stage units: a card is
 * typed into as it reads (`pen/CardEditor.tsx`); a text or a note as its words, in a textarea.
 */
export function TextEditor(props: { text: TextEditing; zoom: number }) {
	return (
		<Show when={props.text.open()} keyed>
			{(open) => {
				const look = open.style;
				const box = () => props.text.box() ?? open.box;
				const cancel = props.text.cancel;
				// A card is typed into as it reads (`pen/CardEditor.tsx`); a text or a note as its words.
				if (look.markdown)
					return (
						<CardEditor
							class="pen-text"
							value={open.value}
							{...(open.insertAt !== undefined ? { insertAt: open.insertAt } : {})}
							{...(open.caretAt ? { caretAt: open.caretAt } : {})}
							{...(open.held ? { held: open.held } : {})}
							base={props.text.base()}
							zoom={props.zoom}
							style={{
								left: `${box().x}px`,
								top: `${box().y}px`,
								width: `${box().w}px`,
								"min-height": `${box().h}px`,
								padding: `${look.pad}px`,
								"font-family": look.font,
								"font-size": `${look.size}px`,
								"--card-size": `${look.size}px`,
								"font-weight": String(look.weight),
								"letter-spacing": `${look.spacing}px`,
								"line-height": look.line === undefined ? "1.5" : String(look.line),
								color: look.ink,
								background: look.paper ?? "transparent",
								// Rounded only where the item is: a note or a card has corners, words on the canvas do not.
								"border-radius": open.card || look.paper ? `${NOTE_RADIUS}px` : "0",
								"box-shadow": `0 0 0 ${1.5 / props.zoom}px var(--canvas-accent)`,
							}}
							onInput={(value) => props.text.preview(open.id, value)}
							onCommit={props.text.commit}
							onCancel={cancel}
						/>
					);
				let area: HTMLTextAreaElement | undefined;
				return (
					<>
					<ScribbleCatch target={() => area} onEnd={() => area && props.text.commit(area.value)} />
					<textarea
						class="pen-text"
						data-grows={look.grows}
						spellcheck={false}
						style={{
							left: `${box().x}px`,
							top: `${box().y}px`,
							...(look.grows === "wide" ? { "min-width": `${box().w + 1}px` } : { width: `${box().w}px` }),
							"min-height": `${box().h}px`,
							padding: `${look.pad}px`,
							"font-family": look.font,
							"font-size": `${look.size}px`,
							"font-weight": String(look.weight),
							"font-style": look.italic ? "italic" : "normal",
							"letter-spacing": `${look.spacing}px`,
							"line-height": look.line === undefined ? "normal" : String(look.line),
							"text-align": look.align as "left",
							color: look.ink,
							background: look.paper ?? "transparent",
							"border-radius": open.card || look.paper ? `${NOTE_RADIUS}px` : "0",
							"box-shadow": `0 0 0 ${1.5 / props.zoom}px var(--canvas-accent)`,
						}}
						value={open.value}
						ref={(el) => {
							area = el;
							requestAnimationFrame(() => {
								el.focus({ preventScroll: true });
								el.select();
							});
						}}
						onInput={(event) => props.text.preview(open.id, event.currentTarget.value)}
						onBlur={(event) => {
							// The pencil writing over the canvas (`ScribbleCatch`): committed when it is done, not now.
							if (isScribbleCatch(event.relatedTarget)) return;
							props.text.commit(event.currentTarget.value);
						}}
						onKeyDown={(event) => {
							/*
							 * Home and End move the caret to the line's start and end. On a Mac they scroll the
							 * nearest scroll area instead, which is now the stage (`camera/scroll-area.ts`), so a
							 * note's words were left selected and the next key typed over them.
							 */
							if ((event.key === "Home" || event.key === "End") && !event.metaKey && !event.ctrlKey && !event.altKey) {
								event.preventDefault();
								const el = event.currentTarget;
								const at = el.selectionDirection === "backward" ? el.selectionStart : el.selectionEnd;
								const to = event.key === "Home" ? el.value.lastIndexOf("\n", at - 1) + 1 : (() => {
									const end = el.value.indexOf("\n", at);
									return end === -1 ? el.value.length : end;
								})();
								if (event.shiftKey) {
									const anchor = el.selectionDirection === "backward" ? el.selectionEnd : el.selectionStart;
									el.setSelectionRange(Math.min(anchor, to), Math.max(anchor, to), to < anchor ? "backward" : "forward");
								} else el.setSelectionRange(to, to);
								return;
							}
							if (event.key === "Escape") {
								event.preventDefault();
								cancel(event.currentTarget.value);
							} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								event.currentTarget.blur();
							}
						}}
					/>
					</>
				);
			}}
		</Show>
	);
}

export type { TextLook, TextSession };
