import type { Bytes } from "../kernel/index.ts";

// Rule 1: one Chromium, started on first use and closed a minute after the
// last page closes. Everything else sees only these two interfaces.

export type PageOptions = { width: number; height: number; scale: number; scheme: "light" | "dark" };
export type ShotOptions = { type: "png" | "jpeg"; clip?: { x: number; y: number; width: number; height: number }; full?: boolean };

/** One page in its own context. errors holds the page's uncaught script errors. */
export interface Page {
	goto(url: string): Promise<void>;
	show(html: string): Promise<void>;
	evaluate<T>(script: string): Promise<T>;
	screenshot(options: ShotOptions): Promise<Bytes>;
	pdf(size: { width: number; height: number }): Promise<Bytes>;
	errors: string[];
	close(): Promise<void>;
}

export interface Browser {
	page(options: PageOptions): Promise<Page>;
	close(): Promise<void>;
}

const IDLE_MS = 60_000;
const LOAD_MS = 15_000;

type PwBrowser = import("playwright").Browser;
type PwPage = import("playwright").Page;

/** Waits for the page and what it fetches, then two frames, so modules have drawn. */
async function settle(page: PwPage): Promise<void> {
	await page.waitForLoadState("networkidle", { timeout: LOAD_MS }).catch(() => {});
	await page.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true").catch(() => {});
	await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))))").catch(() => {});
}

function wrap(page: PwPage, close: () => Promise<void>): Page {
	const errors: string[] = [];
	page.on("pageerror", (error) => void errors.push(error.message.split("\n")[0] ?? ""));
	return {
		errors,
		async goto(url) {
			await page.goto(url, { waitUntil: "load", timeout: LOAD_MS });
			await settle(page);
		},
		async show(html) {
			await page.setContent(html, { waitUntil: "load", timeout: LOAD_MS });
			await settle(page);
		},
		evaluate: (script) => page.evaluate(script),
		async screenshot(options) {
			const shot = await page.screenshot({ type: options.type, ...(options.clip ? { clip: options.clip } : {}), fullPage: options.full ?? false, ...(options.type === "jpeg" ? { quality: 88 } : {}) });
			return new Uint8Array(shot);
		},
		async pdf(size) {
			return new Uint8Array(await page.pdf({ width: `${size.width}px`, height: `${size.height}px`, printBackground: true, pageRanges: "1" }));
		},
		close,
	};
}

/** The Chromium Playwright installed. A launch that fails says why in one sentence. */
export function chromium(): Browser {
	let started: Promise<PwBrowser> | undefined;
	let open = 0;
	let idle: ReturnType<typeof setTimeout> | undefined;
	const rest = () => {
		clearTimeout(idle);
		idle = setTimeout(() => void shut(), IDLE_MS);
		idle.unref?.();
	};
	const shut = async () => {
		const was = started;
		started = undefined;
		await was?.then((b) => b.close()).catch(() => {});
	};
	const launch = async (): Promise<PwBrowser> => {
		const { chromium: pw } = await import("playwright");
		return pw.launch({ headless: true });
	};
	return {
		async page(options) {
			clearTimeout(idle);
			started ??= launch();
			let browser: PwBrowser;
			try {
				browser = await started;
			} catch (error) {
				started = undefined;
				throw new Error(`No Chromium to draw with: ${(error as Error).message.split("\n")[0]}`);
			}
			const context = await browser.newContext({ viewport: { width: Math.round(options.width), height: Math.round(options.height) }, deviceScaleFactor: options.scale, colorScheme: options.scheme, reducedMotion: "reduce" });
			open++;
			const page = await context.newPage();
			return wrap(page, async () => {
				await context.close().catch(() => {});
				open--;
				if (open === 0) rest();
			});
		},
		async close() {
			clearTimeout(idle);
			await shut();
		},
	};
}
