import { randomUUID } from "node:crypto";
import type { ThumbService } from "./thumbs.ts";

/**
 * A picture of a board as a reader left it, drawn by the server's Chrome from a snapshot of the
 * page the reader's browser had (`canvas/shots/adaptors.ts`, the `snapshot` adaptor).
 *
 * The browser sends the document as it stood: its markup after every script had run, with the
 * values typed into fields, each scrolled box's position and each canvas's pixels written into it,
 * and the scripts taken out so nothing runs twice. Copying that costs the page a few milliseconds,
 * where copying every element's computed style costs it most of a second. The server loads it at
 * the board's own address, so its stylesheets, fonts and pictures resolve exactly as the board's
 * do, puts the scroll positions back, and takes the picture.
 */
export interface SnapshotAsk {
	path: string;
	html: string;
	w: number;
	h: number;
	scheme: "light" | "dark";
}

/** Run in the page: wait for its fonts, and put each scrolled box back where the reader had it. */
const RESTORE = `(async () => {
	await document.fonts.ready;
	for (const box of document.querySelectorAll("[data-decks-scroll]")) {
		const [left, top] = (box.dataset.decksScroll || "0,0").split(",").map(Number);
		box.scrollLeft = left || 0;
		box.scrollTop = top || 0;
	}
})()`;

/** The tallest a snapshot is drawn, in board pixels, as a whole picture is. */
const MAX_H = 12_000;

export async function renderSnapshot(thumbs: ThumbService, origin: string, ask: SnapshotAsk): Promise<Buffer> {
	const w = Math.max(160, Math.min(4000, Math.round(ask.w)));
	const h = Math.max(120, Math.min(MAX_H, Math.round(ask.h)));
	const address = `${origin}/api/board/${ask.path.split("/").map(encodeURIComponent).join("/")}?snapshot=${randomUUID()}`;
	return thumbs.borrow(async (browser) => {
		const context = await browser.newContext({ viewport: { width: w, height: Math.min(h, 2000) }, deviceScaleFactor: 1, colorScheme: ask.scheme, reducedMotion: "reduce", javaScriptEnabled: true });
		try {
			// The snapshot is served at the board's own address: same origin, same relative URLs.
			await context.route(address, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: ask.html }));
			const page = await context.newPage();
			await page.goto(address, { waitUntil: "load", timeout: 15_000 });
			await page.evaluate(RESTORE);
			return await page.screenshot({ type: "jpeg", quality: 85, clip: { x: 0, y: 0, width: w, height: h }, fullPage: true, animations: "disabled", timeout: 15_000 });
		} finally {
			await context.close().catch(() => {});
		}
	});
}
