import { api } from "../../connections/connection.ts";
import { authHeaders } from "../../lib/session.ts";
import { CONFIRM_UPLOAD_BYTES, MAX_UPLOAD_BYTES, type UploadedAsset } from "@decks/protocol";
import { ask } from "../../state/confirm.ts";
import { formatBytes, m } from "@decks/i18n";

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
export async function uploadAsset(file: File, onProgress?: (fraction: number) => void, canvas?: string): Promise<UploadedAsset> {
	if (!(await mayUpload(file))) throw new Error(m.files_not_uploaded());
	return send(file, onProgress, canvas);
}

/** Files already asked about and agreed to (`mayUpload`), so a caller that asks first is not asked twice. */
const agreed = new WeakSet<File>();

/**
 * Whether a file may be sent: a big one is asked about first, since it takes a while to send and
 * keeps a lot of the deck's disk. A caller that makes something before uploading (a card for the
 * file) asks this first, so a "no" leaves nothing behind.
 */
export async function mayUpload(file: File): Promise<boolean> {
	if (file.size <= CONFIRM_UPLOAD_BYTES || file.size > MAX_UPLOAD_BYTES || agreed.has(file)) return true;
	const go = await ask({
		title: m.files_upload_ask_title({ name: file.name }),
		body: m.files_upload_ask_body({ size: formatBytes(file.size) }),
		yes: m.files_upload_yes(),
		no: m.files_cancel(),
	});
	if (go) agreed.add(file);
	return go;
}

/**
 * `canvas`: the canvas the file was dropped on, whose own `files/` it goes into (`/api/upload`), so a
 * friend's canvas you may edit takes it in its own folder and it reaches them. Left out, `assets/`.
 */
function send(file: File, onProgress?: (fraction: number) => void, canvas?: string): Promise<UploadedAsset> {
	return new Promise((resolve, reject) => {
		// Refused here as well as on the server: the point of a client-side check is
		// not the limit, it is not spending a minute uploading something that will be
		// refused at the end of it.
		if (file.size > MAX_UPLOAD_BYTES) {
			reject(new Error(m.files_too_large({ name: file.name, size: formatBytes(MAX_UPLOAD_BYTES) })));
			return;
		}
		if (file.size === 0) {
			reject(new Error(m.files_is_empty({ name: file.name })));
			return;
		}

		const request = new XMLHttpRequest();
		request.open("POST", api(`/upload?name=${encodeURIComponent(file.name)}${canvas ? `&canvas=${encodeURIComponent(canvas)}` : ""}`));
		// The bytes are the body, so the type says only that. What the file *is* is
		// decided from its name when it is served, never from what the client claimed.
		request.setRequestHeader("Content-Type", "application/octet-stream");
		// The person's own page, sending a command (`lib/session.ts`).
		for (const [name, value] of Object.entries(authHeaders())) request.setRequestHeader(name, value);
		request.upload.addEventListener("progress", (event) => {
			if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
		});
		request.addEventListener("load", () => {
			if (request.status < 200 || request.status >= 300) {
				// The server answers a refusal as one plain sentence, so it can be shown as-is.
				reject(new Error(request.responseText.trim() || m.files_upload_failed({ status: String(request.status) })));
				return;
			}
			try {
				resolve(JSON.parse(request.responseText) as UploadedAsset);
			} catch {
				reject(new Error(m.files_not_json()));
			}
		});
		request.addEventListener("error", () => reject(new Error(m.files_connection_dropped())));
		request.addEventListener("abort", () => reject(new Error(m.files_cancelled())));
		request.send(file);
	});
}
