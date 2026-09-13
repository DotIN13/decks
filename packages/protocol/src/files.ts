/** Files dropped in from outside: the size limit, and where one landed. */
/**
 * The most bytes one dropped file may be, known to both sides.
 *
 * The browser needs it to refuse a 400MB video before spending a minute sending
 * it; the server needs it because a limit only the client enforces is not a
 * limit. 32MB is a photograph or a long PDF and not a video, which is the kind
 * of thing a board is for.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

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
}
