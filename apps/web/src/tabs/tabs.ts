import type { StageRow } from "@decks/protocol";
import { createSignal } from "solid-js";
import { stageOf, stages } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import type { Tab } from "./kind.ts";

/**
 * The row of tabs: what is open in this window, and which one each conversation's camera is on.
 *
 * The row is the window's: the same tabs whoever you talk to. Which one is in front is the
 * conversation's: each agent has a camera, and it is on one tab, a canvas, a card, a document or an
 * app. Opening an agent's chat brings the tab its camera is on forward, where it was left; picking a
 * tab puts the camera of the conversation on screen there. On a canvas the camera also has a place,
 * kept per agent and canvas (`app/landing.ts`), so a canvas come back to is where it was left.
 *
 * The first tab is home, a canvas tab that follows the conversation: it shows the canvas the agent
 * works on, and is where every camera starts. It is always there. Every question the page has about
 * "the canvas on screen" is asked here (`canvasOnScreen`), where it used to ask the conversation, so
 * a tab in front that is another canvas, or no canvas at all, is one answer away.
 */
const HOME: Tab = { id: "home", kind: "canvas" };

const [opened, setOpened] = createSignal<Tab[]>([HOME]);
/** The tab each conversation's camera is on, by agent id; one with none kept is on home. */
const [cameraTabs, setCameraTabs] = createSignal<Readonly<Record<string, string>>>({});
/** For each conversation, the canvas tab its camera was last on: what the canvas's frame goes on holding while its camera is on a tab of another kind. */
const [canvasTabs, setCanvasTabs] = createSignal<Readonly<Record<string, string>>>({});
/** The tabs in the order they were last in front, the latest first: what a kind that keeps tabs alive behind the front one goes by (`alive`). */
const [shown, setShown] = createSignal<readonly string[]>([HOME.id]);
/** The conversation on screen, whose camera a press on a tab moves. */
const who = (): string => state.focused ?? "";
/** Put a conversation's camera on a tab, by its name in the row: the one on screen's by default, which brings the tab forward. */
const bring = (id: string, agent: string = who()): void => {
	setCameraTabs((was) => ({ ...was, [agent]: id }));
	if (opened().find((tab) => tab.id === id)?.kind === "canvas") setCanvasTabs((was) => ({ ...was, [agent]: id }));
};

/** The tab in front was seen: by a press on it, or by opening the chat of an agent whose camera is on it (`TabView.tsx`). */
export const sawFront = (id: string): void => {
	if (shown()[0] !== id) setShown((was) => [id, ...was.filter((one) => one !== id)].slice(0, 64));
};

/** The canvas a tab shows, when it is a canvas tab: the conversation's for home, its own otherwise. */
function canvasOf(tab: Tab): StageRow | undefined {
	if (tab.kind !== "canvas") return undefined;
	return tab.target === undefined ? stageOf(state.focused) : stages().find((one) => one.name === tab.target);
}

/** The tabs open in this window, home first. A canvas tab whose canvas is gone (deleted, or renamed away) is not one of them. */
export const tabs = (): Tab[] => opened().filter((tab) => tab.kind !== "canvas" || tab.target === undefined || stages().length === 0 || canvasOf(tab) !== undefined);

/** The tab in front: the one the camera of the conversation on screen is on, which is what the window shows. */
export const front = (): Tab => tabs().find((tab) => tab.id === cameraTabs()[who()]) ?? HOME;

/** Whether home is the tab in front: the home chip is the one washed, and a press on it opens the canvas list. */
export const homeInFront = (): boolean => front().id === HOME.id;

/**
 * The canvas tab on screen: the one in front, or, while a tab of another kind is in front, the canvas
 * tab that was in front last. Its canvas is still held behind the tab in front, as it was, and it is
 * what the side panel lists and the composer talks about until another canvas comes forward.
 */
const canvasTab = (): Tab => (front().kind === "canvas" ? front() : (tabs().find((tab) => tab.id === canvasTabs()[who()]) ?? HOME));

