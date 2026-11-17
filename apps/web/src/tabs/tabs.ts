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
/** The canvas tab that was in front last: what the canvas's frame goes on holding while a tab of another kind is in front. */
const [lastCanvasId, setLastCanvasId] = createSignal(HOME.id);
/** Bring a tab forward, by its name in the row. */
const bring = (id: string): void => {
	setFrontId(id);
	if (opened().find((tab) => tab.id === id)?.kind === "canvas") setLastCanvasId(id);
};

/** The canvas a tab shows, when it is a canvas tab: the conversation's for home, its own otherwise. */
function canvasOf(tab: Tab): StageRow | undefined {
	if (tab.kind !== "canvas") return undefined;
	return tab.target === undefined ? stageOf(state.focused) : stages().find((one) => one.name === tab.target);
}

/** The tabs open in this window, home first. A canvas tab whose canvas is gone (deleted, or renamed away) is not one of them. */
export const tabs = (): Tab[] => opened().filter((tab) => tab.kind !== "canvas" || tab.target === undefined || stages().length === 0 || canvasOf(tab) !== undefined);

/** The tab in front: what the window shows. */
export const front = (): Tab => tabs().find((tab) => tab.id === frontId()) ?? HOME;

/** Whether home is the tab in front: the home chip is the one washed, and a press on it opens the canvas list. */
export const homeInFront = (): boolean => front().id === HOME.id;

/**
 * The canvas tab on screen: the one in front, or, while a tab of another kind is in front, the canvas
 * tab that was in front last. Its canvas is still held behind the tab in front, as it was, and it is
 * what the side panel lists and the composer talks about until another canvas comes forward.
 */
const canvasTab = (): Tab => (front().kind === "canvas" ? front() : (tabs().find((tab) => tab.id === lastCanvasId()) ?? HOME));

/** Whether that canvas tab is home: the canvas on screen is the conversation's own, and its camera the conversation's. */
export const homeHeld = (): boolean => canvasTab().id === HOME.id;

/** The canvas of the conversation on screen, which the home tab shows whether or not it is in front. */
export const homeCanvas = (): StageRow | undefined => canvasOf(HOME);

/** The canvas on screen: the one the canvas tab on screen shows (`canvasTab`). */
export const canvasOnScreen = (): StageRow | undefined => canvasOf(canvasTab());

/**
 * Open a tab on a target and bring it forward, or bring forward the one already open on it. A canvas
 * the home tab is showing is home: one canvas is not in the row twice by accident. No agent moves.
 */
export function openTab(kind: string, target: string): void {
	if (kind === "canvas" && homeCanvas()?.name === target) return bring(HOME.id);
	const id = `${kind}:${target}`;
	if (!opened().some((tab) => tab.id === id)) setOpened((all) => [...all, { id, kind, target }]);
	bring(id);
}

/**
 * Put back a row as it was left (`remember.ts`): the tabs after home, in their order, and the one that
 * was in front, or home when that one is not among them. What was open before is let go.
 */
export function restoreTabs(row: ReadonlyArray<{ kind: string; target: string }>, frontId?: string): void {
	const kept = row.map((one) => ({ id: `${one.kind}:${one.target}`, kind: one.kind, target: one.target }));
	setOpened([HOME, ...kept.filter((tab, at) => kept.findIndex((other) => other.id === tab.id) === at)]);
	setLastCanvasId(HOME.id);
	bring(kept.some((tab) => tab.id === frontId) ? frontId! : HOME.id);
}

/** Bring a tab forward. */
export const showTab = (id: string): void => bring(id);

/** Close a tab; the one before it comes forward when it was in front. Home is never closed. */
export function closeTab(id: string): void {
	if (id === HOME.id) return;
	const all = tabs();
	const at = all.findIndex((tab) => tab.id === id);
	if (at < 0) return;
	setOpened((was) => was.filter((tab) => tab.id !== id));
	if (frontId() === id) bring((all[at - 1] ?? HOME).id);
}
