import type { InkRequest } from "@decks/canvas";
import { api } from "../connections/connection.ts";
import { authHeaders } from "../lib/session.ts";
import { scheme } from "../lib/theme.ts";
import { commentBlock } from "../markup/comments.ts";
import { addComment, cleanFrameComment, cleanFrameInk, cleanFramePills } from "../state/comments.ts";
import { state } from "../state/deck.ts";
import { notice } from "../state/notices.ts";
import { stageOf } from "../state/canvases.ts";
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

/** How the page sends waiting comments now, as a message of their own (`createBar`'s send, set by `App`). */
let sendComments: ((ids: string[]) => void) | undefined;
export const setCommentSender = (send: (ids: string[]) => void) => {
	sendComments = send;
};

/**
 * A comment written in the page's own comment box (the frame says where, `onComment`; the page draws it):
 * kept over the input bar for your next message, or sent now. Sent from here, since the press on Send now
 * was the page's and so yours, where a send asked for by the frame could have been a card's script.
 */
export const pageComment = (target: { path: string; title?: string; quote: string; component?: string; items?: string[] }, text: string, send: boolean) => {
	const agentId = state.focused;
	if (!agentId) return;
	const canvas = stageOf(agentId)?.name;
	const comment = cleanFrameComment({ path: target.path, title: target.title ?? "", quote: target.quote, text, ...(target.component ? { component: target.component } : {}), ...(target.items?.length ? { items: target.items } : {}) });
	const note = { id: `c${Date.now().toString(36)}`, board: comment.path, quote: comment.quote, text: comment.text, at: Date.now(), from: "canvas" as const, ...(comment.component ? { component: comment.component } : {}), ...(comment.items?.length ? { items: comment.items } : {}) };
	addComment(agentId, canvas, note);
	if (send && sendComments) return sendComments([note.id]);
	setDraft({ text: "", at: Date.now(), insert: true, agentId, comment: note.id });
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
export const exportPicture = (ids: string[], format: "png" | "pdf" = "png") => {
	const agentId = state.focused;
	const canvas = stageOf(agentId)?.name;
	if (!agentId || !canvas) return;
	// Taken on the server by canvas.screenshot, as decks canvas screenshot takes it, which can take a moment; fetched with this tab's token (a plain link carries none, and was refused), then saved.
	notice("info", "Taking the picture…");
	// A card's picture is named after its folder; drawn items after the canvas, as the server names it.
	const card = ids.length === 1 ? /(?:^|\/)cards\/([^/]+)\//.exec(ids[0] ?? "")?.[1] : undefined;
	void (async () => {
		try {
			const response = await fetch(api(`/stage-shot?${new URLSearchParams({ canvas, agent: agentId, of: ids.join(","), format, scheme: scheme() })}`), { headers: authHeaders() });
			if (!response.ok) throw new Error((await response.text().catch(() => "")) || `the server answered ${response.status}`);
			const named = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1];
			const local = URL.createObjectURL(await response.blob());
			const link = document.createElement("a");
			link.href = local;
			link.download = card ? `${card}.${format}` : (named ?? `${canvas}.${format}`);
			link.click();
			setTimeout(() => URL.revokeObjectURL(local), 60_000);
		} catch (error) {
			notice("warn", `The picture could not be taken: ${(error as Error).message}`);
		}
	})();
};
