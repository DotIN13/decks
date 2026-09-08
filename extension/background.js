/**
 * The Decks extension: one tab of your own Chrome, shared with a deck.
 *
 * It does two things. It keeps the Decks server's address and a pairing code, which you
 * paste in once. And when you press "Share this tab", it attaches Chrome's debugger to that
 * tab, opens **one outgoing websocket** to the server (`/api/web/relay?code=…`), and relays:
 * five commands down — attach, detach, sendCommand, tabs.create, tabs.remove — and Chrome's
 * events back up. Nothing on this machine listens for connections; the server can be
 * anywhere your browser can reach, which is anywhere you can open Decks.
 *
 * The wire protocol is the one Playwright's own browser extension speaks, so that on the
 * server a stock Playwright can drive the tab. `RelayConnection` and `SharedGroup` below are
 * ports of `relayConnection.ts` and `connectedTabGroup.ts` from microsoft/playwright
 * (Apache-2.0, Copyright (c) Microsoft Corporation). The changes: the server is somebody you
 * paired with, not localhost; the address is stored rather than arriving on a connect page;
 * a `decks.ping` is answered so a quiet socket does not put this worker to sleep; and the
 * connection is re-opened by itself while you still want the tab shared.
 */

const GROUP_TITLE = "Decks";
const GROUP_COLOR = "blue";
const NON_DEBUGGABLE = ["chrome:", "edge:", "devtools:", "chrome-extension:"];
const CONNECTED_BADGE = { text: "✓", color: "#2f6fed", title: "Shared with Decks" };
const RETRY_MS = [2000, 4000, 8000, 15000, 30000];

const ALLOWED_CHROME_COMMANDS = new Set([
	"chrome.debugger.attach",
	"chrome.debugger.detach",
	"chrome.debugger.sendCommand",
	"chrome.tabs.create",
	"chrome.tabs.remove",
]);
const CHROME_EVENT_METHODS = ["chrome.debugger.onEvent", "chrome.debugger.onDetach", "chrome.tabs.onCreated", "chrome.tabs.onRemoved"];

const REATTACH_DELAY_MS = 150;
const REATTACH_VERIFY_MS = 2500;
const REATTACH_COOLDOWN_MS = 3000;

function log(...args) {
	console.log("[decks]", ...args);
}

function isNonDebuggableUrl(url) {
	return !!url && NON_DEBUGGABLE.some((scheme) => url.startsWith(scheme));
}

// --- the socket ------------------------------------------------------------------

class RelayConnection {
	constructor(ws) {
		this._ws = ws;
		this._attachedTabs = new Set();
		this._hasEverAttached = false;
		this._eventListeners = [];
		this._closed = false;
		this._pendingReattach = new Set();
		this._recentReattach = new Set();
		this.onclose = undefined;
		this.ontabattached = undefined;
		this.ontabdetached = undefined;
		this.closeReason = "";
		this._installEventForwarders();
		this._ws.onmessage = (event) => this._onMessage(event);
		this._ws.onclose = (event) => {
			this.closeReason = event.reason || this.closeReason;
			this._onClose();
		};
	}

	get attachedTabs() {
		return this._attachedTabs;
	}

	didInitialize() {
		this._send({ method: "extension.initialized", params: [] });
	}

	close(reason) {
		this.closeReason = reason;
		this._ws.close(1000, reason);
		this._onClose();
	}

	attachTab(tab) {
		if (this._closed || this._attachedTabs.has(tab.id)) return;
		this._send({ method: "chrome.tabs.onCreated", params: [tab] });
	}

	detachTab(tabId) {
		if (this._closed || !this._attachedTabs.has(tabId)) return;
		chrome.debugger.detach({ tabId }).catch((error) => log("detach:", error));
		this._notifyTabDetached(tabId);
		this._send({ method: "chrome.debugger.onDetach", params: [{ tabId }, "target_closed"] });
		this._checkLastTabDetached();
	}

