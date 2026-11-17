import { onMount } from "solid-js";
import { ScribbleCatch } from "@decks/ui";
import { readCard, watchBlocks, writeCard, type WordsHost } from "./card-words.ts";
import { pictureAddress } from "../base/host.ts";
import type { CardEditorProps } from "./card-editor-props.ts";
import { CardBarView } from "./card-bar-view.tsx";
import { createCardKeys } from "./card-keys.ts";
import { createCardDrag } from "./card-drag.ts";
import { createCardPresses } from "./card-presses.ts";
import { createCardBlocks } from "./card-blocks.ts";
import { createCardBar } from "./card-bar.ts";
import { createCardPaste } from "./card-paste.ts";
import { createCardHistory } from "./card-history.ts";
import { createCardTyping } from "./card-typing.ts";
import { placeFirstCaret } from "./card-first-caret.ts";
import { listenOnPage } from "./card-page-listeners.ts";
import { followCard } from "./card-bar-follow.ts";

/**
 * The editor over a card (`CanvasView.tsx`): its words as they read, typed into in place, and written back
 * as the card's markdown (`card-syntax.ts`).
 *
 * Words style themselves as they are typed (`**bold**`, `==mark==`, `# ` at the start of a line), a
 * selection gets a bar of styles, an agent's suggestion waits for ✓ or ✕, and a picture, a file or a
 * `[[link]]` is a piece that drags: a whole-line piece between lines, an in-line one into a sentence,
 * with a ghost beside the pointer and a mark where it will land.
 *
 * A card can hold more than this editor can show as it reads: a table, raw HTML, a link definition.
 * Those stay as their markdown in a grey box, and a double click opens it as text. And a block that
 * was not touched is written back exactly as it was read: each top-level block keeps its source
 * (`data-raw`) until something in it changes, so an edit to one line never rewrites the rest.
 */
export function CardEditor(props: CardEditorProps) {
	let wrap!: HTMLDivElement;
	let ed!: HTMLDivElement;
	let bar!: HTMLDivElement;
	let caret!: HTMLDivElement;
	let tools!: HTMLDivElement;
	let line!: HTMLDivElement;
	/** Whitespace before the first block, kept as it was. */
	let lead = "";
	let trail = "";
	let done = false;
	const url = (src: string) => {
		try {
			return pictureAddress(src, new URL(props.base || "/", location.origin).href);
		} catch {
			return src;
		}
	};

	/* ---------- the card's markdown, in and out (`card-words.ts`) ---------- */

	const words: WordsHost = { url, held: (id) => props.held?.[id] };
	const build = (md: string) => {
		({ lead, trail } = readCard(words, ed, md));
	};
	const serialise = () => writeCard(ed, lead, trail);

	/* ---------- typing ---------- */

	const sel = () => getSelection()!;
	const topOf = (n: Node | null): HTMLElement | undefined => {
		while (n && n.parentNode !== ed) n = n.parentNode;
		return n instanceof HTMLElement ? n : undefined;
	};
	const { onInput } = createCardTyping({ sel, topOf, get ed() { return ed; }, get changed() { return changed; } });
	const cardHistory = createCardHistory({
		serialise, props, build, sel,
		get done() { return done; },
		get showBar() { return showBar; },
		get ed() { return ed; },
		get caretInto() { return caretInto; },
	});
	const { changed, travel, past } = cardHistory;
	const { onPaste } = createCardPaste({
		sel, build, topOf, words, changed,
		get ed() { return ed; },
		set ed(next) { ed = next; },
	});

	const cardBar = createCardBar({
		get bar() { return bar; },
		sel,
		get wrap() { return wrap; },
		props,
		get cardDrag() { return cardDrag; },
		get ed() { return ed; },
		get blockKind() { return blockKind; },
		get tools() { return tools; },
	});
	const { showBar, toggleMenu, closeMenus, placeBar } = cardBar;
	const { blockKind, restyle, style } = createCardBlocks({
		sel, topOf, toggleMenu, closeMenus, travel, changed,
		get ed() { return ed; },
		get caretInto() { return caretInto; },
	});

	const { onClick, onDblClick } = createCardPresses({ changed, get ed() { return ed; } });

	const cardDrag = createCardDrag({
		props, closeMenus, sel, changed,
		get wrap() { return wrap; },
		get caret() { return caret; },
		get line() { return line; },
		get ed() { return ed; },
	});
	const { endDrag, onPointerMove, onPointerDown } = cardDrag;

	const { caretInto, onKeyDown, onFocusOut, appendWords, commit } = createCardKeys({
		sel, props, serialise, changed, travel, restyle, endDrag,
		get done() { return done; },
		set done(next) { done = next; },
		get ed() { return ed; },
		get dragging() { return cardDrag.dragging; },
		get wrap() { return wrap; },
	});

	onMount(() => {
		document.execCommand("defaultParagraphSeparator", false, "p");
		build(props.value);
		const watch = watchBlocks(ed, topOf);
		past.push(serialise());
		followCard({ bar, wrap, closeMenus, placeBar });
		listenOnPage({ onPointerMove, endDrag, cardBar, showBar, ed, bar, watch, cardHistory });
		placeFirstCaret({ ed, props, caretInto, sel });
	});

	return (
		<div
			ref={wrap}
			class={`pen-card-editor ${props.class ?? ""}`}
			style={props.style}
			onKeyDown={onKeyDown}
			onFocusOut={onFocusOut}
			// A press in the card is the card's: not the start of a pan or a tap on the canvas behind it.
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ScribbleCatch target={() => ed} append={appendWords} context={() => (ed?.innerText ?? "").replace(/\s+$/, "")} onEnd={commit} />
			<div
				ref={ed}
				class="pce-body"
				contenteditable="true"
				spellcheck={false}
				onInput={(event) => onInput(event as InputEvent)}
				onPaste={onPaste}
				onClick={onClick}
				onDblClick={onDblClick}
				onPointerDown={onPointerDown}
				onMouseDown={(event) => {
					// A press on a suggestion's buttons or a check must not move the caret into it.
					if ((event.target as Element).closest(".pce-sug button, .pce-check")) event.preventDefault();
				}}
			/>
			<CardBarView bar={(el) => (bar = el)} tools={(el) => (tools = el)} onStyle={style} onScroll={closeMenus} />
			<div ref={caret} class="pce-caret" />
			<div ref={line} class="pce-line" />
		</div>
	);
}
