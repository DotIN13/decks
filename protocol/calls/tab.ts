import { defineCall } from "../call.ts";
import { bool, opt, str } from "../schema.ts";
import { Pairing, Screenshot, Tab, TabPage, TabTarget } from "../shapes.ts";
import { PEOPLE, PERSON } from "./parts.ts";

// The person's shared Chrome tab, through the Decks extension. An action
// answers the tab as it now is. Never passwords or codes.

export const status = defineCall({ name: "tab.status", summary: "Whether a tab is shared, and which.", who: PEOPLE, args: {}, answer: Tab, effect: "read" });

export const pair = defineCall({
	name: "tab.pair",
	summary: "A code to pair the Decks extension; fresh: true makes a new one and drops the old pairing.",
	who: PEOPLE,
	args: { fresh: opt(bool()) },
	answer: Pairing,
	effect: "change",
});

export const open = defineCall({ name: "tab.open", summary: "Go to an address in the shared tab.", who: PEOPLE, args: { url: str() }, answer: Tab, effect: "change" });
export const read = defineCall({ name: "tab.read", summary: "The page as a tree of fields and buttons, each with a ref that dies when the tab navigates.", who: PEOPLE, args: {}, answer: TabPage, effect: "read" });

export const screenshot = defineCall({ name: "tab.screenshot", summary: "A picture of the tab; full for the whole page.", who: PEOPLE, args: { full: opt(bool()) }, answer: Screenshot, effect: "read" });

export const fill = defineCall({ name: "tab.fill", summary: "Type into a field.", who: PEOPLE, args: { field: TabTarget, text: str() }, answer: Tab, effect: "change" });
export const select = defineCall({ name: "tab.select", summary: "Choose an option in a select.", who: PEOPLE, args: { field: TabTarget, option: str() }, answer: Tab, effect: "change" });
export const click = defineCall({ name: "tab.click", summary: "Click a button or link.", who: PEOPLE, args: { target: TabTarget }, answer: Tab, effect: "change" });
export const press = defineCall({ name: "tab.press", summary: "Press a key.", who: PEOPLE, args: { key: str() }, answer: Tab, effect: "change" });

export const submit = defineCall({
	name: "tab.submit",
	summary: "Submit a form, asking the person first unless ask is false; pending on the tab says it waits for them.",
	who: PEOPLE,
	args: { target: opt(TabTarget), ask: opt(bool()) },
	answer: Tab,
	effect: "change",
});

export const answer = defineCall({ name: "tab.answer", summary: "The person's yes or no to the tab's question.", who: PERSON, args: { id: str(), ok: bool() }, answer: Tab, effect: "change" });
export const stop = defineCall({ name: "tab.stop", summary: "Stop sharing the tab.", who: PEOPLE, args: {}, answer: Tab, effect: "change" });
