/**
 * The first words between a frame and its page, the same for every kind of frame.
 *
 * The frame says `hello` to its parent once, by a window message, the only one it sends; the page
 * answers on that window alone with `start`, everything the frame begins with, and one end of a
 * `MessagePort` beside it (`port.ts`). After that no window message is read again but `reset`, by
 * which the page has the frame begin anew on something else in place (`guest.ts`).
 */
export const PROTOCOL = 1;

/** The frame's first word to its parent, the only window message it sends. */
export interface Hello {
	t: "hello";
	protocol: number;
}

/** The page's answer, with the port transferred beside it: what the frame starts from is its kind's to say. */
export interface StartMessage<Start> {
	t: "start";
	start: Start;
}
