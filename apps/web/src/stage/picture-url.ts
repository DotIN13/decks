/**
 * The whole address of an image fill's picture.
 *
 * `url` is as the drawing has it (`../../work/cover.png`), read against `base`, the canvas's folder,
 * which the server sends as a path (`/api/f/…/canvases/plan/`) or, from another origin, a whole
 * address; `page` is the page's own. A base must be whole, so a path is read against the page
 * first. Never throws: it runs at the end of every frame, and a throw there leaves the engine
 * mid-call, after which no frame finishes. An address that cannot be made is `undefined`.
 */
export function pictureUrl(url: string, base: string, page: string): string | undefined {
	try {
		return new URL(url, new URL(base || ".", page)).href;
	} catch {
		return undefined;
	}
}
