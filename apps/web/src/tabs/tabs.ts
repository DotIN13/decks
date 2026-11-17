import type { StageRow } from "@decks/protocol";
import { createSignal } from "solid-js";
import { stageOf, stages } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import type { Tab } from "./kind.ts";

/**
 * The row of tabs: what is open in this window, and which is in front.
 *
 * The first is home, a canvas tab that follows the conversation: it shows the canvas of the agent
 * the person talks to, and changes when they pick another. It is always there. Every question the
 * page has about "the canvas on screen" is asked here (`canvasOnScreen`), where it used to ask the
 * conversation, so a tab in front that is another canvas, or no canvas at all, is one answer away.
 */
const HOME: Tab = { id: "home", kind: "canvas" };

const [tabs] = createSignal<Tab[]>([HOME]);
const [frontId] = createSignal(HOME.id);

/** The tab in front: what the window shows. */
export const front = (): Tab => tabs().find((tab) => tab.id === frontId()) ?? HOME;

/** The canvas a tab shows, when it is a canvas tab: the conversation's for home, its own otherwise. */
function canvasOf(tab: Tab): StageRow | undefined {
	if (tab.kind !== "canvas") return undefined;
	return tab.target === undefined ? stageOf(state.focused) : stages().find((one) => one.name === tab.target);
}

/** The canvas on screen: the one the tab in front shows, or none while a tab of another kind is in front. */
export const canvasOnScreen = (): StageRow | undefined => canvasOf(front());
