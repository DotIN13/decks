import { SharedGroup } from "./group.js";
import { RelayConnection } from "./relay.js";
import { isNonDebuggableUrl, RETRY_MS } from "./shared.js";

// The Decks extension: one tab of your own Chrome, shared with a deck. It
// keeps the server's address and a pairing code, and on Share this tab opens
// one outgoing socket to /api/web/relay?code=... Nothing here listens. The
// wire is Playwright's own extension's, so a stock Playwright drives the tab.

/** What the worker holds: the one connection, why the last one ended, and the retry. */
const state = { current: null, lastError: "", retryIndex: 0, retryTimer: undefined };

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
	state.lastError = "";
}

/** Share a tab: attach, connect, and remember that we want to. */
async function share(tabId) {
	const { address, code } = await settings();
	if (!address || !code) throw new Error("Not paired: enter the Decks address and code first");
	const tab = await chrome.tabs.get(tabId);
	if (isNonDebuggableUrl(tab.url)) throw new Error("Chrome does not let an extension work in this kind of tab");
	await chrome.storage.local.set({ sharing: { tabId } });
	clearTimeout(state.retryTimer);
	state.retryTimer = undefined;
	state.retryIndex = 0;
	await connect(tab, address, code);
}

async function connect(tab, address, code) {
	if (state.current) state.current.group.close("replaced");
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
	state.current = mine;
	state.lastError = "";
	group.onclose = () => {
		if (state.current !== mine) return;
		state.current = null;
		const reason = connection.closeReason;
		state.lastError = reason ? `Connection ended: ${reason}` : "";
		void afterClose(reason);
	};
}

/**
 * Come back on our own, unless the user or the deck said stop: a dropped socket
 * is reopened with a growing delay while the tab is still wanted shared.
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
	if (state.retryTimer !== undefined) return;
	const delay = RETRY_MS[Math.min(state.retryIndex, RETRY_MS.length - 1)];
	state.retryIndex++;
	state.retryTimer = setTimeout(() => {
		state.retryTimer = undefined;
		void resume();
	}, delay);
}

/** Reconnect the tab we still want shared, if it exists and nothing is connected. */
async function resume() {
	if (state.current) return;
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
		state.retryIndex = 0;
	} catch (error) {
		state.lastError = error.message;
		scheduleRetry();
	}
}

async function stop() {
	clearTimeout(state.retryTimer);
	state.retryTimer = undefined;
	await chrome.storage.local.set({ sharing: null });
	state.current?.group.close("stopped by you");
	state.current = null;
}

async function status() {
	const { address, code, sharing } = await settings();
	const tabs = [];
	if (state.current) {
		for (const tabId of state.current.connection.attachedTabs) {
			try {
				const tab = await chrome.tabs.get(tabId);
				tabs.push({ id: tabId, title: tab.title ?? "", url: tab.url ?? "" });
			} catch {
				/* closed since */
			}
		}
	}
	return { paired: Boolean(address && code), address, connected: Boolean(state.current) && tabs.length > 0, tabs, wanted: sharing?.tabId ?? null, error: state.lastError };
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
 * For the tests, which drive this worker from outside. share answers once the tab is
 * attached, a moment after the socket opens, when Playwright on the server asks.
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
