import { draftLabel, type DraftMention, type MentionKind } from "./draft.ts";

/**
 * A pill, as it is drawn wherever one sits — in the field, and in a message you sent — and what it
 * says when you point at it or press it.
 *
 * Everything you put in a message is a pill in your words, where you put it: a comment, a board or a
 * card, a drawn item, a file. Pointing at one shows the host's dark tooltip (`data-tip`, with a quieter
 * second line in `data-tip-sub`); pressing one opens a small card over it: the thing it is about by
 * name, which shows it, the quote and the note, and the exact words the agent receives for it. Plain
 * DOM rather than components, because a pill is made outside JSX, inside an editable field.
 */

/** What a pill is about, as its tooltip and card tell it. The host knows; this file only draws. */
export interface PillAbout {
	/** The thing it is about: the board or card a comment is on, the board, the item, the file. */
	name: string;
	/** Which icon goes before the name: a card or board, a drawn item, a file. */
	of: "card" | "shape" | "file";
	quote?: string;
	note?: string;
	/** Who put it in and from where: "Your comment, on …", "From the canvas, …", "File, …". */
	source: string;
	/** The words the agent receives for this pill, from the same code that writes the message. */
	exact: string;
	/** Handed over by the canvas (a card's script can): the card's amber name says so. */
	canvas?: boolean;
}

export interface PillHost {
	about(node: DraftMention): PillAbout | undefined;
	/** Show what it is about: the board or item on the canvas, the file. */
	show?(node: DraftMention): void;
	/** Take it out of the draft. Only the composer offers this; a sent message cannot change. */
	remove?(node: DraftMention): void;
}

/*
 * Lucide's `message-square`, `layout-template`, `shapes` and `file`: a comment, a board or card, a thing
 * drawn on the stage, a file. The wash behind each is its own colour too (`styles/ink.css`).
 */
