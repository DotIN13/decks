/**
 * One `message` listener for every board frame on the page, handing each message to its own frame's handlers.
 *
 * Each board used to listen on the window itself, and each of its helpers too (its token, the
 * document relay), every one checking whether a message came from its frame. A page on a board posts
 * up every wheel step and touch over it, so with 80 board pages a pan woke 240 listeners 120 times a
 * second to find one: about an eighth of a pan's main thread. Here the sender is looked up once,
 * kept per window it came from, and only its frame's handlers run.
 */
type Handler = (event: MessageEvent) => void;

const handlers = new Map<HTMLIFrameElement, Set<Handler>>();
/** The frame a sending window belongs to, once found. A frame's window stays the same through its loads. */
let known = new WeakMap<object, HTMLIFrameElement>();
/** Windows that are no frame of ours (the page itself, a popup): forgotten whenever a frame is added. */
let strangers = new WeakSet<object>();
let listening: Window | undefined;

const route = (event: MessageEvent) => {
	const source = event.source;
	if (!source || strangers.has(source)) return;
	let frame = known.get(source);
	if (!frame || frame.contentWindow !== source || !handlers.has(frame)) {
		frame = undefined;
		for (const one of handlers.keys()) {
			if (one.contentWindow === source) {
				frame = one;
				known.set(source, one);
				break;
			}
		}
	}
	if (!frame) {
		strangers.add(source);
		return;
	}
	for (const handler of [...(handlers.get(frame) ?? [])]) handler(event);
};

/** Hear the messages `frame`'s page posts to this window; returns the undo. */
export function onFrameMessage(frame: HTMLIFrameElement, handler: Handler): () => void {
	if (typeof window === "undefined") return () => {};
	if (listening !== window) {
		window.addEventListener("message", route);
		listening = window;
	}
	let set = handlers.get(frame);
	if (!set) handlers.set(frame, (set = new Set()));
	set.add(handler);
	// A frame added may be the one a window was not yet known to be.
	strangers = new WeakSet();
	return () => {
		const now = handlers.get(frame);
		if (!now) return;
		now.delete(handler);
		if (now.size === 0) {
			handlers.delete(frame);
			known = new WeakMap();
		}
	};
}
