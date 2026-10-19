/**
 * The canvas's folder as a whole address, which is what its image fills are read against.
 *
 * The server sends it as a path on the backend (`/api/f/…/canvases/plan/`), moved under this tab's
 * prefix by `rebase`, or as a whole address. A path is not a base `new URL` takes, so every reader
 * (the stage's engine, its worker's tiles, the editor's pictures) would have to remember to read it
 * against the page; it is done once here, where the drawing arrives. Nothing, or nothing usable, is "".
 */
export function wholeFolder(base: string, page: string): string {
	if (!base) return "";
	try {
		return new URL(base, page).href;
	} catch {
		return "";
	}
}
