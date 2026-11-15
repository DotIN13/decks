import { randomBytes, randomUUID } from "node:crypto";
import { events, Refused } from "../../protocol/index.ts";
import type { Events, Store } from "../kernel/types.ts";
import { Driver, type Target } from "./driver.ts";
import { ExtensionLine, PING_MS, type Line } from "./line.ts";

// The pairing code, the one extension line, its tab and the pending question.
// Rules 2, 3, 4, 8 and 10 of the README.

const CODE_KEY = "pairing";
export const ANSWER_MS = 120_000;

export type TabState = { paired: boolean; connected: boolean; url?: string; title?: string; pending?: { id: string; text: string }; closed?: string };
type ChromeTab = { id?: number; url?: string; title?: string };
type Pending = { id: string; text: string; run: () => Promise<void>; timer: ReturnType<typeof setTimeout> };

export type HubOptions = { pingMs?: number; answerMs?: number };

/** The shared tab, as the feature keeps it between calls. */
export class TabHub {
	private store: Store | undefined;
	private events: Events | undefined;
	private line: ExtensionLine | undefined;
	private tab: { driver: Driver; url: string; title: string; ready: boolean } | undefined;
	private pending: Pending | undefined;
	private closed: string | undefined;
	private code: string | undefined;
	private rev = 0;

	constructor(private readonly options: HubOptions = {}) {}

	// The extension's line
	/** Given by the feature's start. */
	async start(store: Store, heard: Events): Promise<void> {
		this.store = store;
		this.events = heard;
		const kept = await store.get(CODE_KEY);
		this.code = kept ? new TextDecoder().decode(kept) : undefined;
	}

	stop(): void {
		this.settle();
		this.line?.close("the server stopped");
	}

	/** The code, minted when there is none or when fresh is asked; fresh drops the line. */
	async pair(fresh: boolean): Promise<string> {
		if (this.code && !fresh) return this.code;
		this.code = randomBytes(9).toString("base64url");
		await this.store?.put(CODE_KEY, new TextEncoder().encode(this.code));
		if (fresh) this.line?.close("paired again: a new code was made");
		this.changed();
		return this.code;
	}

	/** Whether a code would be let in, asked before the line is opened. */
	allows(code: string | null): boolean {
		return this.code !== undefined && !!code && same(code, this.code);
	}

	/** An extension dialled in. Refused, closed, when the code is wrong. */
	connect(code: string | null, raw: Line): boolean {
		if (!this.allows(code)) {
			raw.close(1008, "The pairing code is wrong.");
			return false;
		}
		this.line?.close("replaced by a new connection");
		const line = new ExtensionLine(raw, this.options.pingMs ?? PING_MS);
		this.line = line;
		this.tab = undefined;
		this.closed = undefined;
		line.onEvent = (method, params) => void this.heard(line, method, params);
		line.onEnd = (reason) => this.ended(line, reason);
		this.changed();
		return true;
	}

	/** Stop sharing: the extension reads "stopped" as the person's own stop. */
	end(): void {
		this.settle();
		this.line?.close("stopped from the deck");
	}

	private async heard(line: ExtensionLine, method: string, params: unknown[]): Promise<void> {
		if (line !== this.line) return;
		if (method === "chrome.tabs.onCreated") return this.attach(line, params[0] as ChromeTab);
		if (method === "chrome.tabs.onRemoved" && params[0] === this.tab?.driver.tabId) return this.lost("the shared tab was closed");
		if (method === "chrome.debugger.onDetach" && (params[0] as { tabId?: number } | undefined)?.tabId === this.tab?.driver.tabId) return this.lost("the debugger let go of the tab");
		if (method === "chrome.debugger.onEvent" && params[1] === "Page.frameNavigated") {
			const frame = (params[2] as { frame?: { parentId?: string; url?: string } } | undefined)?.frame;
			if (frame && !frame.parentId && frame.url && this.tab) {
				this.tab.url = frame.url;
				void this.refresh();
			}
		}
	}

	/** The first tab the extension names is the tab: attach the debugger to it. */
	private async attach(line: ExtensionLine, tab: ChromeTab | undefined): Promise<void> {
		if (tab?.id === undefined || this.tab) return;
		const driver = new Driver(line, tab.id);
		this.tab = { driver, url: tab.url ?? "", title: tab.title ?? "", ready: false };
		try {
			await line.send("chrome.debugger.attach", [{ tabId: tab.id }, "1.3"]);
			await driver.command("Page.enable").catch(() => undefined);
			if (this.tab?.driver === driver) this.tab.ready = true;
			await this.refresh();
		} catch (error) {
			this.tab = undefined;
			this.closed = `could not attach to the tab: ${(error as Error).message}`;
			this.changed();
		}
	}

	private lost(reason: string): void {
		this.tab = undefined;
		this.closed = reason;
		this.settle();
		this.changed();
	}

	private ended(line: ExtensionLine, reason: string): void {
		if (line !== this.line) return;
		this.line = undefined;
		this.lost(reason);
	}

	// The tab
	state(): TabState {
		const shown = this.tab?.ready ? this.tab : undefined;
		return {
			paired: this.code !== undefined,
			connected: this.line?.open === true && shown !== undefined,
			...(shown ? { url: shown.url, title: shown.title } : {}),
			...(this.pending ? { pending: { id: this.pending.id, text: this.pending.text } } : {}),
			...(this.closed ? { closed: this.closed } : {}),
		};
	}

	/** The driver of the shared tab, or a sentence saying why there is none. */
	driver(): Driver {
		if (this.line?.open && this.tab?.ready) return this.tab.driver;
		if (!this.code) throw new Refused("unavailable", "No Chrome has been paired. Ask for a code with tab.pair and put it in the Decks extension.", "tab.pair");
		if (!this.line?.open) throw new Refused("unavailable", "Your Chrome is not connected. Open the Decks extension in it and share a tab.", "tab.status");
		throw new Refused("unavailable", "Chrome is connected but no tab is shared yet. Share one from the Decks extension.", "tab.status");
	}

	/** After a navigation or an action, read the tab's address and title again. */
	async refresh(): Promise<void> {
		if (!this.tab) return;
		const here = await this.tab.driver.where().catch(() => undefined);
		if (here) Object.assign(this.tab, { url: here.url, title: here.title });
		this.changed();
	}

	changed(): void {
		this.events?.emit(events.tabChanged, { ids: [], by: "tab", rev: ++this.rev });
	}

	// The person's question
	/** Park a question for the person; yes runs the submit. */
	ask(text: string, run: () => Promise<void>): void {
		this.settle();
		const id = randomUUID();
		const timer = setTimeout(() => this.pending?.id === id && this.settle(), this.options.answerMs ?? ANSWER_MS);
		timer.unref?.();
		this.pending = { id, text, run, timer };
		this.changed();
	}

	/** The person's answer: yes runs what waited, no drops it. */
	async answer(id: string, ok: boolean): Promise<void> {
		const waiting = this.pending;
		if (!waiting || waiting.id !== id) throw new Refused("not_found", "That question is no longer waiting: it was answered, replaced or timed out.", "tab.status");
		this.settle();
		if (ok) await waiting.run();
	}

	private settle(): void {
		if (!this.pending) return;
		clearTimeout(this.pending.timer);
		this.pending = undefined;
		this.changed();
	}
}

export function labelOf(target: Target): string {
	if (typeof target === "string") return target;
	if ("ref" in target) return target.ref;
	return target.nth === undefined ? target.name : `${target.name} (${target.nth})`;
}

function same(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
