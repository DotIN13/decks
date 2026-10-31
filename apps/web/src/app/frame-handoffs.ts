import type { InkRequest } from "@decks/canvas";
import { api } from "../connections/connection.ts";
import { scheme } from "../lib/theme.ts";
import { commentBlock } from "../markup/comments.ts";
import { addComment, cleanFrameComment, cleanFrameInk, cleanFramePills } from "../state/comments.ts";
import { state } from "../state/deck.ts";
import { notice } from "../state/notices.ts";
import { stageOf } from "../state/stages.ts";
import { setDraft } from "../state/ui.ts";
import { inkAsked } from "./ink-prompts.ts";

/*
 * What the canvas frame hands the composer (`@decks/canvas`, `frame/`): a comment, a sketch. Drafts,
 * shown in the composer and sent only when you press Send there: anything in the frame can hand
 * these over, a card's script too, so nothing from it goes to an agent on its word alone. Every text
 * in them is cleaned of what cannot be seen and cut at 2,000 characters (`cleanFrame*`), and a
 * comment's pill has a dashed edge, marked as from the canvas, and its card's Exact text is all of what
 * is sent.
 */
export const frameComment = (handed: { path: string; title: string; quote: string; text: string; send?: boolean; component?: string; items?: string[] }) => {
	const agentId = state.focused;
	if (!agentId) return;
	const canvas = stageOf(state.focused)?.name;
	const comment = cleanFrameComment(handed);
	const note = { id: `c${Date.now().toString(36)}`, board: comment.path, quote: comment.quote, text: comment.text, at: Date.now(), from: "canvas" as const, ...(comment.component ? { component: comment.component } : {}), ...(comment.items?.length ? { items: comment.items } : {}) };
	if (comment.send) setDraft({ text: commentBlock([note]), at: Date.now(), insert: true, agentId });
	else {
		addComment(agentId, canvas, note);
		setDraft({ text: "", at: Date.now(), insert: true, agentId, comment: note.id });
	}
};

export const frameInk = (request: InkRequest) => {
	const agentId = state.focused;
	const text = inkAsked(cleanFrameInk(request));
	if (agentId && text) setDraft({ text, at: Date.now(), insert: true, agentId });
};

/** Pills for items on the canvas, handed to the composer. */
export const frameRefer = (pills: Parameters<typeof cleanFramePills>[0]) =>
	setDraft({
		text: "",
		pills: cleanFramePills(pills),
		at: Date.now(),
		insert: true,
		...(state.focused ? { agentId: state.focused } : {}),
	});

/** A picture of these drawn items to download, taken by the server. */
export const exportPicture = (ids: string[]) => {
	const agentId = state.focused;
	if (!agentId) return;
	// A link the browser downloads: the picture is taken on the server, which can take a moment.
	notice("info", "Taking the picture…");
	const link = document.createElement("a");
	link.href = api(`/stage-shot?${new URLSearchParams({ agent: agentId, of: ids.join(","), format: "png", scheme: scheme() })}`);
	link.download = "";
	link.click();
};
