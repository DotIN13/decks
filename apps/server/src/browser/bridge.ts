/**
 * The user's own Chrome, shared with the deck.
 *
 * Nothing here reaches out to the laptop — nothing on it is listening. The Decks extension
 * opens a websocket to this server (`/api/web/relay?code=…`), the same address the browser
 * already uses for the app, and this class turns that socket into a Playwright page through
 * `Relay`. From then on an agent's `stage.web.fill("Email", "…")` is a Playwright call on a
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
import type { WebTarget } from "../stage/service.ts";
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

type Playwright = typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;
type Locator = import("playwright").Locator;

/** How Playwright is reached — injectable so a test can hand in a stub. */
export type Connector = (endpoint: string) => Promise<Browser>;

export class WebBridge {
	private readonly wss = new WebSocketServer({ noServer: true });
	private relay: Relay | undefined;
	private browser: Browser | undefined;
	private readonly actions: WebAction[] = [];
	private pending: { id: string; text: string; resolve: (ok: boolean) => void; timer: NodeJS.Timeout } | undefined;
	private closed: string | undefined;
	private connecting: Promise<void> | undefined;
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
			this.closed = reason;
			this.settle(false);
			this.changed(this.status());
		};
		this.connecting = (async () => {
			const endpoint = await relay.start();
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
			...(tabs[0] ? { tab: tabs[0] } : {}),
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
					: "No Chrome has been paired. Ask for the pairing code with stage.web.pairing() and put it in the Decks extension.",
			);
		}
		const page = browser.contexts().flatMap((context) => context.pages())[0];
		if (!page) throw new Error("Chrome is connected but no tab is shared. Share one from the Decks extension.");
		return page;
	}

	/** Navigate the shared tab. */
	async open(url: string): Promise<{ url: string; title: string }> {
		const page = await this.page();
		try {
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
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
	async read(): Promise<{ url: string; title: string; snapshot: string; truncated?: boolean }> {
		const page = await this.page();
		// `mode: "ai"` is the same tree with a `[ref=eN]` on every element, and it descends into
		// iframes. The references are not decoration: a field with no label, six fields sharing
		// one, and a control the page hides and paints over are all unreachable by name, and all
		// three are ordinary on a real form.
		const snapshot = await page.locator("body").ariaSnapshot({ mode: "ai" });
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
			this.note(`filled ${label}`, true);
			return { field: label };
		} catch (error) {
			this.note(`could not fill ${label}: ${(error as Error).message}`, false);
			throw error;
		}
	}

	/** Pick an option in a `<select>`, by its label or value. */
	async select(field: WebTarget, option: string): Promise<{ field: string; option: string }> {
		const page = await this.page();
		const label = labelOf(field);
		try {
			const target = await this.locate(page, field, (name) => [page.getByLabel(name), page.getByRole("combobox", { name })]);
			await target.selectOption({ label: option }, { timeout: ACTION_MS }).catch(() => target.selectOption(option, { timeout: ACTION_MS }));
			this.note(`chose ${option} for ${label}`, true);
			return { field: label, option };
		} catch (error) {
			this.note(`could not choose ${option} for ${label}: ${(error as Error).message}`, false);
			throw error;
		}
	}

	/** Click a button, link, checkbox or piece of text, by its name or by a reference. */
	async click(what: WebTarget): Promise<{ clicked: string }> {
		const page = await this.page();
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
			await this.clickOn(target, label);
			return { clicked: label };
		} catch (error) {
			this.note(`could not click ${label}: ${(error as Error).message}`, false);
			throw error;
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
		if (!name?.trim()) throw new Error("A target needs a name, or a { ref } from stage.web.read().");
		for (const candidate of candidates(name)) {
			const count = await candidate.count();
			if (count === 0) continue;
			if (nth !== undefined) {
				if (!Number.isInteger(nth) || nth < 1 || nth > count)
					throw new Error(`"${name}" matches ${count} ${count === 1 ? "element" : "elements"} on this page, so nth: ${nth} is out of range — nth: 1 is the first.`);
				return candidate.nth(nth - 1);
			}
			if (count > 1)
				throw new Error(
					`"${name}" matches ${count} elements on this page, so I did not guess. Take one by position with { name: "${name}", nth: 1 } — 1 is the first — or read the page (stage.web.read) and pass one of its references, like { ref: "e42" }.`,
				);
			return candidate.first();
		}
		throw new Error(`Nothing on the page is called "${name}". Read the page (stage.web.read) to see the names it uses.`);
	}

	/** The element a `[ref=…]` from the last read names, or a sentence about why it cannot. */
	private async byRef(page: Page, ref: string): Promise<Locator> {
		const id = String(ref ?? "").trim().replace(/^@/, "");
		if (!/^e\d+$/.test(id)) throw new Error(`"${ref}" is not a reference. A reference looks like e42 and comes from stage.web.read().`);
		if (!this.refs) throw new Error("References come from the page itself: read it with stage.web.read() first, then pass one of the [ref=…] ids it shows.");
		if (this.refs.url !== page.url())
			throw new Error(
				`That reference was read from ${this.refs.url} and the tab is now on ${page.url()}. Read the page again — every page numbers its references from e1, so an old one can point at the wrong element.`,
			);
		const target = page.locator(`aria-ref=${id}`);
		if ((await target.count()) === 0) throw new Error(`Nothing on this page has the reference ${id}. Read it again — the page may have redrawn.`);
		return target;
	}

	/** Press a key in the page — "Enter", "Tab", "Escape". */
	async press(key: string): Promise<{ pressed: string }> {
		const page = await this.page();
		await page.keyboard.press(key);
		this.note(`pressed ${key}`, true);
		return { pressed: key };
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
			await page.keyboard.press("Enter");
			this.note("pressed Enter to submit", true);
		}
		return { submitted: named ?? "Enter", allowed: true };
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
