import type { SlashCommand } from "@decks/protocol";
import { createEffect, createMemo, createSignal, untrack, type Accessor } from "solid-js";
import { type WaitingComment } from "../../state/index.ts";
import { carriesFiles } from "../../files/index.ts";
import { draftComments, draftForAgent, draftIsEmpty, draftText, fileMention, normalize, textDraft, type Draft } from "../draft/model.ts";
import type { DraftFieldApi } from "../draft/view.tsx";
import type { PillHost } from "../pill/card.ts";
import { aboutAddress, aboutComment, commentPill } from "../pill/about.ts";
import { filterCommands } from "../slash-menu/model.ts";
import { filterMentionables, type Mentionable } from "../mention-menu/model.ts";
import { atQuery, goneComments, parkedDrafts, reconcilePills, slashFragment, withMentionAt, wrapIndex } from "./model.ts";
import type { ComposerProps } from "./view.tsx";

// What the composer does: its draft and the words handed to it, the slash and @ menus,
// the keys and sending, the queue's buttons, and files dropped on it.

/** The field's handle, once it has mounted. */
export interface FieldRef {
	api?: DraftFieldApi;
}

/** The parts the keys and the send button act on. */
export interface Bar {
	props: ComposerProps;
	draft: DraftState;
	slash: ReturnType<typeof createSlash>;
	mentions: ReturnType<typeof createMentions>;
	ime: ReturnType<typeof createIme>;
}

// The draft, kept per page, and words the deck hands over.
/** What the field holds: a draft of words and pills, kept per page, and what each pill is about. */
export function createDraft(props: ComposerProps, field: FieldRef) {
	const [nodes, setNodes] = createSignal<Draft>([]);
	const text = createMemo(() => draftText(nodes()));
	const parked = parkedDrafts(typeof localStorage === "undefined" ? undefined : localStorage);
	let held: string | undefined;
	/** Replace what the field holds, for a change nobody typed. */
	const put = (draft: Draft) => {
		const next = normalize(draft);
		setNodes(next);
		field.api?.set(next);
		props.onText?.(draftText(next));
		if (held !== undefined) parked.set(held, next);
	};
	const pillFor = (comment: WaitingComment) => commentPill(comment, props.titleOf, props.itemName);
	const commentOf = (id: string) => props.comments?.find((candidate) => candidate.id === id);
	// A comment's number is its place among the comment pills, the number the message gives it.
	const pills: PillHost = {
		about: (node) => {
			if (node.kind !== "comment") return aboutAddress(node, props.titleOf, props.itemName);
			const comment = commentOf(node.id);
			return comment ? aboutComment(comment, draftComments(nodes()).indexOf(node.id) + 1, props.titleOf, props.itemName) : undefined;
		},
		show: (node) => props.onShowPill?.(node, node.kind === "comment" ? commentOf(node.id) : undefined),
		remove: (node) => field.api?.remove(node),
	};
	// Arriving at a page brings back its words, agreeing with the comments still waiting for it.
	createEffect(() => {
		const next = props.page;
		if (next === held) return;
		held = next;
		const waiting = untrack(() => props.comments ?? []);
		put(reconcilePills(parked.get(next) ?? [], waiting.map((comment) => comment.id), (id) => pillFor(waiting.find((comment) => comment.id === id)!)));
	});
	takeHandedDrafts(props, field, put, pillFor);
	/** Typed: remembered for the page, and a deleted pill's comment is let go. */
	const onDraft = (draft: Draft) => {
		setNodes(draft);
		if (held !== undefined) parked.set(held, draft);
		props.onText?.(draftText(draft));
		const gone = goneComments(draftComments(draft), props.comments ?? []);
		if (gone.length > 0) props.onCommentsGone?.(gone);
	};
	return { nodes, text, put, pills, onDraft };
}

