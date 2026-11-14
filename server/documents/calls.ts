import { calls, Refused, type Handled } from "../../protocol/index.ts";
import { handleAll, type Context, type Deck, type DeckPath, type Store } from "../kernel/types.ts";
import type { Documents } from "./doc.ts";
import { guarded, type GoogleAccount } from "./google.ts";
import { fence } from "./path.ts";
import { skipped } from "./records.ts";

// One short handler per call: a document's own file calls, then google.*.

const { file, google } = calls;
const DOC = { open: file.open, close: file.close, splice: file.splice, review: file.review, versions: file.versions, restore: file.restore };
const decoder = new TextDecoder("utf-8", { fatal: true });

/** A document's versions, newest first: its revisions, less typing a later keystroke covered. */
export async function versionsOf(deck: Deck, store: Store, path: DeckPath): Promise<{ sha: string; at: number }[]> {
	if (!deck.revisions) throw new Refused("unavailable", "This server keeps no history of files, so documents have no versions.", "file.read");
	const skip = await skipped(store, path);
	const all = await deck.revisions(path);
	if (all.length === 0) throw new Refused("not_found", `There is no document at ${path}.`, "file.list");
	return all.filter((r) => !skip.has(r.rev)).reverse().map((r) => ({ sha: String(r.rev), at: r.at }));
}

export function documentCalls(docs: () => Documents | undefined): Handled<Context>[] {
	const open = () => docs() ?? (() => { throw new Refused("unavailable", "Documents have not started yet.", "file.read"); })();
	return handleAll(DOC, {
		open: async (ctx, { path, client }) => {
			const at = fence(path);
			const state = await open().openDoc(at, client);
			ctx.client?.closed(() => void open().closeDoc(at, client).catch(() => undefined));
			return state;
		},
		close: async (_ctx, { path, client }) => open().closeDoc(fence(path), client),
		splice: async (ctx, { path, client, rev, batch, splices }) => open().splice(fence(path), { client, rev, batch, splices }, ctx.caller),
		review: async (ctx, { path, change, accept }) => open().review(fence(path), change, accept, ctx.caller),
		versions: async (ctx, { path }) => versionsOf(ctx.deck, ctx.store, fence(path)),
		restore: async (ctx, { path, sha }) => {
			const at = fence(path);
			const rev = Number(sha);
			if (!Number.isInteger(rev) || !ctx.deck.readAt) throw new Refused(ctx.deck.readAt ? "invalid" : "unavailable", `${sha} is not a version this server keeps: file.versions lists them.`, "file.versions");
			const text = decoder.decode(await ctx.deck.readAt(at, rev));
			return open().restore(at, text, ctx.caller);
		},
	});
}

export function googleCalls(account: GoogleAccount | undefined): Handled<Context>[] {
	return handleAll(google, {
		status: async () => guarded(account, () => account!.status()),
		connect: async (_ctx, { url }) => guarded(account, () => account!.connect(url)),
		disconnect: async () => guarded(account, () => account!.disconnect()),
	});
}
