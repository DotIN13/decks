import { createEffect, createMemo, createSignal } from "solid-js";
import { type Draft, type DraftFieldApi, textDraft } from "@decks/agent-ui/composer";
import { filterMentionables, type Mentionable } from "./MentionMenu.tsx";

/**
 * The composer's `@` completion: the word at the caret, when it starts with an @ that begins a
 * word, and the names it could be (`MentionMenu`).
 *
 * Reads the caret rather than the end of the text, so a name can be completed in the
 * middle of a line. Escape puts the query away without clearing the draft, which is what
 * Escape otherwise does here; typing on changes the query and brings the list back.
 */
export function createMentionCompletion(host: {
	/** The draft's text, and the draft itself. */
	text: () => string;
	nodes: () => Draft;
	/** Replace what the field holds (the composer's `put`). */
	put: (draft: Draft) => void;
	field: () => DraftFieldApi | undefined;
	/** Everybody an `@` can name. */
	mentionables: () => Mentionable[] | undefined;
	/** The command menu is up: it has the keys, and this list stays shut. */
	commandsOpen: () => boolean;
}) {
	const [caret, setCaret] = createSignal(0);
	const [dismissed, setDismissed] = createSignal<string | null>(null);
	const query = createMemo(() => {
		const match = AT.exec(host.text().slice(0, caret()));
		return match ? match[2]! : null;
	});
	const matches = createMemo(() => {
		const typed = query();
		const mentionables = host.mentionables();
		if (typed === null || !mentionables?.length || dismissed() === typed) return [];
		return filterMentionables(mentionables, typed);
	});
	const open = createMemo(() => matches().length > 0 && !host.commandsOpen());
	/** Which row the arrows are on. Reset whenever the list under it changes. */
	const [index, setIndex] = createSignal(0);
	createEffect(() => {
		matches();
		setIndex(0);
	});

	const pick = (one: Mentionable) => {
		const typed = query() ?? "";
		const whole = host.text();
		const at = caret() - typed.length - 1;
		if (host.nodes().every((node) => node.type === "text") && at >= 0) {
			const after = whole.slice(caret());
			host.put(textDraft(`${whole.slice(0, at)}@${one.name}${after.startsWith(" ") ? "" : " "}${after}`));
		} else {
			// Pills in the draft: the field's own insert keeps them, at the cost of the typed fragment staying.
			host.field()?.insertText(`@${one.name}`);
		}
		setDismissed(null);
		host.field()?.focus();
	};

	/** Enter while the list is up: the highlighted name goes in rather than the message going out. Says whether it did. */
	const complete = (): boolean => {
		if (!open()) return false;
		const chosen = matches()[index()] ?? matches()[0];
		if (!chosen) return false;
		pick(chosen);
		return true;
	};

	/** While the list is up it owns the arrows, Tab and Escape. Says whether the key was its. */
	const keyDown = (event: KeyboardEvent): boolean => {
		if (!open() || !LIST_KEYS.has(event.key)) return false;
		event.preventDefault();
		const length = matches().length;
		if (event.key === "ArrowDown") setIndex((at) => (at + 1) % length);
		else if (event.key === "ArrowUp") setIndex((at) => (at - 1 + length) % length);
		else if (event.key === "Tab") pick(matches()[index()] ?? matches()[0]!);
		else setDismissed(query());
		return true;
	};

	return { open, matches, index, setIndex, setCaret, pick, complete, keyDown };
}

const AT = /(^|\s)@([A-Za-z0-9_-]*)$/;
const LIST_KEYS = new Set(["ArrowDown", "ArrowUp", "Tab", "Escape"]);
