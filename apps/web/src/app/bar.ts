import { createSignal } from "solid-js";
import { messageParts } from "../composer/pill-about.ts";
import { getLocale, m } from "@decks/i18n";
import type { Draft } from "@decks/agent-ui/composer";
import { withComments } from "../markup/comments.ts";
import { takeComments } from "../state/comments.ts";
import { state } from "../state/deck.ts";
import { lookingAt } from "../tabs/about.ts";
import { notice } from "../state/notices.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { destination, stripMention, withoutName } from "./send-from-bar.ts";
import { canvasOnScreen } from "../tabs/tabs.ts";

/** What the bar names its pills by, read when a line is sent. */
interface BarNames {
	titleOf: (path: string) => string | undefined;
	itemName: (id: string) => string | undefined;
}

/*
 * The bar's destination, decided in one place.
 *
 * Where a line lands depends on who is focused and whether the text names an agent. The
 * word on the bar is this same function run without sending, so the label and the frame
 * cannot disagree. `barText` is what the composer holds right now, reported on every
 * keystroke, so an @ name changes the word as it is typed.
 */
export function createBar(names: BarNames) {
	const [barText, setBarText] = createSignal("");
	const agentName = (id: string) => state.identities[id]?.name ?? state.chats.find((chat) => chat.id === id)?.name ?? id;
	const barContext = () => {
		const focusedId = state.focused;
		return {
			...(focusedId ? { focused: { id: focusedId, name: agentName(focusedId) } } : {}),
			agents: state.chats.map((chat) => ({ id: chat.id, name: agentName(chat.id) })),
		};
	};
	const sendFromBar = (typed: string, commentIds: string[] = [], queue = false, draft?: Draft) => {
		const dest = destination(typed, barContext());
		/*
		 * The comments whose pills were in the field go in front of the words, whoever the words
		 * are for, and stop waiting. They are kept under the agent whose stage they were made
		 * on, which is the focused one: the only place a comment can be made is its stage.
		 */
		// In the order their pills sat in the text, which is the order `[comment n]` counts in.
		const held = state.focused && commentIds.length > 0 ? takeComments(state.focused, canvasOnScreen()?.name) : [];
		const notes = commentIds.flatMap((id) => held.filter((note) => note.id === id));
		const text = withComments(typed, notes);
		switch (dest.kind) {
			case "prompt": {
				const line = dest.named ? withComments(stripMention(typed, dest.name), notes) : text;
				/*
				 * The message as it was written, kept with it beside the text the agent gets (which this does not
				 * change): each pill by name, who put it in, and what its card shows, so the conversation draws it
				 * again after a reload and on another device. The `@name` that picked the agent is not part of it.
				 */
				const stage = canvasOnScreen()?.name;
				const written = draft && messageParts(dest.named ? withoutName(draft, dest.name) : draft, notes, { titleOf: names.titleOf, itemName: names.itemName, ...(stage ? { canvas: `canvases/${stage}` } : {}) });
				const parts = written?.some((part) => part.type === "mention") ? { parts: written } : {};
				/*
				 * With the words goes the tab that was in front (`tabs/about.ts`): the harness tells the agent
				 * what the person was looking at, in a line of its own before the words, and before a slash
				 * command it adds nothing. The words are sent as they were written.
				 */
				const looking = lookingAt();
				// With it, the language the page speaks (`@decks/i18n`), so the agent writes its cards and replies in it.
				const at = looking ? { at: { ...looking, lang: getLocale() } } : {};
				// Ctrl+Enter: held for the end of the turn, by the server (`DeckAgent.queueMine`), which sends it at once if there is none.
				if (queue) void call("chat.queue", [dest.id, { action: "add", text: line, ...parts, ...at }]).then(warnIfFailed);
				else void call("chat.send", [dest.id, { text: line, ...parts, ...at }]).then(warnIfFailed);
				return;
			}
			case "note":
				notice("info", m.app_notes_not_built());
				return;
			default:
				notice("info", m.app_pick_agent());
		}
	};
	return { barText, setBarText, agentName, barContext, sendFromBar };
}