/** A draft the deck hands over goes in once, to its own conversation only, and takes the caret. */
function takeHandedDrafts(props: ComposerProps, field: FieldRef, put: (draft: Draft) => void, pillFor: (c: WaitingComment) => ReturnType<typeof commentPill>): void {
	createEffect(() => {
		const handed = props.draft;
		if (!handed) return;
		void handed.at;
		// Untracked after reading the draft, so a sent mention never comes back.
		untrack(() => {
			if (handed.agentId === undefined || handed.agentId === props.agentId) {
				const kept = handed.comment ? props.comments?.find((candidate) => candidate.id === handed.comment) : undefined;
				// A kept comment, a dragged card or item, and a file arrive as pills; words go in at the caret.
				if (kept) field.api?.append(pillFor(kept));
				else if (handed.pills?.length) for (const pill of handed.pills) field.api?.append({ type: "mention", ...pill });
				else if (handed.files?.length) for (const path of handed.files) field.api?.insertPill(fileMention(path));
				else if (handed.insert) field.api?.insertText(handed.text);
				else put(textDraft(handed.text));
				field.api?.focus();
			}
			props.onDraftTaken?.();
		});
	});
}

type DraftState = ReturnType<typeof createDraft>;

// The slash and @ menus.
/** The `/` menu: open on a bare command draft, its highlighted row reset as the list changes. */
export function createSlash(props: ComposerProps, draft: DraftState, field: FieldRef) {
	const fragment = createMemo(() => slashFragment(draft.text()));
	const matches = createMemo(() => {
		const query = fragment();
		return query === null ? [] : filterCommands(props.commands, query);
	});
	const open = createMemo(() => matches().length > 0);
	const [index, setIndex] = createSignal(0);
	createEffect(() => {
		matches();
		setIndex(0);
	});
	/** `/name ` and a space, never the argument placeholder. */
	const pick = (command: SlashCommand) => {
		draft.put(textDraft(`/${command.name} `));
		field.api?.focus();
	};
	return { fragment, matches, open, index, setIndex, pick };
}

/** The `@` completion under the caret; Escape dismisses it for the word typed so far. */
export function createMentions(props: ComposerProps, draft: DraftState, field: FieldRef, slashOpen: Accessor<boolean>) {
	const [caret, setCaret] = createSignal(0);
	const [dismissed, setDismissed] = createSignal<string | null>(null);
	const query = createMemo(() => atQuery(draft.text(), caret()));
	const matches = createMemo(() => {
		const q = query();
		if (q === null || !props.mentionables?.length || dismissed() === q) return [];
		return filterMentionables(props.mentionables, q);
	});
	const open = createMemo(() => matches().length > 0 && !slashOpen());
	const [index, setIndex] = createSignal(0);
	createEffect(() => {
		matches();
		setIndex(0);
	});
	const pick = (one: Mentionable) => {
		const words = withMentionAt(draft.text(), caret(), query() ?? "", one.name);
		if (draft.nodes().every((node) => node.type === "text") && words !== undefined) draft.put(textDraft(words));
		// Pills in the draft: the field's own insert keeps them, and the typed fragment stays.
		else field.api?.insertText(`@${one.name}`);
		setDismissed(null);
		field.api?.focus();
	};
	return { setCaret, query, matches, open, index, setIndex, pick, dismiss: () => setDismissed(query()) };
}

// The keys and sending.
/** Telling an input method's Enter apart from the person's. */
export function createIme() {
	let composing = false;
	let endedAt = 0;
	return {
		onComposing: (now: boolean) => {
			composing = now;
			if (!now) endedAt = Date.now();
		},
		owns: (event: KeyboardEvent) => event.isComposing || event.keyCode === 229 || composing || Date.now() - endedAt < 50,
	};
}

