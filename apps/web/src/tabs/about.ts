import { createSignal } from "solid-js";
import { kindOf } from "./kinds.ts";
import { front } from "./tabs.ts";

/**
 * What a message says of the tab it was written on.
 *
 * The composer talks to the agent of the conversation on screen whichever tab is in front, and an
 * agent has no canvas of its own to take "here" for: its calls name the canvas they work on. So the
 * message says where the person was: one line in front of the words, in the agent's text only,
 * naming what they were looking at as its kind names it (`TabKind.says`), a canvas by the name a
 * call can use. The composer shows that it will, as a chip with the tab's name, and a press on the
 * chip leaves it out for that tab.
 */
const [left, setLeft] = createSignal<readonly string[]>([]);

/** The tab a message would name now: the one in front, when there is something on it. With whether the person left it out. */
export function aboutTab(): { id: string; name: string; on: boolean } | undefined {
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

/** The line a message written now carries in front of its words, for the agent: none when left out, or on a chat with no canvas. */
export function aboutLine(): string | undefined {
	const about = aboutTab();
	if (!about?.on) return undefined;
	const tab = front();
	return `[The person wrote this while looking at ${kindOf(tab.kind)!.says(tab)}.]`;
}
