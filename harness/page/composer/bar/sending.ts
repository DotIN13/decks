import { createSignal } from "solid-js";
import { messageParts } from "../pill/sent.ts";
import type { Draft } from "../draft/model.ts";
import { withComments } from "../../markup/comments.ts";
import { takeComments } from "../../state/comments.ts";
import { state } from "../../state/deck.ts";
import { notice } from "../../state/notices.ts";
import { call, warnIfFailed } from "../../state/line.ts";
import { canvasOf } from "../../state/canvases.ts";
import { destination, stripMention, withoutName } from "./destination.ts";

// Sending a line from the bar: to whom it goes, with its comments in front and its pills kept as parts.

/** What the bar names its pills by, read when a line is sent. */
interface BarNames {
	titleOf: (path: string) => string | undefined;
	itemName: (id: string) => string | undefined;
}

/*
 * The bar's destination and its send, from one `destination`, so the word on the bar and the send
 * agree. `barText` is what the composer holds now, so an @ name changes the word as it is typed.
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
		 * are for, and stop waiting. They are kept under the agent whose canvas they were made
		 * on, which is the focused one: the only place a comment can be made is its canvas.
		 */
		// In the order their pills sat in the text, which is the order `[comment n]` counts in.
		const held = state.focused && commentIds.length > 0 ? takeComments(state.focused, canvasOf(state.focused)?.name) : [];
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
				const canvas = canvasOf(state.focused)?.name;
				const written = draft && messageParts(dest.named ? withoutName(draft, dest.name) : draft, notes, { titleOf: names.titleOf, itemName: names.itemName, ...(canvas ? { canvas: `canvases/${canvas}` } : {}) });
				const parts = written?.some((part) => part.type === "mention") ? { parts: written } : {};
				// Ctrl+Enter: held for the end of the turn by the agent's session (`harness/sessions/queue.ts`), which sends it at once if the agent is idle.
				if (queue) void call("chat.queue", { agent: dest.id, action: "add", text: line, ...parts }).then(warnIfFailed);
				else void call("chat.send", { agent: dest.id, text: line, ...parts }).then(warnIfFailed);
				return;
			}
			case "note":
				notice("info", "Notes on a component are not built yet.");
				return;
			default:
				notice("info", "Pick an agent first.");
		}
	};
	return { barText, setBarText, agentName, barContext, sendFromBar };
}
