import type { BoardPatch } from "@decks/protocol";
import { createStore } from "solid-js/store";
import { coalesce, needsReload } from "../canvas/patches.ts";
import { state } from "./deck.ts";
import { send } from "./socket.ts";

/**
 * The edits this browser has made, and whether a frame may reload over them.
 *
 * Every user edit — a drag, a retype, an inspector button, a dropped file — goes down the
 * socket as a patch *against a named revision*, and the server refuses one composed against
 * a revision that is no longer current. That is the right refusal for "the agent wrote this
 * file underneath you" and absurd for "you clicked three inspector buttons", so the edits
 * that arrive while one is in flight wait here and go as one batch against the revision the
 * acknowledgement brings back.
 *
 * ### Why the frame does not reload, and what the pin is
 *
 * The browser mutates the frame's DOM optimistically, so its own edit is *already on
 * screen*. Reloading to show it would throw away the thing being edited and flash. So a
 * frame is **pinned** to the revision it loaded, and unpinned only when somebody else's
 * write arrives.
 *
 * The pin is keyed by **revision**, not by a "we just wrote it" flag, and that is not
 * decoration: one patch produces two `board.changed` messages — the immediate one from the
 * write and the watcher's — both carrying the same rev. A flag is consumed by the first, and
 * the second then looks exactly like somebody else's write: it unpinned the frame and
 * reloaded the document out from under the user, which is the flash on every component drag.
 * A revision is a content hash, so matching on it absorbs however many echoes arrive and
 * still reloads for a revision we did not produce.
 *
 * ### Why this is a module
 *
 * It was four values in `App.tsx` and four more branches in the frame switch, so the rule
 * above was argued in one file and implemented in two. Five fields of `FrameHooks` existed
 * only to carry it back and forth — which is the shape of a value that belongs here: the
 * *editor* writes it, the *switch* maintains it, and `Stage` reads it.
 */

/** Revisions this browser caused, by path. */
const selfRevs = new Map<string, number>();
/** Paths with a patch in flight, before the accepted rev is known. */
const patching = new Set<string>();
/** Edits made while a patch was in flight, per path — coalesced, and sent as one batch. */
const queued = new Map<string, BoardPatch[]>();
/**
 * The revision each frame is pinned to, or 0 for "show the newest".
 *
 * A store rather than a signal because `Stage` reads one key per board, and a signal would
 * re-render every frame whenever any board's pin moved.
 */
const [frameRevs, setFrameRevs] = createStore<Record<string, number>>({});

export { frameRevs };

/** Send a batch down the socket, against a named revision. */
export function sendPatches(path: string, rev: number, patches: BoardPatch[]): void {
	patching.add(path);
	/*
	 * Pin to what the frame is showing *now*, before the write lands — and only if it is not
	 * already pinned. Re-pinning on each edit moves the pin to the newest rev while the
	 * document on screen is still the one it first loaded, so the URL changes and the frame
	 * reloads: the flash came back on the second drag.
	 *
	 * An insert is the exception, and a duplicate with it: both have to actively *unpin*. The
	 * pin's premise is that the frame's DOM is already correct because the editor mutated it —
	 * true of a drag, false of a component that exists only in the file, because the server
	 * mints the id and writes the markup (§6.5). Pinned, a dropped file landed in `assets/`,
	 * landed in the board's source, and appeared nowhere on screen until something else
	 * reloaded the frame. One reload beats a component the user cannot see.
	 */
	if (needsReload(patches)) setFrameRevs(path, 0);
	else if (!frameRevs[path]) {
		const board = state.boards.find((candidate) => candidate.path === path);
		if (board) setFrameRevs(path, board.rev);
	}
	send({ type: "board.patch", path, rev, patches });
}

/**
 * The editor's entry: one patch at a time per board, the rest queued behind it.
 *
 * Coalesced, because a burst of edits to one component — dragging a handle, or typing —
 * is one edit as far as the file is concerned.
 */
export function patchBoard(path: string, patches: BoardPatch[]): void {
	const board = state.boards.find((candidate) => candidate.path === path);
	if (!board) return;
	if (patching.has(path)) {
		queued.set(path, coalesce([...(queued.get(path) ?? []), ...patches]));
		return;
	}
	sendPatches(path, board.rev, patches);
}

/**
 * The server accepted a patch. What was waiting behind it goes now.
 *
 * Against the revision *this message carries*, which is the only place the new revision is
 * known this early: `board.rev` in the store is not updated until `board.changed` lands, one
 * message later, so composing against it here would send a stale patch to fix a stale patch.
 */
export function patchAccepted(path: string, rev: number): void {
	patching.delete(path);
	selfRevs.set(path, rev);
	const waiting = queued.get(path);
	if (waiting && waiting.length > 0) {
		queued.delete(path);
		sendPatches(path, rev, waiting);
	}
}

/** The server refused one: drop the pin and the queue composed against the same lie. */
export function patchRefused(path: string): void {
	queued.delete(path);
	selfRevs.delete(path);
	setFrameRevs(path, 0);
}

/**
 * A board changed, and whose write it was.
 *
 * `"theirs"` is the caller's cue to reload the frame; `"ours"` and `"adopted"` are not.
 * Adopted is the echo that overtook the acknowledgement of our own patch: the write landed,
 * the watcher told us before the answer did, and it is still us.
 */
export function boardChanged(path: string, rev: number): "ours" | "adopted" | "theirs" {
	if (selfRevs.get(path) === rev) return "ours";
	if (patching.has(path)) {
		selfRevs.set(path, rev);
		return "adopted";
	}
	selfRevs.delete(path);
	setFrameRevs(path, 0);
	return "theirs";
}

/**
 * The greeting is a refresh: nothing is in flight any more.
 *
 * Said out loud because the queue depends on it — an edit made while a patch is
 * unacknowledged waits for that acknowledgement, and one lost to a dropped socket would
 * otherwise leave every later edit to that board waiting for a message that is never coming.
 *
 * **`selfRevs` is deliberately left alone**, which is what the code did before this moved:
 * a revision we caused is still a revision we caused, and the frame is still holding the
 * document it loaded. Whether a claim should survive a reconnect is a real question — the
 * write may have been lost with the socket — but it is a behaviour question, and this module
 * is the extraction of the behaviour that was there.
 */
export function forgetInFlight(): void {
	patching.clear();
	queued.clear();
}

/** A board is gone: nothing is in flight against it and nothing is pinned to it. */
export function forgetPatches(path: string): void {
	selfRevs.delete(path);
	patching.delete(path);
	queued.delete(path);
	setFrameRevs(path, 0);
}
