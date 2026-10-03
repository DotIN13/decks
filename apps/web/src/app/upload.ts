import { api } from "../connections/connection.ts";
import { CONFIRM_UPLOAD_BYTES, MAX_UPLOAD_BYTES, type UploadedAsset } from "@decks/protocol";
import { ask } from "../state/confirm.ts";

/**
 * Sending a dropped file to the server, with something honest to show while it goes.
 *
 * `XMLHttpRequest` and not `fetch`, for one reason: `fetch` cannot report how much
 * of a request body it has sent. Streaming request bodies exist, but they are
 * Chromium-only and need HTTP/2, and a deck is often served over plain HTTP on
 * loopback — so the modern API would silently give no progress on the machine this
 * is used on. A drop that copies 8MB with nothing moving on screen reads as broken,
 * which makes the progress the feature rather than a nicety.
 */
export async function uploadAsset(file: File, onProgress?: (fraction: number) => void): Promise<UploadedAsset> {
	if (!(await mayUpload(file))) throw new Error("not uploaded");
	return send(file, onProgress);
}

/** Files already asked about and agreed to (`mayUpload`), so a caller that asks first is not asked twice. */
const agreed = new WeakSet<File>();

/**
 * Whether a file may be sent: a big one is asked about first, since it takes a while to send and
 * keeps a lot of the deck's disk. A caller that makes something before uploading (a board for the
 * file) asks this first, so a "no" leaves nothing behind.
 */
export async function mayUpload(file: File): Promise<boolean> {
	if (file.size <= CONFIRM_UPLOAD_BYTES || file.size > MAX_UPLOAD_BYTES || agreed.has(file)) return true;
	const mb = Math.round(file.size / 1024 / 1024);
	const go = await ask({
		title: `Upload ${file.name}?`,
		body: `It is ${mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`}. It is copied into the deck's assets folder, which takes a while and keeps that much disk.`,
		yes: "Upload",
		no: "Cancel",
	});
	if (go) agreed.add(file);
	return go;
}

function send(file: File, onProgress?: (fraction: number) => void): Promise<UploadedAsset> {
	return new Promise((resolve, reject) => {
		// Refused here as well as on the server: the point of a client-side check is
		// not the limit, it is not spending a minute uploading something that will be
		// refused at the end of it.
		if (file.size > MAX_UPLOAD_BYTES) {
			reject(new Error(`${file.name} is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`));
			return;
		}
		if (file.size === 0) {
			reject(new Error(`${file.name} is empty`));
			return;
		}

		const request = new XMLHttpRequest();
		request.open("POST", api(`/upload?name=${encodeURIComponent(file.name)}`));
		// The bytes are the body, so the type says only that. What the file *is* is
		// decided from its name when it is served, never from what the client claimed.
		request.setRequestHeader("Content-Type", "application/octet-stream");
		request.upload.addEventListener("progress", (event) => {
			if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
		});
		request.addEventListener("load", () => {
			if (request.status < 200 || request.status >= 300) {
				// The server answers a refusal as one plain sentence, so it can be shown as-is.
				reject(new Error(request.responseText.trim() || `upload failed (${request.status})`));
				return;
			}
			try {
				resolve(JSON.parse(request.responseText) as UploadedAsset);
			} catch {
				reject(new Error("the server's answer was not JSON"));
			}
		});
		request.addEventListener("error", () => reject(new Error("the connection dropped")));
		request.addEventListener("abort", () => reject(new Error("cancelled")));
		request.send(file);
	});
}

/**
 * A deck-relative asset path -> what a board should write in `data-embed`.
 *
 * A board is a document, so its `data-embed` means what it would mean in an
 * `<img src>` on that page (DESIGN §4) — `assets/x.png` beside `boards/plan.html`
 * has to be written `../assets/x.png`. Computed from the two paths rather than
 * hardcoded as `../`, because a board is only *conventionally* in `boards/`: the
 * deck is a directory a person edits, and one day a board will sit somewhere else.
 */
export function embedPath(boardPath: string, assetPath: string): string {
	const from = boardPath.split("/").slice(0, -1).filter(Boolean);
	const to = assetPath.split("/").filter(Boolean);
	let shared = 0;
	while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
	const up = Array.from({ length: from.length - shared }, () => "..");
	const down = to.slice(shared);
	return [...up, ...down].join("/") || assetPath;
}
