/**
 * An image file's own size, read in the browser before it is uploaded: for a picture dropped or
 * pasted on the canvas, which lands near its own aspect. Shared by the Decks app and Studio.
 */

/**
 * An image's own pixel size, or nothing if the browser cannot decode it.
 *
 * Two attempts, because they fail on different files. `createImageBitmap` decodes
 * the *bytes*, so it works on a file the platform handed over with no MIME type at
 * all — which happens, and which made every such drop land in a default box. It
 * refuses SVG, which has no bitmap to decode, so the `<img>` path is still needed:
 * an SVG with a `width`/`height` or a `viewBox` reports a natural size there.
 */
export async function naturalSize(file: File): Promise<{ width: number; height: number } | undefined> {
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file);
			const size = { width: bitmap.width, height: bitmap.height };
			bitmap.close?.();
			if (size.width > 0 && size.height > 0) return size;
		} catch {
			/* not a raster image this browser can decode; try the element */
		}
	}
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const image = new Image();
		const done = (result?: { width: number; height: number }) => {
			URL.revokeObjectURL(url);
			resolve(result);
		};
		image.onload = () =>
			done(
				image.naturalWidth > 0 && image.naturalHeight > 0
					? { width: image.naturalWidth, height: image.naturalHeight }
					: undefined,
			);
		// An SVG with no intrinsic size, a corrupt PNG, a format this browser does not
		// know: the box falls back to a default rather than the drop failing.
		image.onerror = () => done(undefined);
		image.src = url;
	});
}
