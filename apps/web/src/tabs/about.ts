import { createSignal } from "solid-js";
import { kindOf } from "./kinds.ts";
import { front, homeInFront } from "./tabs.ts";

/**
 * What a message says of the tab it was written on.
 *
 * The composer talks to the agent of the conversation on screen whichever tab is in front. On home
 * that agent knows where the person is: its own canvas. On any other tab it does not, so the
 * message says it: one line in front of the words, in the agent's text only, naming what the person
 * was looking at as its kind names it (`TabKind.says`). The composer shows that it will, as a chip
 * with the tab's name, and a press on the chip leaves it out for that tab.
 */
const [left, setLeft] = createSignal<readonly string[]>([]);

/** The tab a message would name now: the one in front, unless it is home. With whether the person left it out. */
export function aboutTab(): { id: string; name: string; on: boolean } | undefined {
	if (homeInFront()) return undefined;
	const tab = front();
	const kind = kindOf(tab.kind);
	if (!kind?.says(tab)) return undefined;
	return { id: tab.id, name: kind.title(tab) ?? tab.target ?? "", on: !left().includes(tab.id) };
}

/** Leave the tab in front out of the messages written on it, or put it back. */
export function toggleAbout(): void {
	const id = front().id;
	setLeft((was) => (was.includes(id) ? was.filter((one) => one !== id) : [...was, id]));
}

/** The line a message written now carries in front of its words, for the agent: none on home, or when left out. */
export function aboutLine(): string | undefined {
	const about = aboutTab();
	if (!about?.on) return undefined;
	const tab = front();
	return `[The person wrote this while looking at ${kindOf(tab.kind)!.says(tab)}, open in a tab of their window.]`;
}
