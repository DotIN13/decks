import { draftIsEmpty, normalize, parseDraft, type Draft } from "../draft/model.ts";

/** What was being typed on each page, so that leaving a page never loses a message. */

export const DRAFTS_KEY = "decks.drafts";
/** Pages remembered at once. An agent that was closed leaves its draft behind; this is what clears it out. */
export const DRAFTS_LIMIT = 40;

/** The page a bar is on: one agent's canvas, on the canvas it is on (when it is known yet). */
export function pageKey(agentId: string | undefined, canvas?: string): string {
	return `agent:${agentId ?? "none"}${canvas ? `@${canvas}` : ""}`;
}

/** The key a page was kept under before canvases were part of it: the agent alone. */
const formerKey = (page: string) => (page.includes("@") ? page.slice(0, page.indexOf("@")) : undefined);

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface Parked {
	draft: Draft;
	at: number;
}

interface ParkedDrafts {
	get(page: string): Draft | undefined;
	/** Remember a page's draft, or forget it when there is nothing in it. */
	set(page: string, draft: Draft, now?: number): void;
}

export function parkedDrafts(store: Store | undefined): ParkedDrafts {
	const pages = new Map<string, Parked>();
	/** What the store holds, read in. Newer entries win, so another tab's typing is not written over. */
	const read = () => {
		try {
			const raw: unknown = JSON.parse(store?.getItem(DRAFTS_KEY) ?? "{}");
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
			for (const [page, value] of Object.entries(raw as Record<string, { draft?: unknown; at?: unknown }>)) {
				const draft = parseDraft(JSON.stringify(value?.draft ?? null));
				const at = typeof value?.at === "number" ? value.at : 0;
				if (draft && !draftIsEmpty(draft) && at >= (pages.get(page)?.at ?? -1)) pages.set(page, { draft, at });
			}
		} catch {
			/* an unreadable store is an empty one */
		}
	};
	read();

	const persist = () => {
		try {
			if (pages.size === 0) store?.removeItem(DRAFTS_KEY);
			else store?.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(pages)));
		} catch {
			/* private mode or a full quota: the drafts still survive a switch of page, only not a reload */
		}
	};

	return {
		/*
		 * A draft kept under the agent alone, before canvases were part of the key, is taken once by the
		 * first of its canvases the bar arrives at, and dropped: the upgrade loses nobody's words, and they
		 * do not follow the agent onto every canvas.
		 */
		get(page) {
			const own = pages.get(page);
			const former = formerKey(page);
			if (own || !former) return own?.draft;
			read();
			const old = pages.get(former);
			if (!old) return undefined;
			pages.delete(former);
			pages.set(page, old);
			persist();
			return old.draft;
		},
		set(page, draft, now = Date.now()) {
			const next = normalize(draft);
			// The store is shared by every tab and written whole, so it is read before it is written.
			const mine = pages.get(page);
			read();
			if (mine) pages.set(page, mine);
			if (draftIsEmpty(next)) {
				if (!pages.delete(page)) return;
			} else {
				pages.set(page, { draft: next, at: now });
				// The oldest go first, and the page being typed on is by definition the newest.
				const extra = [...pages.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, Math.max(0, pages.size - DRAFTS_LIMIT));
				for (const [old] of extra) pages.delete(old);
			}
			persist();
		},
	};
}

/** A restored draft, made to agree with the comments that are still waiting. */
export function reconcilePills<M extends { type: "mention"; id: string }>(draft: Draft, waiting: string[], pillFor: (id: string) => M & Draft[number]): Draft {
	const known = new Set(waiting);
	const kept = draft.filter((node) => node.type === "text" || known.has(node.id));
	const shown = new Set(kept.flatMap((node) => (node.type === "mention" ? [node.id] : [])));
	const missing = waiting.filter((id) => !shown.has(id));
	const spaced: Draft = missing.length > 0 && kept.length > 0 ? [...kept, { type: "text", text: " " }] : kept;
	return normalize([...spaced, ...missing.map(pillFor)]);
}

/** A draft that is exactly `/` and a command fragment: the fragment, else null (not the same as ""). */
export function slashFragment(text: string): string | null {
	const match = /^\/([a-z0-9_:.-]*)$/i.exec(text);
	return match ? match[1]!.toLowerCase() : null;
}

/** The `@` word at the caret, when it starts a word: the name typed so far, else null. */
export function atQuery(text: string, caret: number): string | null {
	const match = /(^|\s)@([A-Za-z0-9_-]*)$/.exec(text.slice(0, caret));
	return match ? match[2]! : null;
}

/** The arrows wrap: one ArrowUp from the top of a list is its bottom row. */
export const wrapIndex = (at: number, step: number, length: number): number => (at + step + length) % length;

/** The words with the `@` fragment at the caret replaced by the whole name and a space. */
export function withMentionAt(whole: string, caret: number, query: string, name: string): string | undefined {
	const at = caret - query.length - 1;
	if (at < 0) return undefined;
	const after = whole.slice(caret);
	return `${whole.slice(0, at)}@${name}${after.startsWith(" ") ? "" : " "}${after}`;
}

/** How long a recording has run, as m:ss. */
export function clockText(since: number, now: number): string {
	const seconds = Math.max(0, Math.floor((now - since) / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Who the line goes to, for the placeholder and the queue's head. */
export const recipientName = (dest: { kind: string; name?: string } | undefined): string => (dest?.kind === "prompt" && dest.name ? dest.name : "the agent");

/** The field's placeholder: a turn in progress is steered, not interrupted. */
export const placeholder = (busy: boolean, name: string): string => (busy ? `Steer ${name}'s turn…` : `Ask ${name} to draw, plan or build…`);

/** The note on the queue's head: held, the next line when folded, or how it is sent. */
export function queueNote(queued: { items: Array<{ text: string }>; held: boolean }, folded: boolean): string {
	if (queued.held) return "held by Stop";
	return folded ? `next: ${queued.items[0]?.text ?? ""}` : "sent one per turn";
}

/** The comments whose pills are no longer in the draft. */
export function goneComments(inDraft: readonly string[], waiting: ReadonlyArray<{ id: string }>): string[] {
	const here = new Set(inDraft);
	return waiting.filter((comment) => !here.has(comment.id)).map((comment) => comment.id);
}
