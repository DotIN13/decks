/**
 * The relay: one websocket from the user's Chrome in, one Chrome DevTools endpoint out.
 *
 * The Decks extension (`extension/`) attaches Chrome's debugger to a tab the user picked and
 * opens a websocket to this server. What travels on it is a five-command envelope around
 * `chrome.debugger` — attach, detach, sendCommand, and tabs.create/remove — with the four
 * events Chrome raises coming back the other way. That is the wire protocol of Playwright's
 * own browser extension, unchanged, so that a stock Playwright can drive the tab: this class
 * listens on a loopback port of its own, and `chromium.connectOverCDP` on that port cannot
 * tell it from a local Chrome.
 *
 * Ported from `packages/playwright-core/src/tools/mcp/{cdpRelay,cdpRelayV2,browserModel}.ts`
 * in microsoft/playwright (Apache-2.0, Copyright (c) Microsoft Corporation), with three
 * changes: the extension socket is handed in by the server that accepted it rather than
 * listened for here; there is no launching of a browser, because the browser is on somebody
 * else's machine; and a heartbeat goes down the socket every twenty seconds, because a
 * Manifest V3 service worker with a quiet websocket is put to sleep by Chrome.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";

type Debuggee = { tabId?: number; extensionId?: string; targetId?: string };
type DebuggerSession = Debuggee & { sessionId?: string };
export type Tab = {
	id?: number;
	index: number;
	windowId: number;
	openerTabId?: number;
	url?: string;
	title?: string;
	active: boolean;
	pinned: boolean;
};

type CDPMessage = {
	id?: number;
	sessionId?: string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code?: number; message: string };
};

type SendCommand = (method: string, params: unknown[]) => Promise<unknown>;

/** How often the extension is pinged. Under Chrome's thirty-second idle limit for a worker. */
const HEARTBEAT_MS = 20_000;

/**
 * The tab model: chrome tab ids on one side, CDP session ids on the other.
 *
 * Every tab the extension announces is "known"; once Playwright turns auto-attach on, each
 * known tab gets the debugger attached and a session id of its own, and from then on the
 * events Chrome raises for the tab are re-emitted to Playwright under that session.
 */
class BrowserModel {
	private toClient: ((message: CDPMessage) => void) | null = null;
	private readonly known = new Map<number, Tab>();
	private readonly sessions = new Map<number, { tabId: number; sessionId: string; targetInfo: Record<string, unknown> | undefined; children: Set<string> }>();
	private autoAttach = false;
	private nextSession = 1;
	/** Someone to tell when the set of attached tabs changes. */
	onTabs?: () => void;

	constructor(private readonly toExtension: SendCommand) {}

	connectOverCDP(toClient: (message: CDPMessage) => void): void {
		this.toClient = toClient;
	}

	/** The tabs with a session, in attach order. */
	attached(): Tab[] {
		return [...this.sessions.keys()].map((tabId) => this.known.get(tabId)).filter((tab): tab is Tab => tab !== undefined);
	}

	private emit(message: CDPMessage): void {
		this.toClient?.(message);
	}

	// --- what the extension says --------------------------------------------------

	onTabCreated(tab: Tab): void {
		if (tab.id === undefined) return;
		this.known.set(tab.id, tab);
		if (this.autoAttach) void this.attachTab(tab.id).catch(() => {});
	}

	onTabRemoved(tabId: number): void {
		this.known.delete(tabId);
		this.detachTab(tabId);
	}

	onDebuggerEvent(source: DebuggerSession, method: string, params: unknown): void {
		if (source.tabId === undefined) return;
		const session = this.sessions.get(source.tabId);
		if (!session) return;
		const child = (params as { sessionId?: string } | undefined)?.sessionId;
		if (method === "Target.attachedToTarget" && child) session.children.add(child);
		else if (method === "Target.detachedFromTarget" && child) session.children.delete(child);
		/*
		 * The tab's own title and address, kept current: the status card shows them, and
		 * `Page.frameNavigated` for the main frame is when they change.
		 */
		if (method === "Page.frameNavigated") {
			const frame = (params as { frame?: { parentId?: string; url?: string } } | undefined)?.frame;
			const tab = this.known.get(source.tabId);
			if (frame && !frame.parentId && tab && frame.url) {
				tab.url = frame.url;
				this.onTabs?.();
			}
		}
		this.emit({ sessionId: source.sessionId || session.sessionId, method, params });
	}

