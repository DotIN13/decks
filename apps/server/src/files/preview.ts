import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Browser } from "playwright";

const run = promisify(execFile);

/**
 * A picture of a file for its card on the canvas: a PDF's first page, an SVG drawn, a web page as
 * a browser opens it. Written once beside the file, as a film's poster is (`media.ts`), and written
 * again only when the file is newer than its picture.
 *
 * A PDF is drawn by poppler's `pdftoppm`, which reads its page count too (`pdfinfo`); an SVG or a
 * web page by the server's Chromium, which is already there for board pictures (`boards/thumbs.ts`).
 * A server without either answers with no picture, and the card shows the file's name alone.
 */

export interface FilePreview {
	/** The picture, deck-relative. */
	preview: string;
	w: number;
	h: number;
	/** A PDF's pages. */
	pages?: number;
	/** A web page's title. */
	title?: string;
}

/** How wide a preview is drawn, in pixels: twice a card's width on the canvas, for a sharp picture zoomed in. */
const PREVIEW_WIDTH = 960;
/**
 * A web page is opened at the width it lands on the canvas at (`LIVE_PAGE_W` in the web app), so
 * its still lays out as the live frame over it does and the one gives way to the other unseen.
 */
const PAGE = { width: 800, height: 500 };

export const previewPath = (path: string) => `${path}.preview.png`;

export function previewKind(path: string): "pdf" | "svg" | "page" | undefined {
	const extension = (path.split(".").pop() ?? "").toLowerCase();
	if (extension === "pdf") return "pdf";
	if (extension === "svg") return "svg";
	if (extension === "html" || extension === "htm") return "page";
	return undefined;
}

export async function filePreview(deckRoot: string, path: string): Promise<FilePreview | undefined> {
	const kind = previewKind(path);
	if (!kind) return undefined;
	const full = join(deckRoot, path);
	const out = previewPath(path);
	const target = join(deckRoot, out);
	const fresh = existsSync(target) && statSync(target).mtimeMs >= statSync(full).mtimeMs;
	const facts: Omit<FilePreview, "preview" | "w" | "h"> = {};
	try {
		if (kind === "pdf") {
			const info = await run("pdfinfo", [full], { timeout: 10_000 }).catch(() => undefined);
			const pages = Number(/^Pages:\s+(\d+)/m.exec(info?.stdout ?? "")?.[1]);
			if (pages) facts.pages = pages;
			if (!fresh) await run("pdftoppm", ["-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to-x", String(PREVIEW_WIDTH), "-scale-to-y", "-1", full, target.replace(/\.png$/, "")], { timeout: 20_000 });
		} else if (!fresh || kind === "page") {
			const browser = await chromium();
			const page = await browser.newPage({ viewport: kind === "page" ? PAGE : { width: PREVIEW_WIDTH, height: PREVIEW_WIDTH }, deviceScaleFactor: kind === "page" ? PREVIEW_WIDTH / PAGE.width : 1 });
			try {
				if (kind === "svg") {
					// Drawn as a picture, its own size kept, its width the preview's, on nothing: the still stands in for the live image, which has no background.
					// As data: a page set from a string may not load a file:// address.
					const data = `data:image/svg+xml;base64,${readFileSync(full).toString("base64")}`;
					await page.setContent(`<html><body style="margin:0;background:transparent"><img id="i" src="${data}" style="display:block;width:${PREVIEW_WIDTH}px;height:auto"></body></html>`);
					await page.waitForFunction("document.getElementById('i')?.complete", undefined, { timeout: 5000 }).catch(() => {});
					const box = await page.locator("#i").boundingBox();
					if (!fresh) await page.screenshot({ path: target, omitBackground: true, clip: { x: 0, y: 0, width: PREVIEW_WIDTH, height: Math.max(1, Math.min(PREVIEW_WIDTH * 2, Math.round(box?.height ?? PREVIEW_WIDTH))) } });
				} else {
					await page.goto(pathToFileURL(full).href, { waitUntil: "load", timeout: 10_000 }).catch(() => {});
					const title = (await page.title().catch(() => "")).trim();
					if (title) facts.title = title;
					if (!fresh) await page.screenshot({ path: target });
				}
			} finally {
				await page.close().catch(() => {});
				idle();
			}
		}
	} catch {
		return undefined;
	}
	const size = pngSize(target);
	return size ? { preview: out, ...size, ...facts } : undefined;
}

function pngSize(file: string): { w: number; h: number } | undefined {
	try {
		const head = readFileSync(file).subarray(0, 24);
		return head.toString("ascii", 12, 16) === "IHDR" ? { w: head.readUInt32BE(16), h: head.readUInt32BE(20) } : undefined;
	} catch {
		return undefined;
	}
}

/** One Chromium for previews, closed a minute after the last one: pictures are asked for one file at a time. */
let browser: Promise<Browser> | undefined;
let closing: ReturnType<typeof setTimeout> | undefined;
function chromium(): Promise<Browser> {
	clearTimeout(closing);
	browser ??= import("playwright").then((playwright) => playwright.chromium.launch());
	return browser;
}
function idle(): void {
	clearTimeout(closing);
	closing = setTimeout(() => {
		const open = browser;
		browser = undefined;
		void open?.then((b) => b.close()).catch(() => {});
	}, 60_000);
	closing.unref?.();
}
