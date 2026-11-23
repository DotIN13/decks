/**
 * The user's own Chrome, shared with the deck.
 *
 * Nothing here reaches out to the laptop — nothing on it is listening. The Decks extension
 * opens a websocket to this server (`/api/web/relay?code=…`), the same address the browser
 * already uses for the app, and this class turns that socket into a Playwright page through
 * `Relay`. From then on an agent's `decks.web.fill("Email", "…")` is a Playwright call on a
 * tab that is logged in as the user, on the user's own screen.
 *
 * Three rules, and they are the whole design:
 *
 * - **The pairing code is checked at the upgrade.** A socket without it is refused before a
 *   single command; the code lives in `<dataDir>/web-bridge.json` and is shown to the user
 *   once, to paste into the extension.
 * - **Submitting asks first.** `submit` parks a question on the status board and waits for
 *   the user's Allow; an agent can only skip that when the user has said it may.
 * - **Nothing is streamed back.** The tab is in the user's Chrome, so the board for it is a
 *   status card (`lib/live-web.js`): which tab, connected or not, what the agent did.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { WebAction, WebStatus } from "@decks/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import type { WebTarget } from "../canvas/service.ts";
import { Relay } from "./relay.ts";

/** How long a submit waits for the user before giving up. */
const ANSWER_MS = 120_000;
/** How many actions the status card keeps. */
const ACTIONS_KEPT = 12;
/** An accessibility snapshot longer than this is cut, with a note saying so. */
const SNAPSHOT_LIMIT = 60_000;
/** How long a screenshot may take. A tab Chrome is not painting — hidden, on another desktop — never answers. */
const SCREENSHOT_MS = 15_000;
/** How long one action waits for the element it names. */
const ACTION_MS = 10_000;
/** How long a menu choice may take before it is made by keyboard instead. */
const SELECT_MS = 4_000;

type Playwright = typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;
type Locator = import("playwright").Locator;

/** How Playwright is reached — injectable so a test can hand in a stub. */
type Connector = (endpoint: string) => Promise<Browser>;

/** Words on a button whose click reaches outside the page, so it waits for the person's Allow. */
const CONSEQUENTIAL = /\b(send|e-?mail|invite|invitation|pay|payment|purchase|buy|checkout|place order|donate|delete|remove account|add recommender|request (a )?letter)\b/i;

/** How long closing a tab waits for the extension to say it is gone. */
const CLOSE_TAB_MS = 5_000;
/** How long after a click or a key the page is looked at again, to say what the action did. */
const EFFECT_MS = 400;

export class WebBridge {
	private readonly wss = new WebSocketServer({ noServer: true });
	private relay: Relay | undefined;
	private browser: Browser | undefined;
	private readonly actions: WebAction[] = [];
	private pending: { id: string; text: string; resolve: (ok: boolean) => void; timer: NodeJS.Timeout } | undefined;
	private closed: string | undefined;
	private connecting: Promise<void> | undefined;
	/**
	 * The address of a tab that answered none of its thirty seconds, once one has.
	 *
	 * A tab can be readable and photographable and still run no script for this connection at
	 * all: Playwright resolves the element it names and then waits out its whole timeout inside a
	 * document that never answers, thirty seconds a verb. Measured on a OneTrust form in the
	 * user's own Chrome, where a shell button and a question button failed the same way while
	 * reads and screenshots kept working. Remembered, so the second verb that meets it says what
	 * to do at once instead of paying those thirty seconds again. Cleared by a navigation, which
	 * is the remedy.
	 */
	private stale: string | undefined;
	/**
	 * The address the last `read`'s references belong to.
	 *
	 * Every page numbers its own references from `e1`, so a reference held across a
	 * navigation does not go stale — it silently points at a *different* element. Keeping the
	 * address the snapshot was taken at is what turns that into a sentence.
	 */
	private refs: { url: string } | undefined;
	/**
	 * The title of each page, by address, read from Playwright as pages load.
	 *
	 * The relay learns a tab's title once, when the debugger attaches; the page then
	 * navigates and the card would keep saying "about:blank". Playwright hears every load,
	 * so the title is asked for then and the card follows the tab.
	 */
	private readonly titles = new Map<string, string>();
	/**
	 * The tab the agent drives, once it has picked or opened one.
	 *
	 * Every tab in the Decks group is shared, so the agent may open, switch to and close any of
	 * them. Until it picks, or after its tab closes, it drives the first.
	 */
	private current: Page | undefined;

	constructor(
		private readonly dataDir: string,
		/** Told on every change, so the app can broadcast `web.status`. */
		private readonly changed: (status: WebStatus) => void,
		private readonly connect: Connector = defaultConnector,
	) {}

	// --- pairing -------------------------------------------------------------------

