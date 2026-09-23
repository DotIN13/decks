import type { ChatItem, WebStatus } from "@decks/protocol";
import type { TurnCard } from "../chat/turn-cards.ts";

/**
 * The channel between a live board and the transcript this app is already holding.
 *
 * A mirror board is a document with one component in it and no content of its own: it
 * asks the app which conversation it is of, and the app posts the turns in. Nothing is
 * written to disk and nothing new is asked of the server — `App.tsx` already stores
 * `chat.history` and `chat.item` under the agent id, for *every* agent, because the
 * registry greets the browser with all of them. Mirroring a conversation you are not
 * reading therefore costs a `postMessage`.
 *
 * Same origin (DESIGN §4) is what makes this small: the frame is served by this app, so
 * the two documents can talk directly and the board can be a plain script.
 */

/** What the board asks for, once it has mounted. Repeated until answered. */
export interface LiveWant {
	decks: "live.want";
	/** A conversation (`live-chat.js`), or the shared Chrome's status card (`live-web.js`). */
	kind: "chat" | "web";
	agent?: string;
}

/** What the app posts to a `data-live="web"` board: the shared browser's state, whole. */
export interface LiveWebFeed {
	decks: "live.web";
	status: WebStatus;
	/** The pairing code, so an unpaired card can say what to paste into the extension. */
	code?: string;
}

/** What a web card posts back: the user's answer to a submit, or the Stop button. */
export type LiveWebReply = { decks: "live.web.answer"; id: string; ok: boolean } | { decks: "live.web.stop" };

/**
 * What the app posts back.
 *
 * One shape for every update, and the index is the whole of it: **keep the first `from`
 * cards you already hold, then append these**. `from: 0` is a reset, `from: length` is an
 * append, and `from: length - 1` is the streaming case where the last turn grew. A rewind
 * — which changes everything after the branch point — falls out as a small `from` without
 * needing a case of its own.
 *
 * **`turns` are cards, not chat items** (`chat/turn-cards.ts`): a reply and the calls it made
 * are one card, not four rows. The board used to be sent the items and folded them itself,
 * which made a board a second implementation of the transcript's shape — and a second
 * implementation that had already drifted from this one. The wire carries the fold so there
 * is one of it.
 */
export interface LiveFeed {
	decks: "live.chat";
	agent: string;
	from: number;
	turns: TurnCard[];
	/** So the board can draw a header without a second round trip. */
	identity?: { name: string; color: string };
	/** How many turns there are in total, for the board's own bookkeeping. */
	total: number;
	/**
	 * What the agent is doing, in the column's own words — or nothing when it is doing nothing.
	 *
	 * Sent rather than derived, and that is the point: the board used to read it off the items
	 * and said "working…" where the column says "typing…", which is the column's three words
	 * collapsed into two. `chat/working-sign.ts` decides the phrasing for the dock, the column
	 * and this together.
	 */
	working?: string;
}

/**
 * What can change about a card without its id changing.
 *
 * Compared by value rather than by reference because the cards are built from a store that
 * hands out proxies: two reads of an unchanged item are usually the same object and that is
 * not something to depend on. Lengths rather than contents, because the only edit a chat item
 * receives is an append — an assistant turn grows token by token, a tool call finishes — and
 * hashing a megabyte of transcript on every frame to learn that would be the wrong trade.
 *
 * A card's stamp is its parts' stamps joined, which is what makes "a reply inside turn four
 * grew" come out as `from: 3` and nothing else resent.
 */
function stampItem(item: ChatItem): string {
	switch (item.kind) {
		case "assistant":
			return `a:${item.id}:${item.text.length}:${item.thinking?.length ?? 0}:${item.streaming ? 1 : 0}`;
		case "tool":
			return `t:${item.id}:${item.state}:${item.title.length}:${item.result?.length ?? 0}:${item.images ?? 0}`;
		case "notice":
			return `n:${item.id}:${item.level}:${item.text.length}`;
		default:
			return `u:${item.id}:${item.text.length}`;
	}
}

function stamp(card: TurnCard): string {
	if (card.kind === "mine") return `m:${card.id}:${card.text.length}`;
	if (card.kind === "notice") return `n:${card.id}:${card.level}:${card.text.length}`;
	const parts = card.parts.map((part) =>
		part.kind === "text"
			? `s:${part.id}:${part.text.length}:${part.thinking?.length ?? 0}:${part.streaming ? 1 : 0}`
			: `T:${part.id}:${part.slots
					.map((slot) => (slot.kind === "call" ? stampItem(slot.call) : slot.calls.map(stampItem).join(",")))
					.join("|")}`,
	);
	return `A:${card.id}:${parts.join(";")}`;
}

/**
 * What to send a board that already holds `sent`, so that it holds `next`.
 *
 * `undefined` when the two are the same, which is the common answer: this is asked on
 * every store update, and most of them are about a conversation this board is not of.
 */
export function liveDelta(sent: readonly TurnCard[], next: readonly TurnCard[]): { from: number; turns: TurnCard[] } | undefined {
	let common = 0;
	const limit = Math.min(sent.length, next.length);
	while (common < limit && stamp(sent[common] as TurnCard) === stamp(next[common] as TurnCard)) common++;
	// Everything matched and there is no more of it: nothing to say.
	if (common === sent.length && common === next.length) return undefined;
	return { from: common, turns: next.slice(common) };
}

/**
 * Listen for a board asking to be fed, and say which conversation it wants.
 *
 * The board repeats the request until it is answered rather than waiting for a handshake,
 * so this can be attached whenever the frame loads without a race to lose: a request that
 * arrives before anyone is listening is simply asked again.
 */
export function attachLiveWant(
	frame: HTMLIFrameElement,
	onWant: (agent: string) => void,
	web?: { onWant: () => void; onReply: (reply: LiveWebReply) => void },
): () => void {
	const view = frame.ownerDocument.defaultView;
	if (!view) return () => {};
	const listener = (event: MessageEvent) => {
		if (event.source !== frame.contentWindow) return;
		const message = event.data as Partial<LiveWant> | Partial<LiveWebReply> | null;
		if (!message || typeof message.decks !== "string") return;
		if (message.decks === "live.want") {
			const want = message as Partial<LiveWant>;
			if (want.kind === "web") web?.onWant();
			else if (want.kind === "chat" && typeof want.agent === "string" && want.agent) onWant(want.agent);
			return;
		}
		if (message.decks === "live.web.answer") {
			const reply = message as Partial<Extract<LiveWebReply, { decks: "live.web.answer" }>>;
			if (typeof reply.id === "string" && typeof reply.ok === "boolean") web?.onReply({ decks: "live.web.answer", id: reply.id, ok: reply.ok });
			return;
		}
		if (message.decks === "live.web.stop") web?.onReply({ decks: "live.web.stop" });
	};
	view.addEventListener("message", listener);
	return () => view.removeEventListener("message", listener);
}

/** Post the shared browser's state into a web card. */
export function pushLiveWeb(frame: HTMLIFrameElement, feed: LiveWebFeed): void {
	frame.contentWindow?.postMessage(feed, frame.ownerDocument.location.origin);
}

/** Post a feed into a board. Same origin, so the target is this app's own origin. */
export function pushLive(frame: HTMLIFrameElement, feed: LiveFeed): void {
	frame.contentWindow?.postMessage(feed, frame.ownerDocument.location.origin);
}
