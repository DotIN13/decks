// What the parts share: the group's look, the tabs Chrome will not let an
// extension debug, the commands the server may send, and the delays.

export const GROUP_TITLE = "Decks";
export const GROUP_COLOR = "blue";
export const NON_DEBUGGABLE = ["chrome:", "edge:", "devtools:", "chrome-extension:"];
export const CONNECTED_BADGE = { text: "✓", color: "#2f6fed", title: "Shared with Decks" };
export const RETRY_MS = [2000, 4000, 8000, 15000, 30000];

export const ALLOWED_CHROME_COMMANDS = new Set([
	"chrome.debugger.attach",
	"chrome.debugger.detach",
	"chrome.debugger.sendCommand",
	"chrome.tabs.create",
	"chrome.tabs.remove",
]);
export const CHROME_EVENT_METHODS = ["chrome.debugger.onEvent", "chrome.debugger.onDetach", "chrome.tabs.onCreated", "chrome.tabs.onRemoved"];

export const REATTACH_DELAY_MS = 150;
export const REATTACH_VERIFY_MS = 2500;
export const REATTACH_COOLDOWN_MS = 3000;

export function log(...args) {
	console.log("[decks]", ...args);
}

export function isNonDebuggableUrl(url) {
	return !!url && NON_DEBUGGABLE.some((scheme) => url.startsWith(scheme));
}
