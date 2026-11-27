import { getLocale, m } from "@decks/i18n";
import type { PageContext } from "./context.ts";
import { clip, el, iconButton, initial, svg } from "./ui.ts";

/**
 * A Google Doc's comments, kept by Drive: the Comments button with its count, the panel listing
 * each comment with its replies, a reply box and Resolve, a box for a new comment on the selected
 * words, and the commented words in the Doc lit while their comment is hovered.
 */

/** A comment on a Google Doc, as Drive answers it. */
interface GComment {
	id: string;
	content: string;
	author?: { displayName?: string; me?: boolean };
	createdTime?: string;
	quotedFileContent?: { value?: string };
	replies?: Array<{ id: string; content?: string; author?: { displayName?: string }; createdTime?: string }>;
}

type Send = (action: "create" | "reply" | "resolve", fields: { comment?: string; content?: string; quote?: string }) => void;

export function mountComments(ctx: PageContext): () => void {
	const { sync, gview, options } = ctx;
	const { commentsButton, panel } = ctx.dom;
	/** A Google Doc's open comments, from Drive, or why they cannot be shown. */
	let comments: GComment[] = [];
	let commentsError = "";

	function drawCommentsButton(): void {
		commentsButton.hidden = !ctx.isGoogle();
		const n = comments.length;
		commentsButton.innerHTML = `${svg("comment")}<span>${m.docs_comments()}</span>${n ? `<span class="dp-count dp-count-soft">${n}</span>` : ""}`;
	}

	const sendComment: Send = (action, fields) => {
		options.send({ type: "doc.gcomment", path: sync.path, client: sync.client, action, ...fields });
	};

	/** A new comment on the selected words: the panel opens with a box for it at the top. */
	let drafting: string | undefined;
	function newComment(): void {
		const quote = gview.quote();
		if (!quote) return;
		drafting = quote;
		if (ctx.view !== "comments") ctx.hooks.show("comments");
		else drawComments();
	}

	function drawComments(): void {
		const parts: HTMLElement[] = [ctx.hooks.header(m.docs_comments())];
		if (commentsError) {
			parts.push(el("p", { class: "dp-empty" }, commentsError));
			if (ctx.hooks.remoteStatus()?.paste !== undefined || options.api) parts.push(...ctx.hooks.signInParts());
		}
		if (drafting !== undefined) {
			const box = el("div", { class: "dp-comment dp-comment-new" });
			box.append(el("div", { class: "dp-quote" }, clip(drafting, 120)));
			const input = el("textarea", { class: "dp-reply", rows: "3", placeholder: m.docs_comment() });
			const post = el("button", { type: "button", class: "dp-btn dp-sm dp-primary" }, m.docs_comment());
			const cancel = el("button", { type: "button", class: "dp-btn dp-sm" }, m.docs_cancel());
			post.onclick = () => {
				if (!input.value.trim()) return;
				sendComment("create", { content: input.value.trim(), quote: drafting });
				drafting = undefined;
				drawComments();
			};
			cancel.onclick = () => {
				drafting = undefined;
				drawComments();
			};
			const acts = el("div", { class: "dp-comment-acts" });
			acts.append(cancel, post);
			box.append(input, acts);
			parts.push(box);
			setTimeout(() => input.focus(), 0);
		}
		if (!commentsError && comments.length === 0 && drafting === undefined) parts.push(el("p", { class: "dp-empty" }, m.docs_no_comments()));
		for (const c of comments) parts.push(commentCard(ctx, c, sendComment));
		panel.replaceChildren(...parts);
	}

	// A click on commented words opens the comment.
	gview.page.addEventListener("click", (event) => {
		const id = (event.target as HTMLElement).closest<HTMLElement>("[data-comment]")?.dataset.comment;
		if (!id) return;
		if (ctx.view !== "comments") ctx.hooks.show("comments");
		panel.querySelector(`[data-comment="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});

	// A Doc drawn again has lost its comments' highlights; `google.ts` draws it first, so they go on after.
	ctx.on("doc.gdoc", () => gview.setComments(comments));
	ctx.on("doc.gcomments", (message) => {
		comments = message.comments as GComment[];
		commentsError = message.error ?? "";
		gview.setComments(comments);
		drawCommentsButton();
		if (ctx.view === "comments") drawComments();
	});
	ctx.hooks.drawComments = drawComments;
	ctx.hooks.drawCommentsButton = drawCommentsButton;
	ctx.hooks.newComment = newComment;
	return () => {};
}

/** One comment: who wrote it and when, the words it is on, its replies, Resolve, and a box to reply. */
function commentCard(ctx: PageContext, c: GComment, sendComment: Send): HTMLElement {
	const { gview } = ctx;
	const card = el("div", { class: "dp-comment", "data-comment": c.id });
	const who = (a: GComment["author"], at?: string) => {
		const row = el("div", { class: "dp-who" });
		row.append(el("span", { class: "dp-av" }, initial(a?.displayName ?? "?")), el("b", {}, a?.displayName ?? m.docs_someone()), at ? new Date(at).toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
		return row;
	};
	const head = who(c.author, c.createdTime);
	const resolve = iconButton("check", m.docs_resolve(), "dp-ib dp-sm dp-yes");
	resolve.onclick = (event) => {
		event.stopPropagation();
		sendComment("resolve", { comment: c.id, content: "" });
	};
	const acts = el("div", { class: "dp-acts" });
	acts.append(resolve);
	head.append(acts);
	card.append(head);
	if (c.quotedFileContent?.value) card.append(el("div", { class: "dp-quote" }, clip(c.quotedFileContent.value, 120)));
	card.append(el("div", { class: "dp-comment-body" }, c.content));
	for (const r of c.replies ?? []) {
		if (!r.content) continue;
		card.append(who(r.author, r.createdTime), el("div", { class: "dp-comment-body" }, r.content));
	}
	const form = el("form", { class: "dp-reply-row" });
	const input = el("input", { class: "dp-reply", placeholder: m.docs_reply() });
	form.append(input);
	form.onsubmit = (event) => {
		event.preventDefault();
		if (input.value.trim()) sendComment("reply", { comment: c.id, content: input.value.trim() });
		input.value = "";
	};
	card.append(form);
	card.onmouseenter = () => hotComment(ctx, c.id, true);
	card.onmouseleave = () => hotComment(ctx, c.id, false);
	card.onclick = (event) => {
		if ((event.target as HTMLElement).closest("input, button, textarea")) return;
		gview.page.querySelector(`[data-comment="${c.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
	};
	return card;
}

function hotComment(ctx: PageContext, id: string, on: boolean): void {
	for (const node of ctx.gview.page.querySelectorAll<HTMLElement>(`[data-comment="${id}"]`)) node.toggleAttribute("data-hot", on);
}