	onDebuggerDetach(source: Debuggee): void {
		if (source.tabId !== undefined) this.detachTab(source.tabId);
	}

	// --- what Playwright asks ----------------------------------------------------

	async enableAutoAttach(): Promise<void> {
		this.autoAttach = true;
		await Promise.all([...this.known.keys()].map((tabId) => this.attachTab(tabId).catch(() => {})));
	}

	async createTarget(url: string | undefined): Promise<{ targetId: string | undefined }> {
		const tab = (await this.toExtension("chrome.tabs.create", [{ url }])) as Tab | undefined;
		if (tab?.id === undefined) throw new Error("Failed to create tab");
		this.known.set(tab.id, tab);
		const session = await this.attachTab(tab.id);
		return { targetId: session.targetInfo?.targetId as string | undefined };
	}

	async closeTarget(targetId: string | undefined): Promise<{ success: boolean }> {
		const session = targetId ? this.find((s) => s.targetInfo?.targetId === targetId) : undefined;
		if (!session) return { success: false };
		await this.toExtension("chrome.tabs.remove", [session.tabId]);
		return { success: true };
	}

	getTargetInfo(sessionId: string | undefined): unknown {
		if (!sessionId) return undefined;
		return this.find((s) => s.sessionId === sessionId)?.targetInfo;
	}

	/** A browser-level command has no tab; it goes through whichever tab is attached. */
	async sendBrowserCommand(method: string, params: unknown): Promise<unknown> {
		const session = this.sessions.values().next().value;
		if (!session) throw new Error(`No attached tab to forward browser-level command: ${method}`);
		return this.toExtension("chrome.debugger.sendCommand", [{ tabId: session.tabId }, method, params]);
	}

	async sendCommand(sessionId: string, method: string, params: unknown): Promise<unknown> {
		let session = this.find((s) => s.sessionId === sessionId);
		let cdpSessionId: string | undefined;
		if (!session) {
			// A child session — a worker, an out-of-process frame — keeps its own id and
			// is routed to the tab that owns it.
			session = this.find((s) => s.children.has(sessionId));
			cdpSessionId = sessionId;
		}
		if (!session) throw new Error(`No tab found for sessionId: ${sessionId}`);
		return this.toExtension("chrome.debugger.sendCommand", [{ tabId: session.tabId, sessionId: cdpSessionId }, method, params]);
	}

	// --- internals ---------------------------------------------------------------

	private async attachTab(tabId: number) {
		const existing = this.sessions.get(tabId);
		if (existing) return existing;
		await this.toExtension("chrome.debugger.attach", [{ tabId }, "1.3"]);
		const result = (await this.toExtension("chrome.debugger.sendCommand", [{ tabId }, "Target.getTargetInfo"])) as { targetInfo?: Record<string, unknown> } | undefined;
		const targetInfo = result?.targetInfo;
		const sessionId = `pw-tab-${this.nextSession++}`;
		const session = { tabId, sessionId, targetInfo, children: new Set<string>() };
		this.sessions.set(tabId, session);
		const tab = this.known.get(tabId);
		if (tab && targetInfo) {
			if (typeof targetInfo.title === "string") tab.title = targetInfo.title;
			if (typeof targetInfo.url === "string") tab.url = targetInfo.url;
		}
		this.emit({
			method: "Target.attachedToTarget",
			params: { sessionId, targetInfo: { ...targetInfo, attached: true }, waitingForDebugger: false },
		});
		this.onTabs?.();
		return session;
	}

