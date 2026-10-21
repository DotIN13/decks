/**
 * Where files dropped or pasted onto a board go, and how big each is: shared by the Decks app and
 * Studio, which both lay a batch out the same way before it is uploaded (moved from the app's
 * `board/file-drop.ts`). Board pixels throughout, on the same 8px grid drags snap to.
 */

/** The grid a board's blocks snap to. */
export const GRID = 8;
export const snap = (value: number) => Math.round(value / GRID) * GRID;

/**
 * How big the component for a dropped file should be.
 *
 * An image lands near its own aspect ratio, because a photograph in a 420×320 box is a
 * photograph with grey bars around it; everything else gets a shape that suits how it
 * reads — a PDF page is tall, a web page is wide, a file we can only name is a chip.
 * Sizes are snapped to the same 8px grid the drags snap to, so a dropped file lines up
 * with everything a person placed by hand.
 */
export async function shapeFor(file: File): Promise<{ width: number; height: number }> {
	const shape = await shapeOf(file);
	return { width: snap(shape.width), height: snap(shape.height) };
}

/**
 * Where a batch of dropped files goes: a row from the drop point, wrapping at the edge.
 *
 * Eight files dropped together are eight components, and eight components at the same
 * coordinates look like one. A cascade — each one offset by a few pixels — was the first
 * answer and it is only better than nothing: five embeds 32px apart is a pile in which
 * four are unreadable. So they flow rightwards from the point the cursor was at, wrap
 * onto a new row when the board's own width runs out, and never overlap. `at` is already
 * in board coordinates (that is the whole point of listening inside the frame), and
 * `width` is the board's, from its `<meta name="board">`.
 */
export function flow(
	shapes: Array<{ width: number; height: number }>,
	at: { x: number; y: number },
	width: number,
): Array<{ left: number; top: number; width: number; height: number }> {
	const left = snap(at.x);
	let x = left;
	let y = snap(at.y);
	let rowHeight = 0;
	const boxes = [];
	for (const shape of shapes) {
		// Wrap, but never on the first of a row: a component wider than the board has to
		// go somewhere, and stacking it under itself would be worse than overhanging.
		if (x > left && x + shape.width > width - GRID) {
			x = left;
			y += rowHeight + GRID;
			rowHeight = 0;
		}
		boxes.push({ left: x, top: y, ...shape });
		x += shape.width + GRID;
		rowHeight = Math.max(rowHeight, shape.height);
	}
	return boxes;
}

/**
 * Whether a dropped file is a picture, by what the browser says and then by name.
 *
 * Both, because neither is reliable alone: a file dragged from some desktops arrives
 * with an empty `type`, and a name is only a claim. The answer decides the component's
 * shape here and its `kind` in the patch — `image-1` in the board's source says what a
 * component is without anyone opening the file.
 */
export function isImage(file: File): boolean {
	if (file.type.startsWith("image/")) return true;
	return IMAGE.has((file.name.split(".").pop() ?? "").toLowerCase());
}

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"]);
/** The embed's head, which the picture inside it does not get: 29px of chrome, near enough. */
export const HEAD_PX = 32;
/** What plays, as `lib/api.ts` and `lib/board.js` both count it. */
const VIDEO = new Set(["mp4", "m4v", "webm", "mov", "ogv", "mkv"]);
const AUDIO = new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "weba"]);

async function shapeOf(file: File): Promise<{ width: number; height: number }> {
	const extension = (file.name.split(".").pop() ?? "").toLowerCase();

	if (isImage(file)) {
		const natural = await naturalSize(file);
		if (!natural) return { width: 420, height: 320 };
		// Wide enough to see, never taller than a board is likely to be: the ratio is
		// kept and the *area* is what gets bounded.
		const width = Math.min(560, Math.max(160, natural.width));
		const height = Math.round(width * (natural.height / natural.width));
		if (height > 640) return { width: Math.round(560 * (640 / height)), height: 640 };
		// The head is 29px of chrome the picture does not get; near enough to add it.
		return { width, height: height + HEAD_PX };
	}

	if (extension === "pdf") return { width: 520, height: 680 };
	// A film is sixteen by nine until something says otherwise, plus the head the picture does not get.
	if (VIDEO.has(extension)) return { width: 560, height: Math.round(560 * (9 / 16)) + HEAD_PX };
	// A sound is a strip: a head, and the controls under it.
	if (AUDIO.has(extension)) return { width: 420, height: 96 };
	if (["html", "htm", "xhtml"].includes(extension)) return { width: 640, height: 440 };
	if (["md", "markdown", "mdx"].includes(extension)) return { width: 480, height: 400 };
	if (TEXTUAL.has(extension)) return { width: 520, height: 380 };
	// Something we can only name: a chip, sized for one line of file name and a size.
	return { width: 320, height: 96 };
}

/**
 * The extensions the board runtime renders as escaped preformatted text.
 *
 * Duplicated from `board-host/lib/board.js` on purpose: that file is standalone by
 * design — it renders a board with no app around it — so it cannot import from
 * here, and this side only uses the list to pick a box. A miss costs a slightly
 * wrong shape, not a broken embed.
 */
const TEXTUAL = new Set([
	"txt", "text", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
	"ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cc", "cpp", "hpp",
	"cs", "swift", "php", "sh", "bash", "zsh", "fish", "sql", "css", "scss", "less", "diff", "patch",
]);

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


/** A deck file's address as a board names it: relative to the board's own folder (`../files/x.png`). */
export function embedPath(boardPath: string, assetPath: string): string {
	const from = boardPath.split("/").slice(0, -1).filter(Boolean);
	const to = assetPath.split("/").filter(Boolean);
	let shared = 0;
	while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
	const up = Array.from({ length: from.length - shared }, () => "..");
	const down = to.slice(shared);
	return [...up, ...down].join("/") || assetPath;
}
