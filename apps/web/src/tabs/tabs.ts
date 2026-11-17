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

const [opened, setOpened] = createSignal<Tab[]>([HOME]);
const [frontId, setFrontId] = createSignal(HOME.id);

/** The canvas a tab shows, when it is a canvas tab: the conversation's for home, its own otherwise. */
function canvasOf(tab: Tab): StageRow | undefined {
	if (tab.kind !== "canvas") return undefined;
	return tab.target === undefined ? stageOf(state.focused) : stages().find((one) => one.name === tab.target);
}

/** The tabs open in this window, home first. A canvas tab whose canvas is gone (deleted, or renamed away) is not one of them. */
export const tabs = (): Tab[] => opened().filter((tab) => tab.kind !== "canvas" || tab.target === undefined || stages().length === 0 || canvasOf(tab) !== undefined);

/** The tab in front: what the window shows. */
export const front = (): Tab => tabs().find((tab) => tab.id === frontId()) ?? HOME;

/** Whether home is the tab in front: the conversation's own canvas is what the window shows. */
export const homeInFront = (): boolean => front().id === HOME.id;

/** The canvas of the conversation on screen, which the home tab shows whether or not it is in front. */
export const homeCanvas = (): StageRow | undefined => canvasOf(HOME);

/** The canvas on screen: the one the tab in front shows, or none while a tab of another kind is in front. */
export const canvasOnScreen = (): StageRow | undefined => canvasOf(front());

/**
 * Open a tab on a target and bring it forward, or bring forward the one already open on it. A canvas
 * the home tab is showing is home: one canvas is not in the row twice by accident. No agent moves.
 */
export function openTab(kind: string, target: string): void {
	if (kind === "canvas" && homeCanvas()?.name === target) return void setFrontId(HOME.id);
	const id = `${kind}:${target}`;
	if (!opened().some((tab) => tab.id === id)) setOpened((all) => [...all, { id, kind, target }]);
	setFrontId(id);
}

/** Bring a tab forward. */
export const showTab = (id: string): void => void setFrontId(id);

/** Close a tab; the one before it comes forward when it was in front. Home is never closed. */
export function closeTab(id: string): void {
	if (id === HOME.id) return;
	const all = tabs();
	const at = all.findIndex((tab) => tab.id === id);
	if (at < 0) return;
	setOpened((was) => was.filter((tab) => tab.id !== id));
	if (frontId() === id) setFrontId((all[at - 1] ?? HOME).id);
}
