import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";

/**
 * `decks.apps.check`: the app opened in the server's own Chromium, the way `decks.canvas.fit` measures a board.
 * What a person would hit first — a page that throws, a request that fails, a blank screen — comes
 * back to the agent as sentences before anyone opens the board, with a picture to look at.
 */
export interface AppCheck {
	url: string;
	title: string;
	/** Uncaught errors and console errors, a line each. */
	errors: string[];
	/** Requests that failed or answered 400 or more: method, address and why. */
	failed: string[];
	/** How much text the page shows, to tell a page from a blank one. */
	words: number;
	/** The picture, deck-relative. */
	file: string;
	/** In a sentence. */
	verdict: string;
}

export async function checkApp(options: {
	borrow: <T>(use: (browser: Browser) => Promise<T>) => Promise<T>;
	origin: string;
	deckPath: string;
	name: string;
	width?: number;
	height?: number;
}): Promise<AppCheck> {
	const url = `${options.origin}/app/${options.name}/`;
	return options.borrow(async (browser) => {
		const context = await browser.newContext({ viewport: { width: options.width ?? 1100, height: options.height ?? 760 }, reducedMotion: "reduce" });
		try {
			const page = await context.newPage();
			const errors: string[] = [];
			const failed: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message.split("\n")[0] ?? ""));
			page.on("console", (message) => {
				if (message.type() === "error") errors.push(message.text().split("\n")[0]!.slice(0, 300));
			});
			page.on("requestfailed", (request) => failed.push(`${request.method()} ${short(request.url(), options.origin)}: ${request.failure()?.errorText ?? "failed"}`));
			page.on("response", (response) => {
				if (response.status() >= 400) failed.push(`${response.request().method()} ${short(response.url(), options.origin)}: ${response.status()}`);
			});
			// Inside a stage run's twenty seconds: the caller has started a server app already.
			await page.goto(url, { waitUntil: "load", timeout: 10_000 });
			await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
			const title = await page.title();
			const words = (await page.evaluate(`(document.body?.innerText ?? "").split(/\\s+/).filter(Boolean).length`)) as number;
			const bytes = await page.screenshot({ type: "png" });
			const dir = join(options.deckPath, ".decks", "shots");
			mkdirSync(dir, { recursive: true });
			const name = `app-${options.name}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
			writeFileSync(join(dir, name), bytes);
			const unique = (list: string[]) => [...new Set(list)].slice(0, 12);
			const e = unique(errors);
			const f = unique(failed);
			const verdict =
				e.length || f.length
					? `apps/${options.name} loads with ${e.length} error${e.length === 1 ? "" : "s"} and ${f.length} failed request${f.length === 1 ? "" : "s"}; fix those first.`
					: words === 0
						? `apps/${options.name} loads without errors but shows no text: look at the picture.`
						: `apps/${options.name} loads cleanly: ${words} words on the page, no errors, no failed requests.`;
			return { url: `/app/${options.name}/`, title, errors: e, failed: f, words, file: `.decks/shots/${name}`, verdict };
		} finally {
			await context.close().catch(() => {});
		}
	});
}

const short = (url: string, origin: string) => (url.startsWith(origin) ? url.slice(origin.length) : url).slice(0, 200);
