import { type Notice, setState } from "./deck.ts";

/**
 * The notice strip: the things the app has to say, briefly.
 *
 * Layer 1. It imports `deck` for the store it writes into and nothing else, and it is the
 * only writer of `state.notices` — `App.tsx` reads that field to draw the strip and never
 * touches it otherwise, so the whole lifetime of a notice is the two functions here.
 *
 * `Notice` itself stays declared in `deck`, deliberately. The store holds `notices: Notice[]`,
 * so `deck` needs the type; if this module declared it, `deck` would import this one while
 * this one imports `deck` for `setState`, and the graph the split exists to establish would
 * have its first cycle in it. The type belongs to the store, the behaviour belongs here.
 *
 * ### Why the id is a counter rather than a timestamp
 *
 * The id is what the expiry closure matches on to remove the right line, and two notices
 * raised in the same millisecond would share a timestamp. A counter cannot collide. It is a
 * plain module `let` rather than store state because nothing draws it — the same call the
 * agent record makes for its scratch half.
 *
 * ### Why `working` exists beside `notice`
 *
 * `notice` is for something that has already happened, so it can expire on its own. An
 * upload has not: it takes as long as the file is big, and a message that expires after four
 * seconds while the bytes are still going is worse than no message. So `working` is held open
 * by its caller, rewritten as the work progresses, and replaced by an ordinary timed notice
 * when it ends.
 */

let noticeId = 0;

/** Say something, and take it away again once it has had time to be read. */
export const notice = (level: Notice["level"], text: string) => {
	const id = ++noticeId;
	setState("notices", (all) => [...all, { id, level, text }]);
	// Length-based, floored and capped: long enough to read, short enough that a
	// burst of warnings does not become a wall.
	const linger = Math.min(12000, Math.max(4000, (text.length / 20) * 1000));
	setTimeout(() => setState("notices", (all) => all.filter((item) => item.id !== id)), linger);
};

/**
 * A notice that lasts as long as the work it describes.
 *
 * The caller holds the handle: `update` rewrites the line in place as the work progresses,
 * and `done` takes it away — optionally leaving an ordinary timed notice in its place, which
 * is how "Adding four files…" becomes "Four files added".
 */
export const working = (text: string) => {
	const id = ++noticeId;
	setState("notices", (all) => [...all, { id, level: "info" as const, text }]);
	const drop = () => setState("notices", (all) => all.filter((item) => item.id !== id));
	return {
		update: (next: string) =>
			setState("notices", (all) => all.map((item) => (item.id === id ? { ...item, text: next } : item))),
		done: (final?: string, level: Notice["level"] = "info") => {
			drop();
			if (final) notice(level, final);
		},
	};
};
