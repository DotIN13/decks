import type { AgentChat, Page } from "../state/types/index.ts";

// The shell's rules, with no store and no DOM: which agents share the canvas
// on screen, and which cards are on it.

/** The agents on the same canvas as the one on screen; just that one when it has no canvas. */
export function agentsHere(chats: readonly AgentChat[], canvasOf: (id: string) => string | undefined, focused: string | undefined): AgentChat[] {
	const here = focused ? canvasOf(focused) : undefined;
	if (!here) return chats.filter((chat) => chat.id === focused);
	return chats.filter((chat) => canvasOf(chat.id) === here);
}

/** The cards in play on the conversation's canvas, as copies, so a row's frame is not the store's object. */
export function pagesInPlay(pages: readonly Page[], inPlay: readonly string[]): Page[] {
	const playing = new Set(inPlay);
	return pages.filter((page) => playing.has(page.path)).map((page) => JSON.parse(JSON.stringify(page)) as Page);
}

/** The drawing on screen as the editor and the panel read it, with who wrote it last. */
export function penOnScreen<D, E>(pen: { doc: D; base: string; canvas: string; by?: string; made?: string[]; edits?: E } | undefined, nameOf: (id: string) => { name: string; color: string } | undefined) {
	if (!pen) return undefined;
	const writer = pen.by ? nameOf(pen.by) : undefined;
	return { doc: pen.doc, base: pen.base, scope: pen.canvas, ...(pen.edits ? { edits: pen.edits } : {}), ...(pen.made ? { made: pen.made } : {}), ...(writer ? { writer } : {}) };
}
