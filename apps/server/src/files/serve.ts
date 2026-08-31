import { extname } from "node:path";
import type { Response } from "express";

/**
 * Which extensions are documents a browser *runs*, as opposed to data it draws.
 *
 * HTML is the obvious one. SVG is the one that gets forgotten: it is an image
 * everywhere in a UI and a scriptable document to a browser, so an `<img>` of it
 * is safe and a top-level navigation to it is not.
 */
const EXECUTABLE = new Set([".html", ".htm", ".svg", ".xhtml", ".xml"]);

export function isExecutable(path: string): boolean {
	return EXECUTABLE.has(extname(path).toLowerCase());
}

/**
 * Headers for a file that came from outside the deck (§4).
 *
 * `sandbox allow-scripts` puts the response in an opaque origin: it may run, and
 * it may not reach this app's storage, its DOM, or its API. The header rather
 * than only the frame's `sandbox` attribute, because a response that is safe only
 * inside the right frame is a stored cross-site script waiting for someone to
 * open the URL directly — and `/api/file/...` URLs appear in board source, which
 * is exactly the kind of thing people paste into a tab.
 */
export function quarantine(res: Response, path: string): void {
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Referrer-Policy", "no-referrer");
	// Revalidate rather than store: an embedded document the user is editing
	// elsewhere should not be a stale copy from ten minutes ago.
	res.setHeader("Cache-Control", "no-cache");
	if (isExecutable(path)) res.setHeader("Content-Security-Policy", "sandbox allow-scripts");
}

/**
 * Headers for a board, which is ours (§4).
 *
 * No sandbox: the frame shares this origin so the app can read its DOM, which is
 * what makes the editor ordinary app code instead of a script injected into
 * somebody else's document. The trade is written down in DESIGN §4 — a board's
 * scripts are as privileged as the app, which is no more than the agent that
 * wrote them already had through bash.
 */
export function boardHeaders(res: Response): void {
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Cache-Control", "no-cache");
}

/**
 * Headers for a file inside the deck that is *not* a board — an asset (§4).
 *
 * Boards get the app's origin because the app edits them. An asset has no such
 * claim, and since the user can now drop one in, `assets/` holds files nobody in
 * this codebase wrote: an uploaded `evil.html` served under `/api/board/` with
 * board headers would be a stored cross-site script *on the app's own origin*, and
 * `data-embed="../assets/evil.html"` puts the URL in a board file where somebody
 * will eventually open it in a tab. So anything a browser *runs* gets the same
 * `sandbox allow-scripts` a foreign file gets — it may still be an embed, it may
 * still run, and it may not reach this app.
 *
 * The rest — images, PDFs, text — is unaffected, and so are the two things that
 * must keep the origin: a board, and `lib/`. A CSP `sandbox` on a subresource is
 * ignored by browsers (it applies to documents), so an SVG in an `<img>` still
 * draws.
 */
export function assetHeaders(res: Response, path: string): void {
	boardHeaders(res);
	if (isExecutable(path)) {
		res.setHeader("Content-Security-Policy", "sandbox allow-scripts");
		res.setHeader("Referrer-Policy", "no-referrer");
	}
}