	_notifyTabAttached(tabId) {
		this._attachedTabs.add(tabId);
		this._hasEverAttached = true;
		this._pendingReattach.delete(tabId);
		this.ontabattached?.(tabId);
	}

	_notifyTabDetached(tabId) {
		this._attachedTabs.delete(tabId);
		this.ontabdetached?.(tabId);
	}

	_installEventForwarders() {
		for (const fullMethod of CHROME_EVENT_METHODS) {
			const target = resolveChromeMember(fullMethod);
			const listener = (...args) => this._onChromeEvent(fullMethod, args);
			target.obj[target.name].addListener(listener);
			this._eventListeners.push({ remove: () => target.obj[target.name].removeListener(listener) });
		}
	}

	_onClose() {
		if (this._closed) return;
		this._closed = true;
		this._pendingReattach.clear();
		this._recentReattach.clear();
		for (const listener of this._eventListeners) listener.remove();
		this._eventListeners = [];
		for (const tabId of [...this._attachedTabs]) {
			chrome.debugger.detach({ tabId }).catch(() => {});
			this._notifyTabDetached(tabId);
		}
		this.onclose?.();
	}

	_checkLastTabDetached() {
		if (this._hasEverAttached && this._attachedTabs.size === 0 && this._pendingReattach.size === 0) this.close("All shared tabs detached");
	}

	_onChromeEvent(fullMethod, args) {
		const tabId = this._tabIdForEventArgs(fullMethod, args);
		if (tabId === undefined || !this._attachedTabs.has(tabId)) return;
		this._send({ method: fullMethod, params: args });
		if (fullMethod === "chrome.debugger.onDetach") {
			const reason = args[1];
			this._notifyTabDetached(tabId);
			if (reason === "target_closed" && this._maybeScheduleReattach(tabId)) return;
			this._checkLastTabDetached();
		}
	}

	_maybeScheduleReattach(tabId) {
		if (this._closed) return false;
		if (this._recentReattach.has(tabId)) return false;
		this._recentReattach.add(tabId);
		setTimeout(() => this._recentReattach.delete(tabId), REATTACH_COOLDOWN_MS);
		this._pendingReattach.add(tabId);
		setTimeout(() => void this._tryReattach(tabId), REATTACH_DELAY_MS);
		return true;
	}

	_reattachAborted(tabId) {
		return this._closed || !this._pendingReattach.has(tabId);
	}

	async _tryReattach(tabId) {
		if (this._reattachAborted(tabId)) return;
		let tab;
		try {
			tab = await chrome.tabs.get(tabId);
		} catch {
			this._pendingReattach.delete(tabId);
			this._checkLastTabDetached();
			return;
		}
		if (this._reattachAborted(tabId)) return;
		if (this._attachedTabs.has(tabId)) {
			this._pendingReattach.delete(tabId);
			return;
		}
		this.attachTab(tab);
		setTimeout(() => {
			if (this._reattachAborted(tabId)) return;
			this._pendingReattach.delete(tabId);
			if (!this._attachedTabs.has(tabId)) this._checkLastTabDetached();
		}, REATTACH_VERIFY_MS);
	}

	_tabIdForEventArgs(fullMethod, args) {
		switch (fullMethod) {
			case "chrome.debugger.onEvent":
			case "chrome.debugger.onDetach":
				return args[0]?.tabId;
			case "chrome.tabs.onCreated":
				return args[0]?.openerTabId;
			case "chrome.tabs.onRemoved":
				return args[0];
		}
		return undefined;
	}

	_onMessage(event) {
		this._onMessageAsync(event).catch((error) => log("message:", error));
	}

	async _onMessageAsync(event) {
		let message;
		try {
			message = JSON.parse(event.data);
		} catch (error) {
			this._send({ error: { code: -32700, message: `Error parsing message: ${error.message}` } });
			return;
		}
		const response = { id: message.id };
		try {
			response.result = await this._handleCommand(message);
		} catch (error) {
			response.error = error.message;
		}
		this._send(response);
	}

