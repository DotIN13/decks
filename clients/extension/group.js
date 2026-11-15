import { CONNECTED_BADGE, GROUP_COLOR, GROUP_TITLE, isNonDebuggableUrl, log } from "./shared.js";

// The shared tabs, as Playwright's connectedTabGroup.ts (Apache-2.0,
// Microsoft): a blue Decks tab group; a tab dragged in is shared, out is not.

/**
 * The "Decks" tab group is the truth about which tabs are shared: drag a tab in and it is
 * attached, drag it out and it is let go. The tab you pressed the button on goes in first.
 */
export class SharedGroup {
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

/** @param {number} tabId @param {{ text: string, color?: string, title?: string }} badge */
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

