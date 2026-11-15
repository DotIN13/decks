import { ALLOWED_CHROME_COMMANDS, CHROME_EVENT_METHODS, log, REATTACH_COOLDOWN_MS, REATTACH_DELAY_MS, REATTACH_VERIFY_MS } from "./shared.js";

// The socket to the server, as Playwright's relayConnection.ts (Apache-2.0,
// Microsoft): five commands down, Chrome's events up, decks.ping answered.


export class RelayConnection {
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