/** Send the line, or queue it for the turn's end; an open menu completes its row instead. */
export function send(bar: Bar, queue = false): void {
	const { props, draft, slash, mentions } = bar;
	if (mentions.open()) {
		const chosen = mentions.matches()[mentions.index()] ?? mentions.matches()[0];
		if (chosen) return mentions.pick(chosen);
	}
	// "/lo" Enter is "login"; a name typed out in full completes to itself, and the next Enter sends.
	const chosen = slash.matches()[slash.index()] ?? slash.matches()[0];
	if (chosen && chosen.name !== slash.fragment()) return slash.pick(chosen);
	const nodes = draft.nodes();
	if (draftIsEmpty(nodes)) return;
	if (queue && props.busy && props.onQueue) props.onQueue(draftForAgent(nodes), draftComments(nodes), nodes);
	else props.onSend(draftForAgent(nodes), draftComments(nodes), nodes);
	// Forgetting the page's parked copy too, so a sent line never comes back.
	draft.put([]);
}

/** The field's keys. Each is destructive, so the input method is asked first. */
export function fieldKeys(bar: Bar, event: KeyboardEvent): void {
	if (bar.ime.owns(event) || menuKeys(bar, event)) return;
	if (event.key === "Escape") {
		bar.draft.put([]);
		bar.props.onCommentsGone?.((bar.props.comments ?? []).map((comment) => comment.id));
		return;
	}
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		// Ctrl or ⌘ with Enter queues for the turn's end; Enter alone steers it.
		send(bar, event.ctrlKey || event.metaKey);
	}
}

/** While a menu is up it owns the arrows (wrapping), Tab, and for the @ menu Escape. */
function menuKeys(bar: Bar, event: KeyboardEvent): boolean {
	const { mentions, slash } = bar;
	const menu = mentions.open() ? mentions : slash.open() ? slash : undefined;
	if (!menu) return false;
	const length = menu.matches().length;
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		menu.setIndex((at) => wrapIndex(at, event.key === "ArrowDown" ? 1 : -1, length));
		return true;
	}
	if (event.key === "Tab" && menu === mentions) {
		event.preventDefault();
		mentions.pick(mentions.matches()[mentions.index()] ?? mentions.matches()[0]!);
		return true;
	}
	if (event.key === "Tab" && menu === slash && slash.matches()[slash.index()]) {
		event.preventDefault();
		slash.pick(slash.matches()[slash.index()]!);
		return true;
	}
	if (event.key === "Escape" && menu === mentions) {
		event.preventDefault();
		mentions.dismiss();
		return true;
	}
	return false;
}

// The queue, and files dropped on the box.
/** A queued line put back in the box, after whatever is there. */
export function editQueued(bar: Bar, field: FieldRef, item: { id: string; text: string }): void {
	bar.props.onQueueAction?.("remove", item.id);
	const nodes = bar.draft.nodes();
	bar.draft.put([...nodes, { type: "text", text: (draftIsEmpty(nodes) ? "" : " ") + item.text }]);
	field.api?.focus();
}

/** Send all now: a held queue is released, else every line goes now as a steer. */
export function sendAllQueued(props: ComposerProps, queued: { items: Array<{ id: string }>; held: boolean }): void {
	if (queued.held) return props.onQueueAction?.("release");
	for (const item of queued.items) props.onQueueAction?.("send", item.id);
}

/** Files dragged over the box: it says it will take them, and a drop hands them to the shell. */
export function dropHandlers(props: ComposerProps, setDropping: (on: boolean) => void) {
	return {
		onDragOver: (event: DragEvent) => {
			if (!props.onDropFiles || !carriesFiles(event.dataTransfer)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			setDropping(true);
		},
		onDragLeave: (event: DragEvent) => {
			if (!(event.currentTarget as Node).contains(event.relatedTarget as Node | null)) setDropping(false);
		},
		onDrop: (event: DragEvent) => {
			if (!props.onDropFiles || !carriesFiles(event.dataTransfer)) return;
			event.preventDefault();
			// The bar's, not the canvas's: the page's own guard would make a card of it.
			event.stopPropagation();
			setDropping(false);
			const files = Array.from(event.dataTransfer?.files ?? []);
			if (files.length > 0) props.onDropFiles(files);
		},
	};
}
