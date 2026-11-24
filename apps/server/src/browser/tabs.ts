/**
 * The tabs of the Decks group in the person's Chrome: listed, opened, switched between and closed by
 * the agent. Which tab the other verbs act on is the bridge's (`bridge.ts`); this keeps the group's
 * own verbs, and tells the bridge through its host when the tab acted on changes.
 */
type Page = import("playwright").Page;

const CLOSE_TAB_MS = 5_000;

/** What the tab group asks of the bridge that owns the connection. */
export interface TabHost {
	/** The tab the verbs act on, or a sentence when there is none. */
	page(): Promise<Page>;
	/** Every open tab of the group, in order. */
	pages(): Page[];
	/** Listen to a tab the group opened, as to one the person shared. */
	watch(page: Page): void;
	/** Act on this tab from now on: what was read of the last one no longer holds. */
	drive(page: Page): void;
	/** This tab is closed: stop acting on it if it was the one. */
	closed(page: Page): void;
	note(text: string, ok: boolean): void;
}

export class TabGroup {
	constructor(private readonly host: TabHost) {}

	/** One tab of the group, by its number from `tabs` (1 is the first) or by words in its address or title. */
	private async pick(which: number | string): Promise<Page> {
		await this.host.page();
		const pages = this.host.pages();
		if (typeof which === "number" || /^\d+$/.test(String(which).trim())) {
			const n = Number(which);
			const page = pages[n - 1];
			if (!page) throw new Error(`There is no tab ${n}: the group has ${pages.length}. decks web tabs lists them.`);
			return page;
		}
		const words = String(which).trim().toLowerCase();
		if (!words) throw new Error("Name a tab by its number from decks web tabs, or by words in its address or title.");
		const titled = await Promise.all(pages.map(async (page) => ({ page, text: `${page.url()} ${await page.title().catch(() => "")}`.toLowerCase() })));
		const found = titled.filter((t) => t.text.includes(words));
		if (found.length === 0) throw new Error(`No shared tab has "${which}" in its address or title. decks web tabs lists them.`);
		if (found.length > 1) throw new Error(`${found.length} shared tabs have "${which}" in their address or title; name one by its number from decks web tabs.`);
		return found[0]!.page;
	}

	/** Every tab in the Decks group, numbered from 1, and which one the verbs act on. */
	async list(): Promise<{ index: number; title: string; url: string; current: boolean }[]> {
		const driven = await this.host.page();
		return Promise.all(this.host.pages().map(async (page, i) => ({ index: i + 1, title: await page.title().catch(() => ""), url: page.url(), current: page === driven })));
	}

	/** Open a new tab in the Decks group, at `url` when given, and act on it from now on. */
	async open(url?: string): Promise<{ index: number; url: string; title: string }> {
		const driven = await this.host.page();
		const page = await driven.context().newPage();
		this.host.watch(page);
		this.host.drive(page);
		try {
			if (url?.trim()) await page.goto(url.trim(), { waitUntil: "domcontentloaded", timeout: 30_000 });
		} catch (error) {
			this.host.note(`opened a tab but could not load ${url}: ${(error as Error).message}`, false);
			throw error;
		}
		const result = { index: this.host.pages().indexOf(page) + 1, url: page.url(), title: await page.title().catch(() => "") };
		this.host.note(`opened a new tab${result.title || result.url ? `: ${result.title || result.url}` : ""}`, true);
		return result;
	}

	/** Act on another tab of the group from now on, without moving the person's own focus. */
	async use(which: number | string): Promise<{ index: number; url: string; title: string }> {
		const page = await this.pick(which);
		this.host.drive(page);
		const result = { index: this.host.pages().indexOf(page) + 1, url: page.url(), title: await page.title().catch(() => "") };
		this.host.note(`switched to ${result.title || result.url}`, true);
		return result;
	}

	/** Close a tab of the group (the one acted on, when none is named). The last one cannot go: stop sharing instead. */
	async close(which?: number | string): Promise<{ closed: string; tabs: number }> {
		const page = which === undefined || which === "" ? await this.host.page() : await this.pick(which);
		if (this.host.pages().length <= 1) throw new Error("That is the only shared tab; closing it would end the sharing. Use decks web stop instead.");
		const name = (await page.title().catch(() => "")) || page.url();
		// Closed once the extension says the tab is gone; a tab that never says so is let go after a few seconds.
		await Promise.race([page.close(), new Promise((resolve) => setTimeout(resolve, CLOSE_TAB_MS))]);
		this.host.closed(page);
		this.host.note(`closed ${name}`, true);
		return { closed: name, tabs: this.host.pages().filter((p) => p !== page).length };
	}
}