	private detachTab(tabId: number): void {
		const session = this.sessions.get(tabId);
		if (!session) return;
		this.sessions.delete(tabId);
		this.emit({ method: "Target.detachedFromTarget", params: { sessionId: session.sessionId, targetId: session.targetInfo?.targetId } });
		this.onTabs?.();
	}

	private find(predicate: (session: { tabId: number; sessionId: string; targetInfo: Record<string, unknown> | undefined; children: Set<string> }) => boolean) {
		for (const session of this.sessions.values()) if (predicate(session)) return session;
		return undefined;
	}
}

/** The extension's end of the socket: numbered commands out, answers and events in. */
class ExtensionConnection {
	private readonly callbacks = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private lastId = 0;
	onmessage?: (method: string, params: unknown[]) => void;
	onclose?: (reason: string) => void;

	constructor(private readonly ws: WebSocket) {
		ws.on("message", (data) => this.receive(data));
		ws.on("close", (_code, reason) => {
			this.dispose();
			this.onclose?.(reason.toString());
		});
		ws.on("error", () => this.dispose());
	}

	send(method: string, params: unknown[]): Promise<unknown> {
		if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("The extension's socket is not open"));
		const id = ++this.lastId;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => this.callbacks.set(id, { resolve, reject }));
	}

	close(reason: string): void {
		if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000, reason);
	}

	private receive(data: RawData): void {
		let message: { id?: number; method?: string; params?: unknown[]; result?: unknown; error?: string };
		try {
			message = JSON.parse(data.toString());
		} catch {
			this.ws.close(1002, "malformed JSON");
			return;
		}
		if (message.id && this.callbacks.has(message.id)) {
			const callback = this.callbacks.get(message.id)!;
			this.callbacks.delete(message.id);
			if (message.error) callback.reject(new Error(message.error));
			else callback.resolve(message.result);
			return;
		}
		if (message.method) this.onmessage?.(message.method, message.params ?? []);
	}

	private dispose(): void {
		for (const callback of this.callbacks.values()) callback.reject(new Error("The extension disconnected"));
		this.callbacks.clear();
	}
}

/**
 * One shared browser: an extension socket in, a CDP endpoint on loopback out.
 *
 *     const relay = new Relay(socketFromTheExtension);
 *     const endpoint = await relay.start();     // ws://127.0.0.1:NNNNN/cdp/<uuid>
 *     await relay.ready();                       // the extension has named its tabs
 *     const browser = await chromium.connectOverCDP(endpoint);
 */
