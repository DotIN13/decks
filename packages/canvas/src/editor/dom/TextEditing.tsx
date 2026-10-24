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
import { indexOf, isCard, isMarkdown, makeLabel, shapeLabel, type Op, type PenDocument, type PenNode } from "@decks/pen";
import { isScribbleCatch, ScribbleCatch } from "@decks/ui";
import { createEffect, createMemo, onCleanup, Show } from "solid-js";
import { setPenTyping } from "../../state/pen-tools.ts";
import { cardChildren, cardEdits, cardMarkdown, CARD_GAP, CARD_PAD, CARD_RADIUS, heldLabels } from "../../pen/card-frame.ts";
import { CardEditor } from "../../pen/CardEditor.tsx";
import { CARD_PALETTE, NOTE_RADIUS, pageFont } from "../../pen/look.ts";
import { dropSlot } from "../core/drop.ts";
import type { Pt, Rect } from "../core/model.ts";
import type { NextId } from "../core/ops.ts";
import type { Picked } from "../core/pick.ts";
import type { EngineSeam, SceneQuery } from "../core/scene.ts";
import { cancelOps, cardInner as cardInnerOf, cardLook as cardLookOf, cardOf as cardOfIn, commitOf, emptyVanishes, fileOf, labelBox, legacyCard, pictureUrls, shapeOf as shapeOfIn, textLook, type TextLook, type TextSession } from "../core/text.ts";
import type { Editor } from "./controller.ts";
import { pictureAddress } from "../../host.ts";

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
	/** Whether the drawing can be edited here (`Stage`'s `onPenEdit`). */
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

	/**
	 * Type a shape's words: its own, or a new text made inside it, centred and as wide as the shape,
	 * which goes again if nothing is typed (`commitPenText`, `fresh`).
	 */
	const openShapeWords = (id: string) => {
		const current = doc();
		const frame = current ? indexOf(current).get(id)?.node : undefined;
		const box = host.scene.item(id)?.box;
		if (!frame || !box) return;
		editor.select([id]);
		const label = shapeLabel(frame);
		if (label) {
			const placed = host.scene.item(label.id);
			openPenText({ id: label.id, node: label, box: placed?.box ?? box });
			return;
		}
		const labelId = host.freshId();
		const node = makeLabel(labelId);
		host.edit([{ op: "insert", parent: id, node }]);
		openPenText({ id: labelId, node, box: labelBox(box) }, true);
	};
	const openPenText = (given: Picked, fresh?: boolean) => {
		// The item as the server has it now: what the canvas last drew can be a save behind.
		const pen = host.pen();
		const now = pen ? indexOf(pen.doc).get(given.id)?.node : undefined;
		const hit = now ? { ...given, node: now } : given;
		// A card, or one of its blocks: the whole card is typed into, as one piece of markdown.
		const card = isCard(hit.node) ? hit.node : cardOf(hit.id);
		if (card) return openCard(card, hit.box, fresh);
		const node = hit.node;
		const placed = host.scene.item(hit.id);
		const box = placed?.box ?? hit.box;
		host.engine.muteText(new Set([hit.id]));
		setOpen({ id: hit.id, box: { ...box }, value: typeof node.content === "string" ? node.content : "", style: textLookOf(placed?.node ?? node, placed), kind: node.type, ...(fresh ? { fresh } : {}), ...(isMarkdown(node) ? { legacy: true as const } : {}) });
	};
	/** A file's chip, or its icon or name: the file opens in a tab of its own. Answers whether it was one. */
	const openFileOf = (id: string): boolean => {
		// The chip itself, or anything inside it: a file card's picture, tile, name.
		const file = fileOf(doc(), id);
		if (!file) return false;
		editor.select([file.id]);
		window.open(new URL(file.metadata.path, new URL(host.pen()?.base || "/", location.origin)).href, "_blank", "noopener");
		return true;
	};
	// While a card is typed into its toolbar is the panel, so the properties stand aside.
	createEffect(() => setPenTyping(!!open() && !!open()!.card));
	onCleanup(() => setPenTyping(false));
	const openCard = (card: PenNode, at: Rect, fresh?: boolean, where?: { insertAt?: number; caretAt?: Pt }) => {
		const placed = host.scene.item(card.id);
		const kids = card.children ?? [];
		editor.select([card.id]);
		host.engine.muteText(new Set(kids.filter((child) => child.type === "text").map((child) => child.id)));
		setOpen({ id: card.id, box: { ...(placed?.box ?? at) }, value: cardMarkdown(kids), style: cardLook(card), card: true, held: heldLabels(kids), ...(fresh ? { fresh } : {}), ...where });
	};
	/**
	 * A double-click or a double tap on a card: on its words, the card opens with the caret there; in a
	 * gap, between blocks or in its padding, a new empty line is made there to type into. Answers
	 * whether it was a card. The canvas menu is for empty canvas only.
	 */
	const openCardAt = (hit: Picked, at: Pt, client: Pt): boolean => {
		const card = isCard(hit.node) ? hit.node : cardOf(hit.id);
		if (!card) return false;
		const pen = host.pen();
		const current = (pen ? indexOf(pen.doc).get(card.id)?.node : undefined) ?? card;
		const box = host.scene.item(card.id)?.box ?? hit.box;
		if (hit.node.id === card.id) openCard(current, box, false, { insertAt: dropSlot(host.scene, card.id, at, [])?.index ?? (current.children ?? []).length });
		else openCard(current, box, false, { caretAt: client });
		return true;
	};
	// The editor's font, fetched before it is first needed so the words never open in a stand-in.
	createEffect(() => {
		if (!host.pen()) return;
		pageFont("Inter", 400, false);
		pageFont("Inter", 600, false);
	});

	/**
	 * The drawing laid out with the words being typed, so what holds them grows as they are typed:
	 * a card round its title, a note round its words. A copy of the document with the one item's
	 * words changed, drawn in place of the real one until the server answers with the real edit.
	 * Once a frame at most.
	 */
	let typedFrame: number | undefined;
	let typedValue: { id: string; value: string } | undefined;
	const previewTyped = (id: string, value: string) => {
		typedValue = { id, value };
		typedFrame ??= requestAnimationFrame(() => showTyped());
	};
	/** The typed words drawn now, not at the next frame: what putting the editor away draws in its place. */
	const showTyped = () => {
		{
			if (typedFrame !== undefined) cancelAnimationFrame(typedFrame);
			typedFrame = undefined;
			const current = doc();
			if (!current || !typedValue) return;
			const copy = structuredClone(current);
			const found = indexOf(copy).get(typedValue.id);
			if (!found) return;
			if (isCard(found.node)) {
				// The card grows as its blocks are typed: stand-in ids, swapped for real ones when it is saved.
				let n = 0;
				found.node.children = cardChildren(typedValue.value, found.node.children ?? [], { fresh: () => `typing-${n++}`, inner: cardInner(found.node), size: pictureSize });
			} else found.node.content = typedValue.value;
			host.engine.showDoc(copy, host.pen()?.base ?? "");
		}
	};
	/** Back to the document as the server has it, for an edit taken back with Escape. */
	const dropTyped = () => {
		if (typedFrame !== undefined) cancelAnimationFrame(typedFrame);
		typedFrame = undefined;
		typedValue = undefined;
		host.engine.showDoc(host.pen()?.doc, host.pen()?.base ?? "");
	};
	onCleanup(() => {
		if (typedFrame !== undefined) cancelAnimationFrame(typedFrame);
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
		if (editorGhost) ghostUntil = host.engine.mark();
	};
	/*
	 * A still copy of the editor, left where the editor was when the typing was put away, until the
	 * canvas has a frame with the words in it. Without it the words were gone for two or three frames:
	 * the editor was taken away at once, and the canvas, which leaves the words out while they are
	 * the editor's, drew them only once the server's answer had been laid out.
	 */
	let editorGhost: HTMLElement | undefined;
	/** The copy goes with the first frame painted after the canvas heard it may draw the words (`layer.ts`, `mark`). */
	let ghostUntil: number | undefined;
	const leaveGhost = () => {
		dropGhost();
		const live = host.world()?.querySelector<HTMLElement>(":scope > .pen-text");
		if (!live) return;
		const copy = live.cloneNode(true) as HTMLElement;
		if (live instanceof HTMLTextAreaElement) (copy as HTMLTextAreaElement).value = live.value;
		// Only the words and what holds them: not the card's style bar, the caret, or the focus ring.
		for (const extra of copy.querySelectorAll(".pce-bar, [data-editorGhost-skip]")) extra.remove();
		copy.removeAttribute("id");
		copy.setAttribute("aria-hidden", "true");
		copy.setAttribute("tabindex", "-1");
		copy.querySelectorAll("[contenteditable]").forEach((el) => el.setAttribute("contenteditable", "false"));
		if (copy.hasAttribute("contenteditable")) copy.setAttribute("contenteditable", "false");
		copy.style.pointerEvents = "none";
		copy.style.boxShadow = "none";
		copy.style.caretColor = "transparent";
		copy.classList.add("pen-editorGhost");
		live.after(copy);
		editorGhost = copy;
		ghostUntil = undefined;
		// Never left standing: a sheet that paints nothing for a second has had its chance.
		const left = copy;
		setTimeout(() => {
			if (editorGhost === left && ghostUntil !== undefined) dropGhost();
		}, 1000);
	};
	const dropGhost = () => {
		editorGhost?.remove();
		editorGhost = undefined;
		ghostUntil = undefined;
	};
	onCleanup(dropGhost);

	const commitPenText = (value: string) => {
		const now = open();
		if (now) leaveGhost();
		setOpen(undefined);
		// Against the document the server has: the one drawn already has the typed words in it.
		const pen = host.pen();
		const node = now && pen ? indexOf(pen.doc).get(now.id)?.node : undefined;
		const was = now && node ? (now.card ? cardMarkdown(node.children ?? []) : node.content) : undefined;
		const commit = commitOf(now, value, was, host.editable());
		switch (commit.do) {
			case "close":
				return unmuteNow();
			case "vanish":
				unmuteNow();
				dropTyped();
				return host.edit(commit.ops);
			case "unchanged":
				unmuteNow();
				return dropTyped();
		}
		const session = now!;
		if (unmute) clearTimeout(unmute.timer);
		/*
		 * The words as typed are drawn at once, from a copy of the drawing (`showTyped`), and the canvas
		 * may draw them now: the editor's still copy stands over them until that frame is on screen. It
		 * used to wait for the server's answer to be drawn, and a card's words, which keep their ids in
		 * the answer, were left out for a frame after its copy had already shown them.
		 */
		typedValue = { id: session.id, value };
		showTyped();
		unmuteNow();
		if (commit.do === "update") {
			host.edit(commit.ops);
			return;
		}
		// A card is saved as edits to its blocks, each untouched block left alone. A note card from before
		// becomes a card frame here, in its place. Pictures are measured first, for their shape.
		void measurePictures(value).then(() => {
			const later = host.pen();
			const current = later ? indexOf(later.doc).get(session.id)?.node : undefined;
			const base = current ?? node;
			if (!base) return unmuteNow();
			const card = isCard(base) ? base : legacyCard(base, { gap: CARD_GAP, pad: CARD_PAD, radius: CARD_RADIUS });
			const children = cardChildren(value, card.children ?? [], { fresh: host.nextIds(), inner: cardInner(card), size: pictureSize });
			// A card's blocks are edited one by one, and only the ones that changed; a note card becomes a frame.
			const ops = isCard(base) ? cardEdits(base.id, base.children ?? [], children) : [{ op: "replace" as const, id: session.id, node: { ...card, children } }];
			if (!ops.length) return unmuteNow();
			host.edit(ops);
		});
	};
	/** Escape: the words go back as they were, and a fresh text never typed into goes. */
	const cancel = () => {
		const now = open();
		setOpen(undefined);
		unmuteNow();
		dropTyped();
		const ops = cancelOps(now);
		if (ops.length) host.edit(ops);
	};
	/** Pictures' own sizes, as they arrive, so a picture put in a card keeps its shape. */
	const pictureSizes = new Map<string, { w: number; h: number } | null>();
	const pictureSize = (url: string) => pictureSizes.get(url) ?? undefined;
	const measurePictures = async (markdown: string) => {
		const urls = pictureUrls(markdown).filter((url) => !pictureSizes.has(url));
		await Promise.all(
			urls.map(
				(url) =>
					new Promise<void>((done) => {
						const image = new Image();
						const finish = (size: { w: number; h: number } | null) => {
							pictureSizes.set(url, size);
							done();
						};
						image.onload = () => finish(image.naturalWidth ? { w: image.naturalWidth, h: image.naturalHeight } : null);
						image.onerror = () => finish(null);
						setTimeout(() => finish(null), 1500);
						try {
							image.src = pictureAddress(url, new URL(host.pen()?.base || "/", location.origin).href);
						} catch {
							finish(null);
						}
					}),
			),
		);
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
			if (ghostUntil !== undefined && host.engine.shows(ghostUntil)) dropGhost();
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
								"box-shadow": `0 0 0 ${1.5 / props.zoom}px var(--color-accent)`,
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
							"box-shadow": `0 0 0 ${1.5 / props.zoom}px var(--color-accent)`,
						}}
						value={open.value}
						ref={(el) => {
							area = el;
							requestAnimationFrame(() => {
								el.focus();
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
							if (event.key === "Escape") {
								event.preventDefault();
								cancel();
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