/** Whether that canvas tab is home: the canvas on screen is the conversation's own, and its camera the conversation's. */
export const homeHeld = (): boolean => canvasTab().id === HOME.id;

/** The canvas of the conversation on screen, which the home tab shows whether or not it is in front. */
export const homeCanvas = (): StageRow | undefined => canvasOf(HOME);

/** The canvas on screen: the one the canvas tab on screen shows (`canvasTab`). */
export const canvasOnScreen = (): StageRow | undefined => canvasOf(canvasTab());

/**
 * The tabs of a kind that are alive now: the one in front, and the `behind` that were in front most
 * lately. A kind whose tabs go on running behind the front one (an app) keeps these and puts the
 * rest away, so a device holds only as many as it has memory for (`budget.ts`). A tab put back by
 * `restoreTabs` and not shown since is not among them: a row of apps does not all start at once.
 */
export function alive(kind: string, behind: number): Tab[] {
	const order = shown();
	const of = tabs().filter((tab) => tab.kind === kind && order.includes(tab.id));
	const rank = (tab: Tab) => (tab.id === front().id ? -1 : order.indexOf(tab.id));
	const kept = [...of].sort((a, b) => rank(a) - rank(b)).slice(0, (front().kind === kind ? 1 : 0) + behind);
	// In the row's order, so a tab's place among them does not change as others come and go.
	return of.filter((tab) => kept.includes(tab));
}

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
 * Put back a row as it was left (`remember.ts`): the tabs after home, in their order, and the tab
 * each conversation's camera was on (home, for one whose tab is not among them). What was open
 * before is let go.
 */
export function restoreTabs(row: ReadonlyArray<{ kind: string; target: string }>, cameras: Readonly<Record<string, string>> = {}): void {
	const kept = row.map((one) => ({ id: `${one.kind}:${one.target}`, kind: one.kind, target: one.target }));
	const all = [HOME, ...kept.filter((tab, at) => kept.findIndex((other) => other.id === tab.id) === at)];
	setOpened(all);
	const on = Object.fromEntries(Object.entries(cameras).filter(([, id]) => all.some((tab) => tab.id === id)));
	setCameraTabs(on);
	setCanvasTabs(Object.fromEntries(Object.entries(on).filter(([, id]) => all.find((tab) => tab.id === id)?.kind === "canvas")));
	setShown([]);
}

/** The tab each conversation's camera is on, by agent id, for the row kept (`remember.ts`): home is left out. */
export const camerasNow = (): Record<string, string> => {
	const open = new Set(tabs().map((tab) => tab.id));
	return Object.fromEntries(Object.entries(cameraTabs()).filter(([, id]) => id !== HOME.id && open.has(id)));
};

/**
 * Put an agent's camera on a tab, opening the tab if it is not in the row: what its own `view open`
 * does. The conversation on screen's brings the tab forward; another's waits there, and the tab
 * comes forward when that chat is opened.
 */
export function aim(agent: string, kind: string, target: string): void {
	if (kind === "canvas" && stageOf(agent)?.name === target) return bring(HOME.id, agent);
	const id = `${kind}:${target}`;
	if (!opened().some((tab) => tab.id === id)) setOpened((all) => [...all, { id, kind, target }]);
	bring(id, agent);
}

/** Put an agent's camera back on home, its own canvas: what its `view focus` and `view goto` do. */
export const aimHome = (agent: string): void => bring(HOME.id, agent);

/** Bring a tab forward. */
export const showTab = (id: string): void => bring(id);

/** Bring home forward: the canvas of the conversation on screen. */
export const showHome = (): void => bring(HOME.id);

/** Close a tab; the one before it comes forward when it was in front. Home is never closed. */
export function closeTab(id: string): void {
	if (id === HOME.id) return;
	const all = tabs();
	const at = all.findIndex((tab) => tab.id === id);
	if (at < 0) return;
	const wasFront = front().id === id;
	setOpened((was) => was.filter((tab) => tab.id !== id));
	// A conversation whose camera was on it is on home again (`front`); the one on screen goes to the tab before it.
	if (wasFront) bring((all[at - 1] ?? HOME).id);
}
