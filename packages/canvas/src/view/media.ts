import { createSignal } from "solid-js";

/** What `createMedia` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface MediaNeeds {

}

export function createMedia(d: MediaNeeds) {
	/**
	 * The one film or sound playing, if any.
	 *
	 * **One at a time, on purpose.** A film at rest is paint and costs a picture; a film playing is
	 * a decoder, and eight of those are already the edge of a frame's budget on a machine with no
	 * graphics card — forty-eight cost a thousand times what forty-eight stills cost. So starting
	 * one stops the last, and the canvas never holds more than a single player.
	 */
	const [playing, setPlaying] = createSignal<{ id: string; kind: "video" | "audio"; file: string } | undefined>();

	/** The playing element, for a click on the item to pause and resume. */
	let playingElement: HTMLMediaElement | undefined;

	/** When the one playing was started, so the second press of a double-click does not pause it at once. */
	let playingSince = 0;

	/** Where each film or sound was left, so pressing it again goes on from there. */
	const playedTo = new Map<string, number>();

	/**
	 * A press on a film or a sound: it plays, or the one playing pauses or goes on. The press
	 * selects it as well, as a press on any item does, so it can still be moved and styled.
	 */
	const toggleMedia = (id: string, media: { kind: "video" | "audio"; file: string }) => {
		const now = playing();
		if (now?.id === id && playingElement) {
			if (playingElement.paused) void playingElement.play().catch(() => {});
			else if (performance.now() - playingSince > 400) playingElement.pause();
			return;
		}
		playingSince = performance.now();
		setPlaying({ id, kind: media.kind, file: media.file });
	};

	return {
		playing,
		setPlaying,
		playedTo,
		get playingElement() {
			return playingElement;
		},
		set playingElement(next) {
			playingElement = next;
		},
		toggleMedia,
	};
}
