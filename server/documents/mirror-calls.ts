import { Refused } from "../../protocol/index.ts";
import type { Context } from "../kernel/types.ts";
import { guarded } from "./google.ts";
import { credit, linkOf, syncOnce, type GoogleDocs } from "./links.ts";
import { fence } from "./path.ts";

// The calls a Google Doc's page makes by its mirror's path: the Doc for drawing, styles, comments.
// Rule 15: a style is applied in Google at once, and what it changed in the words is pulled into
// the mirror credited to whoever pressed it.

function needs<K extends keyof GoogleDocs>(docs: GoogleDocs | undefined, part: K): NonNullable<GoogleDocs[K]> {
	const found = docs?.[part];
	if (!found) throw new Refused("unavailable", "This server's Docs API cannot do that.", "google.status");
	return (found as (...args: never[]) => unknown).bind(docs) as NonNullable<GoogleDocs[K]>;
}

export function googleOnMirror(docs: GoogleDocs | undefined) {
	return {
		get: async (ctx: Context, { path }: { path: string }) =>
			guarded(docs, async () => {
				const { id, mirror } = await linkOf(ctx.store, fence(path));
				const document = await needs(docs, "document")(id);
				return { path: mirror, document, text: (await docs!.read(id)).text };
			}),
		style: async (ctx: Context, { path, requests }: { path: string; requests: unknown[]; text?: string }) =>
			guarded(docs, async () => {
				const link = await linkOf(ctx.store, fence(path));
				await needs(docs, "style")(link.id, requests);
				await credit(ctx.store, link.id, ctx.caller);
				await syncOnce(link, docs!, ctx.deck, ctx.store, ctx.caller);
				const rev = (await ctx.deck.revisions?.(link.mirror))?.at(-1)?.rev ?? 0;
				return { path: link.mirror, rev };
			}),
		comments: async (ctx: Context, { path }: { path: string }) =>
			guarded(docs, async () => needs(docs, "comments")((await linkOf(ctx.store, fence(path))).id)),
		comment: async (ctx: Context, args: { path: string; action: "create" | "reply" | "resolve"; comment?: string; content?: string; quote?: string }) =>
			guarded(docs, async () => {
				const { id } = await linkOf(ctx.store, fence(args.path));
				await needs(docs, "comment")(id, args.action, args);
				return needs(docs, "comments")(id);
			}),
	};
}