export class Relay {
	private readonly model: BrowserModel;
	private readonly extension: ExtensionConnection;
	private client: WebSocket | null = null;
	private readonly http: Server;
	private readonly wss: WebSocketServer;
	private readonly path = `/cdp/${randomUUID()}`;
	private readonly readiness: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };
	private heartbeat: NodeJS.Timeout | undefined;
	private closed = false;
	/** The extension went away, or was told to. Called once. */
	onclose?: (reason: string) => void;
	/** The attached tabs changed, or one of them navigated. */
	onTabs?: () => void;

	constructor(socket: WebSocket) {
		this.extension = new ExtensionConnection(socket);
		this.model = new BrowserModel((method, params) => this.extension.send(method, params));
		this.model.onTabs = () => this.onTabs?.();
		let resolve!: () => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		promise.catch(() => {});
		this.readiness = { promise, resolve, reject };

		this.extension.onmessage = (method, params) => this.onExtensionEvent(method, params);
		this.extension.onclose = (reason) => this.close(reason || "the extension disconnected");

		this.http = createServer((_req, res) => {
			res.statusCode = 404;
			res.end();
		});
		this.wss = new WebSocketServer({ noServer: true });
		this.http.on("upgrade", (request, socket, head) => {
			if (request.url !== this.path) {
				socket.destroy();
				return;
			}
			this.wss.handleUpgrade(request, socket, head, (ws) => this.acceptClient(ws));
		});
		this.heartbeat = setInterval(() => {
			this.extension.send("decks.ping", []).catch(() => {});
		}, HEARTBEAT_MS);
		this.heartbeat.unref?.();
	}

	/** Listen on loopback and return the CDP endpoint Playwright should connect to. */
	start(): Promise<string> {
		return new Promise((resolve, reject) => {
			this.http.once("error", reject);
			this.http.listen(0, "127.0.0.1", () => {
				const address = this.http.address();
				if (!address || typeof address === "string") return reject(new Error("The relay did not get a port"));
				resolve(`ws://127.0.0.1:${address.port}${this.path}`);
			});
		});
	}

	/** Resolves once the extension has announced its tabs (`extension.initialized`). */
	ready(): Promise<void> {
		return this.readiness.promise;
	}

	/** The tabs the debugger is attached to, with their current title and address. */
	tabs(): Tab[] {
		return this.model.attached();
	}

	close(reason: string): void {
		if (this.closed) return;
		this.closed = true;
		clearInterval(this.heartbeat);
		this.readiness.reject(new Error(reason));
		this.extension.close(reason);
		if (this.client?.readyState === WebSocket.OPEN) this.client.close(1000, reason);
		this.wss.close();
		this.http.close();
		this.onclose?.(reason);
	}

	private onExtensionEvent(method: string, params: unknown[]): void {
		switch (method) {
			case "chrome.debugger.onEvent": {
				const [source, cdpMethod, cdpParams] = params as [DebuggerSession, string, unknown];
				this.model.onDebuggerEvent(source, cdpMethod, cdpParams);
				break;
			}
			case "chrome.debugger.onDetach": {
				const [source] = params as [Debuggee, string];
				this.model.onDebuggerDetach(source);
				break;
			}
			case "chrome.tabs.onCreated": {
				const [tab] = params as [Tab];
				this.model.onTabCreated(tab);
				break;
			}
			case "chrome.tabs.onRemoved": {
				const [tabId] = params as [number];
				this.model.onTabRemoved(tabId);
				break;
			}
			case "extension.initialized":
				this.readiness.resolve();
				break;
		}
	}

	private acceptClient(ws: WebSocket): void {
		if (this.client) {
			ws.close(1000, "Another CDP client already connected");
			return;
		}
		this.client = ws;
		this.model.connectOverCDP((message) => {
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
		});
		ws.on("message", (data) => {
			void this.onClientMessage(data).catch(() => {});
		});
		ws.on("close", () => {
			this.client = null;
			// Playwright let go of the tab; the extension's socket stays for the next one.
		});
		ws.on("error", () => {});
	}

	private async onClientMessage(data: RawData): Promise<void> {
		const message = JSON.parse(data.toString()) as { id: number; sessionId?: string; method: string; params?: unknown };
		const { id, sessionId, method, params } = message;
		try {
			const result = await this.handle(method, params, sessionId);
			this.toClient({ id, sessionId, result });
		} catch (error) {
			this.toClient({ id, sessionId, error: { message: (error as Error).message } });
		}
	}

	private toClient(message: CDPMessage): void {
		if (this.client?.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(message));
	}

	private async handle(method: string, params: unknown, sessionId: string | undefined): Promise<unknown> {
		switch (method) {
			case "Browser.getVersion":
				return { protocolVersion: "1.3", product: "Chrome/Decks-Extension", userAgent: "Decks-Relay/1.0" };
			case "Browser.setDownloadBehavior":
				return {};
			case "Target.setAutoAttach":
				if (sessionId) break;
				await this.model.enableAutoAttach();
				return {};
			case "Target.createTarget":
				return this.model.createTarget((params as { url?: string } | undefined)?.url);
			case "Target.closeTarget":
				return this.model.closeTarget((params as { targetId?: string } | undefined)?.targetId);
			case "Target.getTargetInfo":
				return this.model.getTargetInfo(sessionId);
		}
		if (!sessionId) return this.model.sendBrowserCommand(method, params);
		return this.model.sendCommand(sessionId, method, params);
	}
}