const svg = (body: string, size: number, slot: string) =>
	`<svg data-slot="${slot}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const BODIES = {
	comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
	card: '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/>',
	shape: '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
	file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
	x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
const PILL_ICONS: Record<MentionKind, string> = {
	comment: svg(BODIES.comment, 11, "pill-icon"),
	board: svg(BODIES.card, 11, "pill-icon"),
	item: svg(BODIES.shape, 11, "pill-icon"),
	file: svg(BODIES.file, 11, "pill-icon"),
};

/** The most of a name a pill shows: a long board title would otherwise wrap a sent message over lines. */
export const PILL_LIMIT = 20;

/** A pill's words, cut to `PILL_LIMIT` with an ellipsis. The whole name is in its tooltip and its card. */
export function pillWords(label: string): string {
	const flat = label.replace(/\s+/g, " ").trim();
	if (flat.length <= PILL_LIMIT) return flat;
	// A quotation keeps its closing mark, so it still reads as one.
	const quoted = flat.startsWith("“") && flat.endsWith("”");
	const cut = flat.slice(0, PILL_LIMIT - (quoted ? 2 : 1)).trimEnd();
	return quoted ? `${cut.replace(/…$/, "")}…”` : `${cut}…`;
}

/** A mention, as the DOM holds it. Atomic in an editable field because the browser is told it is. */
export function pillElement(node: DraftMention): HTMLElement {
	const span = document.createElement("span");
	span.contentEditable = "false";
	span.dataset.component = "mention-pill";
	span.dataset.kind = node.kind;
	span.dataset.mentionId = node.id;
	span.dataset.mentionLabel = node.label;
	if (node.name) span.dataset.mentionName = node.name;
	// A comment the canvas handed over: its card names it in amber.
	if (node.from === "canvas") span.dataset.from = "canvas";
	span.textContent = pillWords(draftLabel(node));
	// In front of the label, and no part of it: an icon contributes no text.
	span.insertAdjacentHTML("afterbegin", PILL_ICONS[node.kind] ?? PILL_ICONS.comment);
	return span;
}

/** The most of a quote or a note the tooltip shows; the card shows a few lines, Exact text all of it. */
const TIP_LIMIT = 160;
const clip = (words: string) => {
	const flat = words.replace(/\s+/g, " ").trim();
	return flat.length > TIP_LIMIT ? `${flat.slice(0, TIP_LIMIT - 1).trimEnd()}…` : flat;
};

/** The most of a name the tooltip shows; the card names it on one line, and its whole name shows there. */
const TIP_NAME_LIMIT = 32;
const clipName = (name: string) => {
	const flat = name.replace(/\s+/g, " ").trim();
	return flat.length > TIP_NAME_LIMIT ? `${flat.slice(0, TIP_NAME_LIMIT - 1).trimEnd()}…` : flat;
};

/** The tooltip's words for a pill: the quote and the note, then its name, cut short, and where it came from. */
export function pillTip(about: PillAbout): { tip: string; sub: string } {
	const said = [about.quote ? `“${clip(about.quote)}”` : "", clip(about.note ?? "")].filter(Boolean).join(" · ");
	if (!said) return { tip: clipName(about.name), sub: `${about.source} · click to read all` };
	return { tip: said, sub: `${clipName(about.name)} · ${about.source} · click to read all` };
}

let open: { pill: HTMLElement; card: HTMLElement; close: () => void } | undefined;

/** Put away the open card, if there is one. */
export function closePillCard(): void {
	open?.close();
}

/** Above the pill, or below it when there is no room above; never off the window's sides. */
function place(card: HTMLElement, pill: HTMLElement): void {
	const r = pill.getBoundingClientRect();
	const w = card.offsetWidth;
	const h = card.offsetHeight;
	card.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
	card.style.top = `${r.top - h - 8 > 8 ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - 8)}px`;
}

function button(className: string, html: string, label?: string): HTMLButtonElement {
	const b = document.createElement("button");
	b.type = "button";
	b.className = className;
	b.innerHTML = html;
	if (label) b.setAttribute("aria-label", label);
	return b;
}

/** The card a press on a pill opens; a second press on the same pill puts it away. */
export function openPillCard(pill: HTMLElement, node: DraftMention, host: PillHost): void {
	const again = open?.pill === pill;
	closePillCard();
	if (again) return;
	const about = host.about(node);
	if (!about) return;

	const card = document.createElement("div");
	card.className = "floatcard pill-card";
	card.setAttribute("role", "dialog");
	card.setAttribute("aria-label", about.name);
	const head = document.createElement("div");
	head.className = "pill-card-head";
	// The first line names what it is about, with its kind's icon; a press shows it.
	const name = button("pill-card-name", svg(BODIES[about.of], 15, "pill-card-icon"));
	const label = document.createElement("span");
	label.className = "pill-card-label";
	label.textContent = about.name;
	name.append(label);
	// One line, cut with an ellipsis (`ink.css`); the whole name is in the title.
	name.title = `${about.name} — ${about.of === "file" ? "open the file" : "show it on the canvas"}`;
	if (about.canvas) name.dataset.canvas = "true";
	if (host.show) name.onclick = () => host.show!(node);
	else name.disabled = true;
	const x = button("pill-card-x", svg(BODIES.x, 14, "pill-card-icon"), "Close");
	head.append(name, x);

	const body = document.createElement("div");
	body.className = "pill-card-body";
	const shown = () => {
		body.replaceChildren();
		if (about.quote) {
			const quote = document.createElement("blockquote");
			quote.textContent = about.quote;
			body.append(quote);
		}
		const note = document.createElement("div");
		note.textContent = about.note || about.source;
		body.append(note);
	};
	shown();

	const acts = document.createElement("div");
	acts.className = "pill-card-acts";
	// The exact words the agent receives for this pill, and back.
	const exact = button("", "Exact text");
	exact.dataset.act = "exact";
	exact.onclick = () => {
		const showing = exact.textContent === "Exact text";
		if (showing) {
			// The one place the whole of it is: a field of its own that scrolls (`ink.css`).
			const pre = document.createElement("pre");
			pre.textContent = about.exact;
			pre.tabIndex = 0;
			body.replaceChildren(pre);
		} else shown();
		exact.textContent = showing ? "As shown" : "Exact text";
		place(card, pill);
	};
	acts.append(exact);
	if (host.remove) {
		const remove = button("", "Remove");
		remove.dataset.act = "remove";
		remove.onclick = () => {
			closePillCard();
			host.remove!(node);
		};
		acts.append(remove);
	}
	card.append(head, body, acts);
	document.body.append(card);
	place(card, pill);
	pill.setAttribute("aria-expanded", "true");

	// Put away by ×, Escape, or a press anywhere but the card and its pill. Escape is the card's
	// alone: in the composer it would otherwise clear the whole draft.
	const key = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		close(true);
	};
	const press = (event: PointerEvent) => {
		const target = event.target as Node | null;
		if (target && (card.contains(target) || pill.contains(target))) return;
		close();
	};
	// The card is fixed to the window: when what is under it moves, it goes rather than float off its pill.
	const moved = (event: Event) => {
		if (!card.contains(event.target as Node | null)) close();
	};
	/** `back`: put away by a key or its ×, so the keyboard goes back to the field the pill is in. */
	const close = (back = false) => {
		document.removeEventListener("keydown", key, true);
		document.removeEventListener("pointerdown", press, true);
		document.removeEventListener("scroll", moved, true);
		removeEventListener("resize", resized);
		removeEventListener("blur", away);
		card.remove();
		pill.setAttribute("aria-expanded", "false");
		if (open?.card === card) open = undefined;
		const field = pill.closest<HTMLElement>("[contenteditable='true']");
		if (back && field && pill.isConnected) {
			field.focus();
			const range = document.createRange();
			range.setStartAfter(pill);
			range.collapse(true);
			getSelection()?.removeAllRanges();
			getSelection()?.addRange(range);
		}
	};
	// A press in a frame (the canvas) reaches no listener here; the window losing focus to it says so.
	const away = () => setTimeout(() => document.activeElement?.tagName === "IFRAME" && close());
	x.onclick = () => close(true);
	document.addEventListener("keydown", key, true);
	document.addEventListener("pointerdown", press, true);
	document.addEventListener("scroll", moved, true);
	const resized = () => close();
	addEventListener("resize", resized);
	addEventListener("blur", away);
	open = { pill, card, close: () => close() };
}

/**
 * Pills under `root` answer pointing and pressing: the tooltip's words are written onto a pill as the
 * pointer arrives (before the host's tooltip reads them, which listens on the document), and a press
 * opens its card. Returns what takes the listeners off.
 */
export function wirePills(root: HTMLElement, host: () => PillHost | undefined, nodeOf: (el: HTMLElement) => DraftMention | null): () => void {
	const pillAt = (target: EventTarget | null) => {
		const pill = (target as Element | null)?.closest?.<HTMLElement>('[data-component="mention-pill"]');
		return pill && root.contains(pill) ? pill : null;
	};
	const over = (event: PointerEvent) => {
		const pill = pillAt(event.target);
		const node = pill && nodeOf(pill);
		const about = node && host()?.about(node);
		if (!pill || !about) return;
		const { tip, sub } = pillTip(about);
		pill.dataset.tip = tip;
		pill.dataset.tipSub = sub;
		pill.dataset.side = "top";
		pill.removeAttribute("title");
		if (about.canvas) pill.dataset.from = "canvas";
	};
	const click = (event: MouseEvent) => {
		const pill = pillAt(event.target);
		const node = pill && nodeOf(pill);
		const using = host();
		if (!pill || !node || !using) return;
		event.preventDefault();
		// A press selects a pill whole (`user-select: all`); the caret goes after it, so the next key types
		// beside the pill rather than over it.
		const selection = getSelection();
		if (selection?.containsNode(pill, true)) {
			const range = document.createRange();
			range.setStartAfter(pill);
			range.collapse(true);
			selection.removeAllRanges();
			if (root.isContentEditable) selection.addRange(range);
		}
		openPillCard(pill, node, using);
	};
	root.addEventListener("pointerover", over);
	root.addEventListener("click", click);
	return () => {
		root.removeEventListener("pointerover", over);
		root.removeEventListener("click", click);
	};
}

/** A pill's mention, read back from its element. */
export function pillNode(el: HTMLElement): DraftMention | null {
	const { mentionId: id, mentionLabel: label, mentionName: name, kind } = el.dataset;
	if (!id || !label || !kind || !(kind in PILL_ICONS)) return null;
	return { type: "mention", kind: kind as MentionKind, id, label, ...(name ? { name } : {}), ...(el.dataset.from === "canvas" ? { from: "canvas" as const } : {}) };
}
