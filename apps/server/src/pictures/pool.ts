/**
 * The server's Chromium: the Playwright types the pictures use, the launch with WebGPU, and the
 * harness's own pass given to its reads (`withOwnReads`). The pages it holds are leased by `ThumbService`.
 */

export type Playwright = typeof import("playwright");
export type Browser = import("playwright").Browser;
export type Page = import("playwright").Page;
export type BrowserContext = import("playwright").BrowserContext;

/**
 * WebGPU, which headless Chromium has only when asked: the stage's engine draws with it in a stage
 * picture (`stage/shots.ts`). On a Mac through Metal; elsewhere SwiftShader stands in for a card.
 */
const WEBGPU = ["--enable-unsafe-webgpu", ...(process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-unsafe-swiftshader"])];

/**
 * A browser whose every new context gives the harness's own GETs of its `/api/` (`origins`) the
 * harness's own pass (`auth/passes.ts`), unless the request already says who it is. Only GETs and
 * HEADs, and only to the harness: a page's script may not call verbs on it, and nothing goes elsewhere.
 */
export function withOwnReads(browser: Browser, origins: () => string[], pass: () => string): Browser {
	const plain = browser.newContext.bind(browser);
	browser.newContext = async (...args: Parameters<Browser["newContext"]>) => {
		const context = await plain(...args);
		await context.route(
			(url) => url.pathname.startsWith("/api/") && origins().includes(url.origin),
			(route) => {
				const request = route.request();
				const headers = request.headers();
				if ((request.method() !== "GET" && request.method() !== "HEAD") || headers.authorization) return route.continue();
				return route.continue({ headers: { ...headers, authorization: `Bearer ${pass()}` } });
			},
		);
		return context;
	};
	return browser;
}

export async function launchChromium(): Promise<Browser> {
	const playwright: Playwright = await import("playwright");
	return playwright.chromium.launch({ args: WEBGPU });
}