	async _handleCommand(message) {
		// The server's heartbeat: answered, which is what keeps this worker awake.
		if (message.method === "decks.ping") return {};
		if (!ALLOWED_CHROME_COMMANDS.has(message.method)) throw new Error(`Unknown method: ${message.method}`);
		const args = message.params ?? [];
		const result = await invokeChromeMethod(message.method, args);
		if (message.method === "chrome.debugger.attach") {
			const target = args[0];
			if (target?.tabId !== undefined) this._notifyTabAttached(target.tabId);
		}
		return result ?? {};
	}

	_send(message) {
		if (this._ws.readyState === WebSocket.OPEN) this._ws.send(JSON.stringify(message));
	}
}

function resolveChromeMember(fullMethod) {
	const parts = fullMethod.split(".");
	if (parts[0] !== "chrome" || parts.length < 3) throw new Error(`Invalid chrome method: ${fullMethod}`);
	let obj = chrome;
	for (let i = 1; i < parts.length - 1; i++) {
		obj = obj?.[parts[i]];
		if (obj === undefined) throw new Error(`Unknown chrome path: ${parts.slice(0, i + 1).join(".")}`);
	}
	return { obj, name: parts[parts.length - 1] };
}

async function invokeChromeMethod(fullMethod, args) {
	const { obj, name } = resolveChromeMember(fullMethod);
	const fn = obj[name];
	if (typeof fn !== "function") throw new Error(`Not a function: ${fullMethod}`);
	return await fn.apply(obj, args);
}

// --- the tab group -------------------------------------------------------------------

/**
 * The "Decks" tab group is the truth about which tabs are shared: drag a tab in and it is
 * attached, drag it out and it is let go. The tab you pressed the button on goes in first.
 */
class SharedGroup {
	constructor(connection, selectedTab) {
		this._connection = connection;
		this._groupId = null;
		this._groupTabIds = new Set();
		this.onclose = undefined;
		this._connection.onclose = () => this._onConnectionClose();
		this._connection.ontabattached = (tabId) => this._onTabAttached(tabId);
		this._connection.ontabdetached = (tabId) => this._onTabDetached(tabId);
		this._onTabUpdatedListener = (tabId, changeInfo, tab) => this._onTabUpdated(tabId, changeInfo, tab);
		this._onTabRemovedListener = (tabId) => this._groupTabIds.delete(tabId);
		chrome.tabs.onUpdated.addListener(this._onTabUpdatedListener);
		chrome.tabs.onRemoved.addListener(this._onTabRemovedListener);
		this._connection.attachTab(selectedTab);
		this._connection.didInitialize();
	}

	connectedTabIds() {
		return [...this._groupTabIds];
	}

	close(reason) {
		this._connection.close(reason);
	}

	_onTabUpdated(tabId, changeInfo, tab) {
		if (changeInfo.groupId !== undefined) this._onTabGroupChanged(tabId, tab);
		if (changeInfo.url === undefined) return;
		if (this._connection.attachedTabs.has(tabId)) void updateBadge(tabId, CONNECTED_BADGE);
		else if (this._groupTabIds.has(tabId) && !isNonDebuggableUrl(changeInfo.url)) this._connection.attachTab(tab);
	}

	_onTabGroupChanged(tabId, tab) {
		const inOurGroup = this._groupId !== null && tab.groupId === this._groupId;
		const wasInGroup = this._groupTabIds.has(tabId);
		if (inOurGroup === wasInGroup) return;
		if (inOurGroup) {
			this._groupTabIds.add(tabId);
			if (!isNonDebuggableUrl(tab.url)) this._connection.attachTab(tab);
		} else {
			this._groupTabIds.delete(tabId);
			if (this._connection.attachedTabs.has(tabId)) this._connection.detachTab(tabId);
		}
	}

