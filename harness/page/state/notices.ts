import { type Notice, setState } from "./deck.ts";

/*
 * The notice strip: the things the app has to say, briefly. This module is the only writer of
 * `state.notices`. Ids are a counter so two notices in the same millisecond never collide.
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
 * A notice with a button: something the person may take or leave, such as an agent asking to
 * take them to another canvas (`app/view-requests.ts`). A newer offer with the same `key`
 * replaces the older one, pressing the button takes the notice away, and an offer not taken goes
 * after twelve seconds.
 */
export const offer = (text: string, action: { label: string; run: () => void }, key: string) => {
	const id = ++noticeId;
	const drop = () => setState("notices", (all) => all.filter((item) => item.id !== id));
	const run = () => {
		drop();
		action.run();
	};
	setState("notices", (all) => [...all.filter((item) => item.key !== key), { id, level: "info" as const, text, key, action: { label: action.label, run } }]);
	setTimeout(drop, 12000);
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
