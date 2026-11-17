import type { Peer } from "./port.ts";

/**
 * The words every frame shares with its page, whatever its kind: a kind adds its own beside them
 * (`@decks/canvas`, `frame/protocol.ts`, is the canvas's; `frame/card/protocol.ts` the card's).
 */

/** Page to frame. */
export interface SharedToFrame {
	/** A renewed pass, and the addresses its files are read at with it in them: what is read from then on carries the new one. */
	token: { token: string; files?: { base: string; expires: number }; pictures?: string };
	/** A press or Escape on the page: the frame's menus go. */
	away: Record<string, never>;
}

/** Frame to page. */
export interface SharedToPage {
	/** Open an address in a tab: the page's to open, an http(s) one alone, since the sandbox has no popups. */
	"open-link": { href: string };
	/** Follow a link to something in the deck, by its address in the page's window (`#canvas/…`, `#card/…`, `#doc/…`, `#app/…`): the page reads it and opens the tab, where it has tabs; with `browser`, the browser's own. */
	"open-at": { address: string; browser?: true };
	/** A shortcut nothing in the frame took, played on the page as if typed there. */
	keys: { key: string; code: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean };
	/** A press or Escape in the frame: the page's menus go. */
	away: Record<string, never>;
}

/** What a frame asks of its page and waits for. */
export type SharedCalls = {
	/** A call to Decks from something in the frame that only the page may make, with your login: the agents. The page asks you first where words are sent. */
	agent: { data: { verb: string; args: unknown[]; card: string }; value: unknown };
};

type NoCalls = Record<never, { data: unknown; value: unknown }>;

/**
 * The page's side of the shared words, the same for every frame: a link is opened in a tab that
 * cannot reach back, one to something in the deck is the page's to open as a tab of its own (`openAt`), a key is played on this page as if typed here, the page's menus go at a press in
 * the frame, and a call that is the page's to make is answered by `agent`, or refused when it has none.
 */
export function hearShared(page: Peer<SharedToFrame, NoCalls, SharedToPage, SharedCalls>, d: { dismiss(): void; agent?: ((call: SharedCalls["agent"]["data"]) => unknown) | undefined; /** A link to something in the deck, followed in the frame: a page with tabs opens it. Without it such a link goes nowhere. */ openAt?: ((link: SharedToPage["open-at"]) => void) | undefined; refuse(message: string): Error }): void {
	page.on("away", () => d.dismiss());
	page.on("open-at", (data) => d.openAt?.(data));
	page.on("open-link", (data) => {
		try {
			const url = new URL(data.href);
			if (url.protocol === "http:" || url.protocol === "https:") window.open(url.href, "_blank", "noopener");
		} catch {
			/* not an address */
		}
	});
	page.on("keys", (data) => dispatchEvent(new KeyboardEvent("keydown", { key: data.key, code: data.code, metaKey: data.meta, ctrlKey: data.ctrl, altKey: data.alt, shiftKey: data.shift, bubbles: true, cancelable: true })));
	page.answer("agent", (data) => {
		if (!d.agent) throw d.refuse("This page answers no card's agent calls.");
		return d.agent(data);
	});
}

/**
 * The frame's side of them: a press or Escape here puts the page's menus away, and one there puts
 * these away; a shortcut with ⌘, ⌃ or ⌥ that nothing here took goes to the page. Until `signal` ends.
 */
export function sayShared(end: Peer<SharedToPage, SharedCalls, SharedToFrame, NoCalls>, d: { dismiss(): void; signal: AbortSignal }): void {
	addEventListener("pointerdown", () => end.emit("away", {}), { capture: true, signal: d.signal });
	addEventListener("keydown", (event) => event.key === "Escape" && end.emit("away", {}), { capture: true, signal: d.signal });
	end.on("away", () => d.dismiss());
	addEventListener(
		"keydown",
		(event) => {
			if (!(event.metaKey || event.ctrlKey || event.altKey) || event.defaultPrevented) return;
			end.emit("keys", { key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
		},
		{ signal: d.signal },
	);
}
