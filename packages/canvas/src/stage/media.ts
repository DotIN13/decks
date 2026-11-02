/**
 * The one film or sound playing on the stage: which item, the element playing it, and where each was
 * left, so pressing it again goes on from there (`items/MediaPlayer.tsx` draws it).
 */
import { createSignal } from "solid-js";

export type Playing = { id: string; kind: "video" | "audio"; file: string };

export function createMediaPlayback() {
	const [playing, setPlaying] = createSignal<Playing | undefined>();
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
		toggleMedia,
		/** The element playing now, as the player mounts and leaves it. */
		setElement: (element: HTMLMediaElement | undefined) => {
			playingElement = element;
		},
	};
}
