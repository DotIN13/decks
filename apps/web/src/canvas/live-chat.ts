import type { ChatItem } from "@decks/protocol";

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
	kind: "chat";
	agent: string;
}

/**
 * What the app posts back.
 *
 * One shape for every update, and the index is the whole of it: **keep the first `from`
 * items you already hold, then append these**. `from: 0` is a reset, `from: length` is an
 * append, and `from: length - 1` is the streaming case where the last turn grew. A rewind
 * — which changes everything after the branch point — falls out as a small `from` without
 * needing a case of its own.
 */
export interface LiveFeed {
	decks: "live.chat";
	agent: string;
	from: number;
	items: ChatItem[];
	/** So the board can draw a header without a second round trip. */
	identity?: { name: string; color: string };
	/** How many turns there are in total, for the board's own bookkeeping. */
	total: number;
}

/**
 * What can change about an item without its id changing.
 *
 * Compared by value rather than by reference because the store the items come from is a
 * proxy: two reads of an unchanged item are usually the same object and that is not
 * something to depend on. Lengths rather than contents, because the only edit a chat item
 * receives is an append — an assistant turn grows token by token, a tool call finishes —
 * and hashing a megabyte of transcript on every frame to learn that would be the wrong
 * trade.
 */
function stamp(item: ChatItem): string {
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

/**
 * What to send a board that already holds `sent`, so that it holds `next`.
 *
 * `undefined` when the two are the same, which is the common answer: this is asked on
 * every store update, and most of them are about a conversation this board is not of.
 */
export function liveDelta(sent: readonly ChatItem[], next: readonly ChatItem[]): { from: number; items: ChatItem[] } | undefined {
	let common = 0;
	const limit = Math.min(sent.length, next.length);
	while (common < limit && stamp(sent[common] as ChatItem) === stamp(next[common] as ChatItem)) common++;
	// Everything matched and there is no more of it: nothing to say.
	if (common === sent.length && common === next.length) return undefined;
	return { from: common, items: next.slice(common) };
}

/** Apply what `liveDelta` produced. The board's half of the same rule, kept here so it is tested. */
export function applyDelta(held: readonly ChatItem[], delta: { from: number; items: ChatItem[] }): ChatItem[] {
	return [...held.slice(0, delta.from), ...delta.items];
}

/**
 * Listen for a board asking to be fed, and say which conversation it wants.
 *
 * The board repeats the request until it is answered rather than waiting for a handshake,
 * so this can be attached whenever the frame loads without a race to lose: a request that
 * arrives before anyone is listening is simply asked again.
 */
export function attachLiveWant(frame: HTMLIFrameElement, onWant: (agent: string) => void): () => void {
	const view = frame.ownerDocument.defaultView;
	if (!view) return () => {};
	const listener = (event: MessageEvent) => {
		if (event.source !== frame.contentWindow) return;
		const message = event.data as Partial<LiveWant> | null;
		if (!message || message.decks !== "live.want" || message.kind !== "chat") return;
		if (typeof message.agent !== "string" || !message.agent) return;
		onWant(message.agent);
	};
	view.addEventListener("message", listener);
	return () => view.removeEventListener("message", listener);
}

/** Post a feed into a board. Same origin, so the target is this app's own origin. */
export function pushLive(frame: HTMLIFrameElement, feed: LiveFeed): void {
	frame.contentWindow?.postMessage(feed, frame.ownerDocument.location.origin);
}
