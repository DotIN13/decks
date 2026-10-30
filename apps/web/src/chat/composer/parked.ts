import { draftIsEmpty, normalize, parseDraft, type Draft } from "./draft.ts";

/**
 * What was being typed on each page, so that leaving a page never loses a message.
 *
 * **Keyed by the page.** Each agent's stage on one canvas is one page, and that is what a person
 * means by "where I was typing": an agent moved to another canvas finds an empty bar there, and its
 * words again when it comes back. The device is the store's own: this browser's localStorage.
 *
 * Kept in localStorage as well as in memory, so a reload, a crash or a closed tab keeps the
 * half-written message too. Every change is written, because the moment a draft is lost is
 * never one that gives notice. Pure apart from the store it is handed, so it is tested
 * without a browser.
 */

export const DRAFTS_KEY = "decks.drafts";
/** Pages remembered at once. An agent that was closed leaves its draft behind; this is what clears it out. */
export const DRAFTS_LIMIT = 40;

/** The page a bar is on: one agent's stage, on the canvas it is on (when it is known yet). */
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

export interface ParkedDrafts {
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

/**
 * A restored draft, made to agree with the comments that are still waiting.
 *
 * A pill whose comment has gone (sent from another tab, or removed) is dropped, and a comment
 * with no pill is given one at the end, so what the bar shows is exactly what will be sent.
 */
export function reconcilePills<M extends { type: "mention"; id: string }>(draft: Draft, waiting: string[], pillFor: (id: string) => M & Draft[number]): Draft {
	const known = new Set(waiting);
	const kept = draft.filter((node) => node.type === "text" || known.has(node.id));
	const shown = new Set(kept.flatMap((node) => (node.type === "mention" ? [node.id] : [])));
	const missing = waiting.filter((id) => !shown.has(id));
	const spaced: Draft = missing.length > 0 && kept.length > 0 ? [...kept, { type: "text", text: " " }] : kept;
	return normalize([...spaced, ...missing.map(pillFor)]);
}