	_onTabAttached(tabId) {
		void updateBadge(tabId, CONNECTED_BADGE);
		void this._addTabToGroup(tabId);
	}

	_onTabDetached(tabId) {
		void updateBadge(tabId, { text: "" });
	}

	_onConnectionClose() {
		chrome.tabs.onUpdated.removeListener(this._onTabUpdatedListener);
		chrome.tabs.onRemoved.removeListener(this._onTabRemovedListener);
		const groupTabs = [...this._groupTabIds];
		this._groupTabIds.clear();
		if (groupTabs.length) void ungroupTabs(groupTabs);
		this.onclose?.();
	}

	async _addTabToGroup(tabId) {
		if (this._groupTabIds.has(tabId)) return;
		try {
			await retryOnDrag(async () => {
				if (this._groupId === null) {
					this._groupId = await chrome.tabs.group({ tabIds: [tabId] });
					await chrome.tabGroups.update(this._groupId, { title: GROUP_TITLE, color: GROUP_COLOR });
				} else {
					await chrome.tabs.group({ groupId: this._groupId, tabIds: [tabId] });
				}
			});
			this._groupTabIds.add(tabId);
		} catch (error) {
			log("group:", error);
		}
	}
}

async function updateBadge(tabId, { text, color, title }) {
	try {
		await Promise.all([
			chrome.action.setBadgeText({ tabId, text }),
			chrome.action.setTitle({ tabId, title: title || "Decks" }),
			color ? chrome.action.setBadgeBackgroundColor({ tabId, color }) : Promise.resolve(),
		]);
	} catch {
		/* the tab may be gone */
	}
}

async function ungroupTabs(tabIds) {
	try {
		await retryOnDrag(() => chrome.tabs.ungroup(tabIds));
	} catch (error) {
		log("ungroup:", error);
	}
}

async function retryOnDrag(fn) {
	const delays = [0, 100, 200, 400, 800];
	let lastError;
	for (const delay of delays) {
		if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
		try {
			await fn();
			return;
		} catch (error) {
			if (!error?.message?.includes("user may be dragging a tab")) throw error;
			lastError = error;
		}
	}
	throw lastError;
}

// --- pairing, sharing, and coming back ------------------------------------------------

/** The one connection, while there is one. */
let current = null;
/** Why the last one ended, for the popup. */
let lastError = "";
let retryIndex = 0;
let retryTimer = undefined;

async function settings() {
	const stored = await chrome.storage.local.get(["address", "code", "sharing"]);
	return { address: stored.address ?? "", code: stored.code ?? "", sharing: stored.sharing ?? null };
}

function relayUrl(address, code) {
	const url = new URL(address);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = "/api/web/relay";
	url.search = `?code=${encodeURIComponent(code)}`;
	url.hash = "";
	return url.toString();
}

async function pair(address, code) {
	const trimmed = String(address ?? "").trim();
	if (!/^https?:\/\//.test(trimmed)) throw new Error("The address should start with http:// or https://");
	new URL(trimmed);
	if (!String(code ?? "").trim()) throw new Error("The pairing code is empty");
	await chrome.storage.local.set({ address: trimmed.replace(/\/+$/, ""), code: String(code).trim() });
	lastError = "";
}

/** Share a tab: attach, connect, and remember that we want to. */
async function share(tabId) {
	const { address, code } = await settings();
	if (!address || !code) throw new Error("Not paired: enter the Decks address and code first");
	const tab = await chrome.tabs.get(tabId);
	if (isNonDebuggableUrl(tab.url)) throw new Error("Chrome does not let an extension work in this kind of tab");
	await chrome.storage.local.set({ sharing: { tabId } });
	clearTimeout(retryTimer);
	retryTimer = undefined;
	retryIndex = 0;
	await connect(tab, address, code);
}

async function connect(tab, address, code) {
	if (current) current.group.close("replaced");
	const ws = new WebSocket(relayUrl(address, code));
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("The Decks server did not answer in 8 seconds")), 8000);
		ws.onopen = () => {
			clearTimeout(timer);
			resolve();
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error("Could not connect to the Decks server (wrong address, wrong code, or it is down)"));
		};
	});
	const connection = new RelayConnection(ws);
	const group = new SharedGroup(connection, tab);
	const mine = { connection, group, tabId: tab.id };
	current = mine;
	lastError = "";
	group.onclose = () => {
		if (current !== mine) return;
		current = null;
		const reason = connection.closeReason;
		lastError = reason ? `Connection ended: ${reason}` : "";
		void afterClose(reason);
	};
}