	/** The pairing code, minted on first ask and kept in the data directory. */
	code(): string {
		const file = join(this.dataDir, "web-bridge.json");
		if (existsSync(file)) {
			try {
				const parsed = JSON.parse(readFileSync(file, "utf8")) as { code?: unknown };
				if (typeof parsed.code === "string" && parsed.code.length >= 8) return parsed.code;
			} catch {
				/* rewritten below */
			}
		}
		// The first ask mints one quietly: this is the greeting's own read, and a broadcast
		// from inside it would reach the browser *before* the greeting that carries the code.
		return this.mint();
	}

	/** A new code. The extension has to be paired again. */
	repair(): string {
		const code = this.mint();
		this.changed(this.status());
		return code;
	}

	private mint(): string {
		const code = randomBytes(9).toString("base64url");
		mkdirSync(this.dataDir, { recursive: true });
		writeFileSync(join(this.dataDir, "web-bridge.json"), JSON.stringify({ code }, null, "\t") + "\n");
		return code;
	}

	// --- the socket -----------------------------------------------------------------

	/**
	 * The upgrade for `/api/web/relay`, routed here by `index.ts`.
	 *
	 * Refused with a plain HTTP status when the code is wrong: the extension reads the
	 * close reason and shows it, and a wrong code should say so rather than time out.
	 */
	handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const url = new URL(request.url ?? "/", "http://decks");
		const offered = url.searchParams.get("code") ?? "";
		if (!offered || !safeEqual(offered, this.code())) {
			socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nThe pairing code is wrong.");
			socket.destroy();
			return;
		}
		this.wss.handleUpgrade(request, socket, head, (ws) => void this.accept(ws));
	}

	private async accept(ws: WebSocket): Promise<void> {
		// One Chrome at a time. A second connection replaces the first, which is what a
		// laptop that woke up and reconnected wants.
		this.relay?.close("replaced by a new connection");
		const relay = new Relay(ws);
		this.relay = relay;
		this.closed = undefined;
		relay.onTabs = () => this.changed(this.status());
		relay.onclose = (reason) => {
			if (this.relay !== relay) return;
			this.relay = undefined;
			this.browser = undefined;
			this.stale = undefined;
			this.closed = reason;
			this.settle(false);
			this.changed(this.status());
		};
		this.connecting = (async () => {
			const endpoint = await relay.start();
			this.stale = undefined;
			await relay.ready();
			const browser = await this.connect(endpoint);
			if (this.relay !== relay) {
				await browser.close().catch(() => {});
				return;
			}
			this.browser = browser;
			browser.on("disconnected", () => {
				if (this.browser === browser) this.browser = undefined;
			});
			for (const context of browser.contexts()) {
				for (const page of context.pages()) this.watch(page);
				context.on("page", (page) => this.watch(page));
			}
			this.changed(this.status());
		})();
		this.connecting.catch((error: Error) => {
			this.note(`could not connect to the shared tab: ${error.message}`, false);
			relay.close(error.message);
		});
		await this.connecting.catch(() => {});
	}

	private watch(page: Page): void {
		const refresh = async () => {
			try {
				const url = page.url();
				const title = await page.title();
				if (this.titles.get(url) === title) return;
				this.titles.set(url, title);
				this.changed(this.status());
			} catch {
				/* the page went away mid-read */
			}
		};
		page.on("load", () => void refresh());
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) void refresh();
		});
		void refresh();
	}

	/** Detach from the shared tab. The extension shows the tab as unshared. */
	stop(): void {
		this.settle(false);
		this.relay?.close("stopped from the deck");
	}

	dispose(): void {
		this.stop();
		this.wss.close();
	}

	// --- what the board shows ---------------------------------------------------------

	status(): WebStatus {
		const tabs = (this.relay?.tabs() ?? []).map((tab) => ({ title: (tab.url && this.titles.get(tab.url)) || tab.title || "", url: tab.url ?? "" }));
		return {
			paired: existsSync(join(this.dataDir, "web-bridge.json")),
			connected: this.browser !== undefined && tabs.length > 0,
			...(tabs[0] ? { tab: (this.current && !this.current.isClosed() && tabs.find((tab) => tab.url === this.current!.url())) || tabs[0] } : {}),
			tabs,
			actions: [...this.actions],
			...(this.pending ? { pending: { id: this.pending.id, text: this.pending.text } } : {}),
			...(this.closed ? { closed: this.closed } : {}),
		};
	}

	/** The user's answer to a pending submit, from the status board. */
	answer(id: string, ok: boolean): boolean {
		if (!this.pending || this.pending.id !== id) return false;
		this.settle(ok);
		return true;
	}

	private settle(ok: boolean): void {
		if (!this.pending) return;
		const { resolve, timer } = this.pending;
		clearTimeout(timer);
		this.pending = undefined;
		resolve(ok);
	}

	private note(text: string, ok: boolean): void {
		this.actions.push({ at: Date.now(), text, ok });
		while (this.actions.length > ACTIONS_KEPT) this.actions.shift();
		this.changed(this.status());
	}

	// --- what the agent can do --------------------------------------------------------

	/** The page the agent drives: the first shared tab. Throws a sentence when there is none. */
	async page(): Promise<Page> {
		if (this.connecting) await this.connecting.catch(() => {});
		const browser = this.browser;
		if (!browser || !browser.isConnected()) {
			throw new Error(
				this.status().paired
					? "Your Chrome is not connected. Open the Decks extension in it and share a tab."
					: "No Chrome has been paired. Ask for the pairing code with decks web pairing and put it in the Decks extension.",
			);
		}
		const pages = this.allPages();
		if (this.current && !this.current.isClosed() && pages.includes(this.current)) return this.current;
		this.current = undefined;
		const page = pages[0];
		if (!page) throw new Error("Chrome is connected but no tab is shared. Share one from the Decks extension.");
		return page;
	}

	private allPages(): Page[] {
		return (this.browser?.contexts() ?? []).flatMap((context) => context.pages()).filter((page) => !page.isClosed());
	}

	/** What the page looks like, cheaply: its address and a fingerprint of its markup, to tell whether an action did anything. */
	private async mark(page: Page): Promise<{ url: string; print: string }> {
		const seen = await page
			.evaluate(() => ({ href: location.href, print: `${document.documentElement.outerHTML.length}:${document.title}:${document.querySelectorAll("*").length}:${document.body?.innerText.length ?? 0}` }))
			.catch(() => ({ href: page.url(), print: "" }));
		// The page's own address, not Playwright's: a move within the page reaches it late or not at all through the relay.
		return { url: seen.href, print: seen.print };
	}

	/**
	 * What an action did to the page, said in its answer: the address it went to, when it left
	 * the page, and `changed: false` when nothing at all moved, so a click that went nowhere is
	 * not mistaken for one that worked.
	 */
	private async effect(page: Page, before: { url: string; print: string }): Promise<{ navigated?: string; changed: boolean }> {
		await page.waitForTimeout(EFFECT_MS);
		const driven = await this.page().catch(() => page);
		const after = await this.mark(driven);
		if (after.url !== before.url) {
			this.refs = undefined;
			this.stale = undefined;
			return { navigated: after.url, changed: true };
		}
		return { changed: after.print !== before.print };
	}

	/** One tab of the group, by its number from `tabs` (1 is the first) or by words in its address or title. */
	private async pick(which: number | string): Promise<Page> {
		await this.page();
		const pages = this.allPages();
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
	async tabs(): Promise<{ index: number; title: string; url: string; current: boolean }[]> {
		const driven = await this.page();
		return Promise.all(this.allPages().map(async (page, i) => ({ index: i + 1, title: await page.title().catch(() => ""), url: page.url(), current: page === driven })));
	}

	/** Open a new tab in the Decks group, at `url` when given, and act on it from now on. */
	async newTab(url?: string): Promise<{ index: number; url: string; title: string }> {
		const driven = await this.page();
		const page = await driven.context().newPage();
		this.watch(page);
		this.current = page;
		this.refs = undefined;
		this.stale = undefined;
		try {
			if (url?.trim()) await page.goto(url.trim(), { waitUntil: "domcontentloaded", timeout: 30_000 });
		} catch (error) {
			this.note(`opened a tab but could not load ${url}: ${(error as Error).message}`, false);
			throw error;
		}
		const result = { index: this.allPages().indexOf(page) + 1, url: page.url(), title: await page.title().catch(() => "") };
		this.note(`opened a new tab${result.title || result.url ? `: ${result.title || result.url}` : ""}`, true);
		return result;
	}

	/** Act on another tab of the group from now on, without moving the person's own focus. */
	async useTab(which: number | string): Promise<{ index: number; url: string; title: string }> {
		const page = await this.pick(which);
		this.current = page;
		this.refs = undefined;
		this.stale = undefined;
		const result = { index: this.allPages().indexOf(page) + 1, url: page.url(), title: await page.title().catch(() => "") };
		this.note(`switched to ${result.title || result.url}`, true);
		return result;
	}

	/** Close a tab of the group (the one acted on, when none is named). The last one cannot go: stop sharing instead. */
	async closeTab(which?: number | string): Promise<{ closed: string; tabs: number }> {
		const page = which === undefined || which === "" ? await this.page() : await this.pick(which);
		if (this.allPages().length <= 1) throw new Error("That is the only shared tab; closing it would end the sharing. Use decks web stop instead.");
		const name = (await page.title().catch(() => "")) || page.url();
		// Closed once the extension says the tab is gone; a tab that never says so is let go after a few seconds.
		await Promise.race([page.close(), new Promise((resolve) => setTimeout(resolve, CLOSE_TAB_MS))]);
		if (this.current === page) this.current = undefined;
		this.refs = undefined;
		this.note(`closed ${name}`, true);
		return { closed: name, tabs: this.allPages().filter((p) => p !== page).length };
	}

	/** Navigate the shared tab. */
	async open(url: string): Promise<{ url: string; title: string }> {
		const page = await this.page();
		try {
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
			// A navigation is what gives a tab the script it never had, so it is also the cure.
			this.stale = undefined;
			const result = { url: page.url(), title: await page.title() };
			this.note(`opened ${result.title || result.url}`, true);
			return result;
		} catch (error) {
			this.note(`could not open ${url}: ${(error as Error).message}`, false);
			throw error;
		}
	}

	/**
	 * The page as text: its address, its title, and the accessibility tree.
	 *
	 * The tree is what a screen reader would say — every field with its label and value,
	 * every button with its name — which is how the agent sees the page. No picture.
	 */
	async read(options?: { full?: boolean }): Promise<{ url: string; title: string; snapshot: string; truncated?: boolean }> {
		const page = await this.page();
		// `mode: "ai"` is the same tree with a `[ref=eN]` on every element, and it descends into
		// iframes. The references are not decoration: a field with no label, six fields sharing
		// one, and a control the page hides and paints over are all unreachable by name, and all
		// three are ordinary on a real form.
		const raw = await page.locator("body").ariaSnapshot({ mode: "ai" });
		// A birth year or a country is a menu of a hundred options, and those lists were most of a
		// form's read. Folded to the chosen one and a count; `select` takes any option by name.
		const snapshot = options?.full ? raw : foldOptions(raw);
		this.refs = { url: page.url() };
		const truncated = snapshot.length > SNAPSHOT_LIMIT;
		return {
			url: page.url(),
			title: await page.title(),
			snapshot: truncated ? `${snapshot.slice(0, SNAPSHOT_LIMIT)}\n… (cut at ${SNAPSHOT_LIMIT} characters)` : snapshot,
			...(truncated ? { truncated } : {}),
		};
	}

	/**
	 * Every field on the page, frames included, with its label and what it holds now: the short
	 * way to check a form after filling it, instead of reading the whole tree again.
	 */
	async values(): Promise<{ url: string; fields: { label: string; value: string; kind: string }[] }> {
		const page = await this.page();
		const fields: { label: string; value: string; kind: string }[] = [];
		for (const frame of page.frames()) {
			// A string, not a function: the server's TypeScript build adds helpers to functions that do not exist in the page.
			const found = await frame
				.evaluate<{ label: string; value: string; kind: string }[]>(FIELD_VALUES_SCRIPT)
				.catch(() => []);
			fields.push(...found);
		}
		return { url: page.url(), fields };
	}

	/**
	 * A picture of the shared tab, for the agent to look at.
	 *
	 * The one thing `read` cannot give: what is actually on screen — a thumbnail, a chart, a
	 * layout that the accessibility tree flattens. PNG, the viewport by default or the whole
	 * page with `full`, saved under the data directory and handed back as bytes so the stage
	 * tool can put it in the result the agent reads. Nothing goes to the board: the tab is on
	 * the user's own screen, and the picture is for the agent.
	 *
	 * Chrome only paints a tab it is showing. A tab in the background of its window, or on
	 * another virtual desktop, answers `Page.captureScreenshot` late or not at all, so the
	 * error names that rather than "timeout".
	 */
	async screenshot(options?: { full?: boolean }): Promise<{ file: string; width: number; height: number; png: Buffer }> {
		const page = await this.page();
		try {
			const png = await page.screenshot({ type: "png", fullPage: options?.full === true, timeout: SCREENSHOT_MS, animations: "disabled" });
			const size = pngSize(png);
			const dir = join(this.dataDir, "web-shots");
			mkdirSync(dir, { recursive: true });
			const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
			writeFileSync(file, png);
			this.note(`took a screenshot (${size.width}×${size.height})`, true);
			return { file, ...size, png };
		} catch (error) {
			const message = /timeout/i.test((error as Error).message)
				? "The tab did not paint in time. Chrome only draws a tab it is showing: bring the shared tab to the front of its window and try again."
				: (error as Error).message;
			this.note(`could not take a screenshot: ${message}`, false);
			throw new Error(message);
		}
	}

	/** Type into a field, named by its label, or by a reference from `read`. */
	async fill(field: WebTarget, text: string): Promise<{ field: string }> {
		const page = await this.page();
		await this.live(page);
		const label = labelOf(field);
		try {
			const target = await this.locate(page, field, (name) => [
				page.getByLabel(name, { exact: true }),
				page.getByLabel(name),
				page.getByPlaceholder(name),
				page.getByRole("textbox", { name }),
				page.getByRole("combobox", { name }),
			]);
			// A field the page hides and paints over takes typing the same way it takes a click.
			const reach = await reachOf(target);
			await target.fill(text, { timeout: ACTION_MS, ...(reach.kind === "hidden" ? { force: true } : {}) });
			// `fill` sends `input` only. Pages that count words or validate on `keyup`, `change` or
			// `blur` (the GSB portal's word counters) never heard it, so those follow, as after typing.
			await target
				.evaluate((el) => {
					for (const type of ["keyup", "change"]) el.dispatchEvent(new Event(type, { bubbles: true }));
					el.dispatchEvent(new FocusEvent("blur"));
					el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
				})
				.catch(() => {});
			this.note(`filled ${label}`, true);
			return { field: label };
		} catch (error) {
			this.note(`could not fill ${label}: ${(error as Error).message}`, false);
			throw this.staleOr(error, page);
		}
	}

	/** Pick an option in a `<select>`, by its label or value. */
	async select(field: WebTarget, option: string): Promise<{ field: string; option: string; byKeyboard?: boolean }> {
		const page = await this.page();
		await this.live(page);
		const label = labelOf(field);
		try {
			const target = await this.locate(page, field, (name) => [page.getByLabel(name), page.getByRole("combobox", { name })]);
			try {
				await target.selectOption({ label: option }, { timeout: SELECT_MS }).catch(() => target.selectOption(option, { timeout: SELECT_MS }));
			} catch (first) {
				// Some forms answer a menu's change with script that never returns (seen on the Stanford
				// GSB portal's date menus), and the choice stalls. A person would focus the menu and type
				// the option's name, which the browser handles itself; that is the second way, checked after.
				await target.focus({ timeout: 3_000 });
				await page.keyboard.type(option, { delay: 0 });
				const shown = await target.evaluate((el) => (el as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ?? "").catch(() => "");
				if (shown.toLowerCase() !== option.trim().toLowerCase()) throw first;
				this.note(`chose ${option} for ${label}, by typing it into the menu`, true);
				return { field: label, option, byKeyboard: true };
			}
			this.note(`chose ${option} for ${label}`, true);
			return { field: label, option };
		} catch (error) {
			this.note(`could not choose ${option} for ${label}: ${(error as Error).message}`, false);
			throw this.staleOr(error, page);
		}
	}

	/** Click a button, link, checkbox or piece of text, by its name or by a reference. */
	async click(what: WebTarget, options?: { ask?: boolean }): Promise<{ clicked: string; navigated?: string; changed: boolean; allowed?: boolean }> {
		const page = await this.page();
		await this.live(page);
		const label = labelOf(what);
		try {
			const target = await this.locate(page, what, (name) => [
				page.getByRole("button", { name, exact: true }),
				page.getByRole("button", { name }),
				page.getByRole("link", { name }),
				page.getByRole("checkbox", { name }),
				page.getByRole("radio", { name }),
				page.getByRole("tab", { name }),
				page.getByRole("menuitem", { name }),
				page.getByLabel(name),
				page.getByText(name, { exact: true }),
				page.getByText(name),
			]);
			// A click that sends something out of the page cannot be taken back: an email to a
			// recommender, a payment, an invitation. Those wait for the person's Allow, as submit does.
			const said = await target.evaluate((el) => `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""} ${(el as HTMLInputElement).value ?? ""}`).catch(() => label);
			if (options?.ask !== false && CONSEQUENTIAL.test(`${label} ${said}`)) {
				const allowed = await this.askUser(`The agent wants to click "${label}" on ${await page.title()}`);
				if (!allowed) {
					this.note(`click "${label}" — not allowed`, false);
					return { clicked: label, allowed: false, changed: false };
				}
			}
			const before = await this.mark(page);
			await this.clickOn(target, label);
			const effect = await this.effect(page, before);
			if (effect.navigated) this.note(`the click went to ${effect.navigated}`, true);
			return { clicked: label, ...effect };
		} catch (error) {
			this.note(`could not click ${label}: ${(error as Error).message}`, false);
			throw this.staleOr(error, page);
		}
	}

	/**
	 * Click, having first asked the page what is in the way.
	 *
	 * Playwright refuses to click what it cannot see, and reports both cases with the same
	 * timeout — so the difference has to be measured rather than read out of an error. A
	 * control inside a clipped or 1px wrapper is the framework pattern (Angular Material hides
	 * the real radio and paints a span). Something *else* lying on top is a dialog or an
	 * overlay: a forced click there would go through it, which is the silent wrong action this
	 * whole change exists to stop, so it is refused with the thing that covers it named.
	 *
	 * A hidden control is not clicked by coordinates even so. A mouse event lands wherever the
	 * page paints, and what is painted at a clipped element's own centre is something else —
	 * measured, not assumed: forcing one checked nothing at all. So it gets the click the
	 * page's own stand-in performs, on the element itself, which sets the value and fires the
	 * change the framework is listening for.
	 */
	private async clickOn(target: Locator, label: string): Promise<void> {
		await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
		const reach = await reachOf(target);
		if (reach.kind === "covered") throw new Error(`${label} is on the page, but ${reach.by} is over it. Close or scroll past that first.`);
		if (reach.kind === "gone") throw new Error(`${label} is in the page, but ${reach.why}.`);
		if (reach.kind === "hidden") {
			await target.evaluate((node: unknown) => (node as { click(): void }).click());
			this.note(`clicked ${label} (hidden behind what the page paints)`, true);
			return;
		}
		await target.click({ timeout: ACTION_MS });
		this.note(`clicked ${label}`, true);
	}

	/**
	 * The one element a target names — or a sentence saying why not.
	 *
	 * A reference is exact. A name is not: it goes down the ladder of ways to ask for that
	 * name, and **stops at the first rung that matches anything**. If that rung matches more
	 * than one thing, it says so and names both ways out, rather than taking the first and
	 * writing into whichever row happened to be earliest in the document.
	 */
	private async locate(page: Page, target: WebTarget, candidates: (name: string) => Locator[]): Promise<Locator> {
		if (typeof target === "object" && "ref" in target) return this.byRef(page, target.ref);
		const name = typeof target === "string" ? target : target.name;
		const nth = typeof target === "object" && "nth" in target ? target.nth : undefined;
		if (!name?.trim()) throw new Error("A target needs a name, or a { ref } from decks web read.");
		for (const found of candidates(name)) {
			let candidate = found;
			let count = await candidate.count();
			if (count === 0) continue;
			// A label used twice is usually one copy on screen and one hidden (a stale dialog, a
			// template), or one in the open dialog and one on the page behind it. Narrow to what is
			// visible, then to the open dialog, before counting: what a person would mean.
			if (count > 1) {
				const visible = candidate.filter({ visible: true });
				const shown = await visible.count();
				if (shown > 0 && shown < count) [candidate, count] = [visible, shown];
			}
			if (count > 1) {
				const dialog = page.locator('[role="dialog"]:visible, dialog[open]').last();
				if ((await dialog.count()) > 0) {
					const inside = candidate.and(dialog.locator("*"));
					const there = await inside.count();
					if (there > 0 && there < count) [candidate, count] = [inside, there];
				}
			}
			if (nth !== undefined) {
				if (!Number.isInteger(nth) || nth < 1 || nth > count)
					throw new Error(`"${name}" matches ${count} ${count === 1 ? "element" : "elements"} on this page, so nth: ${nth} is out of range — nth: 1 is the first.`);
				return candidate.nth(nth - 1);
			}
			if (count > 1)
				throw new Error(
					`"${name}" matches ${count} elements on this page, so I did not guess. Take one by position with { name: "${name}", nth: 1 } — 1 is the first — or read the page (decks.web.read) and pass one of its references, like { ref: "e42" }.`,
				);
			return candidate.first();
		}
		throw new Error(`Nothing on the page is called "${name}". Read the page (decks.web.read) to see the names it uses.`);
	}

	/** The element a `[ref=…]` from the last read names, or a sentence about why it cannot. */
	private async byRef(page: Page, ref: string): Promise<Locator> {
		const id = String(ref ?? "").trim().replace(/^@/, "");
		if (!/^(f\d+)?e\d+$/.test(id)) throw new Error(`"${ref}" is not a reference. A reference looks like e42, or f3e42 inside a frame, and comes from decks web read.`);
		if (!this.refs) throw new Error("References come from the page itself: read it with decks web read first, then pass one of the [ref=…] ids it shows.");
		if (this.refs.url !== page.url())
			throw new Error(
				`That reference was read from ${this.refs.url} and the tab is now on ${page.url()}. Read the page again — every page numbers its references from e1, so an old one can point at the wrong element.`,
			);
		const target = page.locator(`aria-ref=${id}`);
		if ((await target.count()) === 0) throw new Error(`Nothing on this page has the reference ${id}. Read it again — the page may have redrawn.`);
		return target;
	}

	/** Press a key in the page — "Enter", "Tab", "Escape". */
	/** Put the keyboard's focus on a field or button, as a click would, without clicking it. */
	async focus(what: WebTarget): Promise<{ focused: string }> {
		const page = await this.page();
		await this.live(page);
		const label = labelOf(what);
		try {
			const target = await this.locate(page, what, (name) => [page.getByLabel(name, { exact: true }), page.getByLabel(name), page.getByRole("textbox", { name }), page.getByRole("combobox", { name }), page.getByRole("button", { name })]);
			await target.focus({ timeout: 10_000 });
			this.note(`focused ${label}`, true);
			return { focused: label };
		} catch (error) {
			this.note(`could not focus ${label}: ${(error as Error).message}`, false);
			throw this.staleOr(error, page);
		}
	}

	/**
	 * Type text key by key, as a person would, into the field that has focus — or into `into`
	 * first, when given. Sites that count words or check as you type see every keystroke.
	 */
	async type(text: string, into?: WebTarget): Promise<{ typed: number; into?: string }> {
		if (into !== undefined) await this.focus(into);
		const page = await this.page();
		await this.live(page);
		await page.keyboard.type(text, { delay: 10 });
		const where = into === undefined ? undefined : labelOf(into);
		this.note(`typed ${text.length} characters${where ? ` into ${where}` : ""}`, true);
		return { typed: text.length, ...(where ? { into: where } : {}) };
	}

	async press(key: string): Promise<{ pressed: string; navigated?: string; changed: boolean }> {
		const page = await this.page();
		await this.live(page);
		const before = await this.mark(page);
		await page.keyboard.press(key);
		this.note(`pressed ${key}`, true);
		const effect = await this.effect(page, before);
		if (effect.navigated) this.note(`pressing ${key} went to ${effect.navigated}`, true);
		return { pressed: key, ...effect };
	}

	/**
	 * Submit: press the named button, or Enter, **after the user allows it**.
	 *
	 * The question goes on the status board with Allow and Deny; the answer comes back as
	 * `web.answer`. Two minutes with no answer is a refusal. `ask: false` skips the question
	 * and is for when the user has said, for this site, that they do not want to be asked.
	 */
	async submit(what?: WebTarget, options?: { ask?: boolean }): Promise<{ submitted: string; allowed: boolean }> {
		const page = await this.page();
		const named = what === undefined ? undefined : labelOf(what);
		const label = named ? `press "${named}"` : "press Enter to submit";
		if (options?.ask !== false) {
			const allowed = await this.askUser(`The agent wants to ${label} on ${await page.title()}`);
			if (!allowed) {
				this.note(`${label} — not allowed`, false);
				return { submitted: named ?? "Enter", allowed: false };
			}
		}
		if (what !== undefined) await this.click(what);
		else {
			await this.live(page);
			await page.keyboard.press("Enter");
			this.note("pressed Enter to submit", true);
		}
		return { submitted: named ?? "Enter", allowed: true };
	}

	/**
	 * Meet a page the action verbs can run in, or say why not at once.
	 *
	 * Only ever asks when a previous verb already met a page that answered nothing, and leaves
	 * the evaluation running when it does not answer — there is nothing to cancel it with — so a
	 * page that is still mute costs two seconds instead of thirty. The person can also reload the
	 * tab in front of them, and this notices: the page answers, the memory is dropped, and the
	 * next verb works.
	 */
	private async live(page: Page): Promise<void> {
		if (!this.stale) return;
		const answered = await Promise.race([
			page
				.evaluate(() => 1)
				.then(() => true)
				.catch(() => false),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
		]);
		if (answered) {
			this.stale = undefined;
			return;
		}
		throw new Error(unscriptableSaid(page.url()));
	}

	/**
	 * The error to throw for a verb that has just failed, in the agent's language.
	 *
	 * Playwright's own report of this is thirty seconds of timeout with the element resolved and
	 * nothing about why, which reads like a broken connection rather than a page that needs one
	 * navigation. Everything else is passed through untouched.
	 */
	private staleOr(error: unknown, page: Page): Error {
		const text = String((error as Error)?.message ?? "");
		if (!/locator\.evaluate: Timeout \d+ms exceeded|locator\.(scrollIntoViewIfNeeded|click|fill|selectOption): Timeout \d+ms exceeded/.test(text)) return error as Error;
		this.stale = page.url();
		return new Error(unscriptableSaid(this.stale));
	}

	private askUser(text: string): Promise<boolean> {
		this.settle(false);
		return new Promise<boolean>((resolve) => {
			const id = randomUUID();
			const timer = setTimeout(() => {
				if (this.pending?.id === id) this.settle(false);
			}, ANSWER_MS);
			timer.unref?.();
			this.pending = { id, text, resolve, timer };
			this.changed(this.status());
		});
	}
}

/** What to call a target in the action log and in a sentence about it. */
function labelOf(target: WebTarget): string {
	if (typeof target === "string") return target;
	if ("ref" in target) return target.ref;
	return target.nth === undefined ? target.name : `${target.name} (${target.nth})`;
}

/**
 * Why a tab can be read and photographed but not clicked, and the one thing that fixes it.
 *
 * Nothing here claims a mechanism, because the observable is what an agent needs: every verb
 * resolves the element it names and then runs no script in that page for thirty seconds, while
 * the accessibility tree and screenshots answer normally, which is what makes the connection
 * look healthy. A navigation of the same address ends it — measured on a live OneTrust page,
 * where three clicks in a row timed out at thirty seconds each and four clicks after a
 * navigation landed in about two seconds each — and `decks.web.open` of a tab's own address is
 * that navigation.
 */
function unscriptableSaid(url: string): string {
	return `The tab is on ${url} and nothing on it can be clicked or filled: the element resolved and then the page ran no script for thirty seconds, while reads and screenshots kept working. Navigate it once — decks web open "${url}" — and every verb works; nothing else will.`;
}

/** Why a click would or would not land, as the page itself sees it. */
type Reach = { kind: "ready" } | { kind: "hidden" } | { kind: "covered"; by: string } | { kind: "gone"; why: string };

/**
 * Ask the page what is between a click and its element.
 *
 * Playwright reports "hidden" and "covered" with the same timeout, and the difference
 * decides whether forcing is correct or dangerous — so it is measured here instead. A
 * clipped or 1px ancestor is a control the page hides and paints over; anything else lying
 * on the element's own centre point is an overlay that a real click would not get through
 * either.
 */
async function reachOf(target: Locator): Promise<Reach> {
	/*
	 * This body runs in the page, and this package is compiled without the DOM library on
	 * purpose — server code has no business naming `document`. So the shape it needs is
	 * declared here, and everything is reached through the element itself: its own document
	 * for the hit test, and that document's window for the viewport and computed styles.
	 */
	type Node = {
		getBoundingClientRect(): { width: number; height: number; top: number; left: number; right: number; bottom: number };
		parentElement: Node | null;
		contains(other: Node | null): boolean;
		tagName: string;
		id: string;
		ownerDocument: {
			elementFromPoint(x: number, y: number): (Node & { tagName: string; id: string }) | null;
			defaultView: { innerWidth: number; innerHeight: number; getComputedStyle(node: Node): { clip: string; clipPath: string } } | null;
		};
	};
	return (await target.evaluate((node: unknown): Reach => {
		const el = node as Node;
		const view = el.ownerDocument.defaultView;
		const box = el.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return { kind: "gone", why: "it is not displayed" };
		if (view && (box.bottom <= 0 || box.right <= 0 || box.top >= view.innerHeight || box.left >= view.innerWidth)) return { kind: "gone", why: "it is off screen" };
		for (let up: Node | null = el; up; up = up.parentElement) {
			const rect = up.getBoundingClientRect();
			const style = view?.getComputedStyle(up);
			if (rect.width <= 2 || rect.height <= 2 || style?.clip === "rect(0px, 0px, 0px, 0px)" || style?.clipPath === "inset(100%)") return { kind: "hidden" };
		}
		const top = el.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
		if (!top) return { kind: "gone", why: "nothing is painted where it sits" };
		if (top === el || el.contains(top) || top.contains(el)) return { kind: "ready" };
		return { kind: "covered", by: `<${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ""}>` };
	})) as Reach;
}

async function defaultConnector(endpoint: string): Promise<Browser> {
	const playwright: Playwright = await import("playwright");
	return playwright.chromium.connectOverCDP(endpoint);
}

/** Width and height from a PNG's header, which is the cheapest way to learn them. */
function pngSize(png: Buffer): { width: number; height: number } {
	if (png.length < 24) return { width: 0, height: 0 };
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Long option lists in a snapshot, cut to their first few, the chosen one, and how many there are. */
export function foldOptions(snapshot: string, keep = 4, over = 12): string {
	const lines = snapshot.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; ) {
		const match = /^(\s*)- option\b/.exec(lines[i]!);
		if (!match) {
			out.push(lines[i]!);
			i++;
			continue;
		}
		const indent = match[1]!;
		let j = i;
		while (j < lines.length && lines[j]!.startsWith(`${indent}- option`)) j++;
		const run = lines.slice(i, j);
		if (run.length <= over) out.push(...run);
		else {
			const chosen = run.find((line) => /\[selected\]/.test(line));
			const first = run.slice(0, keep);
			out.push(...first);
			if (chosen && !first.includes(chosen)) out.push(chosen);
			out.push(`${indent}- … ${run.length} options in all (read with full: true to see every one; select takes any by name)`);
		}
		i = j;
	}
	return out.join("\n");
}

/** Run in each frame by `values`: every visible field, its label as a person would read it, and its value. Plain JavaScript. */
const FIELD_VALUES_SCRIPT = String.raw`(() => {
	const out = [];
	const text = (el) => ((el && el.textContent) || "").replace(/\s+/g, " ").trim();
	for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
		if (["hidden", "submit", "button", "image", "reset", "file"].includes(el.type)) continue;
		const style = getComputedStyle(el);
		if (style.display === "none" || style.visibility === "hidden") continue;
		const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
		const byAria = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(" ");
		let wrapped = "";
		const holder = el.closest("label");
		if (holder) { const copy = holder.cloneNode(true); copy.querySelectorAll("select, option, input, textarea").forEach((n) => n.remove()); wrapped = text(copy); }
		const row = el.closest("tr");
		const head = row ? text(row.querySelector("th, [role=rowheader]")) : "";
		const column = row ? Array.from(row.querySelectorAll("input, select, textarea")).indexOf(el) + 1 : 0;
		const label = el.getAttribute("aria-label") || byAria || text(byFor) || wrapped || el.placeholder || (head ? head + " (column " + column + ")" : "") || el.name || "(no label)";
		let value;
		if (el.tagName === "SELECT") value = el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : "";
		else if (el.type === "checkbox" || el.type === "radio") value = el.checked ? "checked" : "not checked";
		else if (el.type === "password") value = el.value ? "(set)" : "";
		else value = el.value;
		out.push({ label: label.slice(0, 120), value: String(value).slice(0, 200), kind: el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.type || "text" });
	}
	return out;
})()`;
