/** Files dropped in from outside: the size limit, and where one landed. */
/**
 * The most bytes one dropped file may be, known to both sides.
 *
 * The browser needs it to refuse a file before spending minutes sending it; the server
 * needs it because a limit only the client enforces is not a limit. 2GB takes a long
 * video; the server streams an upload to disk, so a big one costs disk and not memory.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Past this the browser asks before sending: a file this size takes a while and a lot of the deck's disk. */
export const CONFIRM_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Where a dropped file landed, as `POST /api/upload` answers.
 *
 * `path` is deck-relative — the same currency `stage.newBoard` and the file
 * picker deal in — so the caller turns it into a board-relative `data-embed`
 * itself rather than the server guessing which board asked.
 */
export interface UploadedAsset {
	path: string;
	name: string;
	bytes: number;
	/** True when an identical file was already there and this one was not written. */
	reused: boolean;
	/**
	 * For a film or a sound, what the server read out of it with ffmpeg (`files/media.ts`): the
	 * still it wrote, the running time, and the picture's own size. Absent for everything else,
	 * and for a deployment with no ffmpeg — what is placed then has no poster, not no item.
	 */
	media?: {
		kind: "video" | "audio";
		/** The poster's own deck path, beside the file. */
		poster?: string;
		/** A sound's loudness along its length, 0 to 1 per bar, for its waveform. */
		peaks?: number[];
		seconds?: number;
		w?: number;
		h?: number;
	};
}