/**
 * Come back on our own, unless the user or the deck said stop.
 *
 * A server restart or a laptop lid closing drops the socket; the intent to share is in
 * storage and the tab is still there, so the connection is reopened with a growing delay.
 */
async function afterClose(reason) {
	const deliberate = /stopped|replaced|detached/i.test(reason ?? "");
	if (deliberate) {
		await chrome.storage.local.set({ sharing: null });
		return;
	}
	scheduleRetry();
}

function scheduleRetry() {
	if (retryTimer !== undefined) return;
	const delay = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)];
	retryIndex++;
	retryTimer = setTimeout(() => {
		retryTimer = undefined;
		void resume();
	}, delay);
}

/** Reconnect the tab we still want shared, if it exists and nothing is connected. */
async function resume() {
	if (current) return;
	const { address, code, sharing } = await settings();
	if (!address || !code || !sharing?.tabId) return;
	let tab;
	try {
		tab = await chrome.tabs.get(sharing.tabId);
	} catch {
		await chrome.storage.local.set({ sharing: null });
		return;
	}
	try {
		await connect(tab, address, code);
		retryIndex = 0;
	} catch (error) {
		lastError = error.message;
		scheduleRetry();
	}
}

async function stop() {
	clearTimeout(retryTimer);
	retryTimer = undefined;
	await chrome.storage.local.set({ sharing: null });
	current?.group.close("stopped by you");
	current = null;
}

async function status() {
	const { address, code, sharing } = await settings();
	const tabs = [];
	if (current) {
		for (const tabId of current.connection.attachedTabs) {
			try {
				const tab = await chrome.tabs.get(tabId);
				tabs.push({ id: tabId, title: tab.title ?? "", url: tab.url ?? "" });
			} catch {
				/* closed since */
			}
		}
	}
	return { paired: Boolean(address && code), address, connected: Boolean(current) && tabs.length > 0, tabs, wanted: sharing?.tabId ?? null, error: lastError };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	const run = async () => {
		switch (message?.type) {
			case "status":
				return status();
			case "pair":
				await pair(message.address, message.code);
				return status();
			case "share":
				await share(message.tabId);
				return status();
			case "stop":
				await stop();
				return status();
			default:
				throw new Error(`Unknown message: ${message?.type}`);
		}
	};
	run().then(
		(result) => sendResponse({ ok: true, result }),
		(error) => sendResponse({ ok: false, error: error.message }),
	);
	return true;
});

// Every half minute: if a tab should be shared and is not, try again. It is also what
// brings the connection back after this worker was put to sleep and woken.
chrome.alarms.create("decks-resume", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === "decks-resume") void resume();
});
void resume();

/**
 * For the tests, which drive this worker from outside.
 *
 * `share` answers with the status once the tab is attached: the relay asks for the attach
 * only after Playwright has connected on the server, a moment after the socket opens.
 */
globalThis.__decks = {
	pair: async (address, code) => {
		await pair(address, code);
		return status();
	},
	share: async (tabId) => {
		await share(tabId);
		const deadline = Date.now() + 8000;
		while (Date.now() < deadline) {
			const now = await status();
			if (now.connected) return now;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return status();
	},
	stop: async () => {
		await stop();
		return status();
	},
	status,
	resume,
};
