import type { StageRow } from "@decks/protocol";
import { createSignal } from "solid-js";
import { stageOf, stages } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import type { Tab } from "./kind.ts";

/**
 * The row of tabs: what is open in this window, and which one each conversation's camera is on.
 *
 * There is no home. The row is the window's: the same tabs whoever you talk to. What is in front is
 * the conversation's: each agent's chat has a camera, and it is on one tab, a canvas, a card, a
 * document or an app. Opening an agent's chat shows the tab its camera is on; picking a tab puts the
 * camera of the chat on screen there.
 *
 * A camera is on a canvas, and may be on a tab of another kind in front of it:
 *
 * - **Which canvas** is the harness's to keep (`stageOf`, the canvas list): the same on every device,
 *   told to the agent (`decks here`), and moved by the person (a canvas tab picked, the canvas list)
 *   or by the agent's own `view` calls. It is where the person looks beside that chat, never where
 *   the agent's calls act: each of those names its canvas.
 * - **A card, a document or an app in front** is this window's to keep (`cameraTabs`): the canvas
 *   stays held behind it, as it was.
 *
 * So the canvas of the chat on screen always has a tab, whether it was opened as one or not, and a
 * canvas the camera leaves stays in the row only when it was opened as a tab. In the row it is a tab
 * like the others (`TabStrip.tsx`): in its place, washed when in front, closed with its ✕.
 */
const [opened, setOpened] = createSignal<Tab[]>([]);
/** The card, document or app each conversation's camera is on, by agent id; one with none is on its canvas. */
const [cameraTabs, setCameraTabs] = createSignal<Readonly<Record<string, string>>>({});
/** The tabs in the order they were last in front, the latest first: what a kind that keeps tabs alive behind the front one goes by (`alive`). */
const [shown, setShown] = createSignal<readonly string[]>([]);
/** The conversation on screen, whose camera a press on a tab moves. */
const who = (): string => state.focused ?? "";

const idOf = (kind: string, target: string): string => `${kind}:${target}`;
/** A canvas's tab: the same object for a canvas each time, opened in the row or not, so what draws it keeps it. */
const canvasTabs = new Map<string, Tab>();
const canvasTab = (name: string): Tab => {
	let tab = canvasTabs.get(name);
	if (!tab) canvasTabs.set(name, (tab = { id: idOf("canvas", name), kind: "canvas", target: name }));
	return tab;
};
/** The tab of a chat with no canvas yet: a canvas tab with none to show. */
const NONE: Tab = { id: "canvas:", kind: "canvas" };

/** Moves a conversation's camera to a canvas, as the harness keeps it: the app's own (`app/person.ts`, `moveConversation`), given here once. */
let moveCamera: (agent: string, canvas: string) => void = () => {};
export const setCameraMover = (move: (agent: string, canvas: string) => void): void => void (moveCamera = move);

/** The canvas the camera of the chat on screen is on: what is on screen, or held behind a card, a document or an app. */
export const canvasOnScreen = (): StageRow | undefined => stageOf(state.focused);

/** The tabs opened in the row whose target is still there: a canvas tab whose canvas is gone (deleted, or renamed away) is not one of them. */
const kept = (): Tab[] => opened().filter((tab) => tab.kind !== "canvas" || stages().length === 0 || stages().some((one) => one.name === tab.target));

/** The canvas tab the camera of the chat on screen is on, opened in the row or not. */
export function cameraCanvasTab(): Tab {
	const name = canvasOnScreen()?.name;
	return name ? canvasTab(name) : NONE;
}

/** The tabs in this window: the ones opened, with the canvas of the chat on screen first among them when it was not opened as one. */
export function tabs(): Tab[] {
	const row = kept();
	const camera = cameraCanvasTab();
	return row.includes(camera) ? row : [camera, ...row];
}

/** The tab in front: the card, document or app the camera of the chat on screen is on, else its canvas. */
export function front(): Tab {
	const id = cameraTabs()[who()];
	return (id ? kept().find((tab) => tab.id === id && tab.kind !== "canvas") : undefined) ?? cameraCanvasTab();
}

/** Whether a canvas is in front: the camera of the chat on screen is on its canvas, with nothing over it. */
export const onCanvas = (): boolean => front().kind === "canvas";

/** The tab in front was seen: by a press on it, or by opening the chat of an agent whose camera is on it (`TabView.tsx`). */
export const sawFront = (id: string): void => {
	if (shown()[0] !== id) setShown((was) => [id, ...was.filter((one) => one !== id)].slice(0, 64));
};

/**
 * The tabs of a kind that are alive now: the one in front, and the `behind` that were in front most
 * lately. A kind whose tabs go on running behind the front one (an app) keeps these and puts the
 * rest away, so a device holds only as many as it has memory for (`budget.ts`). A tab put back by
 * `restoreTabs` and not shown since is not among them: a row of apps does not all start at once.
 */
export function alive(kind: string, behind: number): Tab[] {
	const order = shown();
	const of = tabs().filter((tab) => tab.kind === kind && (order.includes(tab.id) || tab.id === front().id));
	const rank = (tab: Tab) => (tab.id === front().id ? -1 : order.indexOf(tab.id));
	const live = [...of].sort((a, b) => rank(a) - rank(b)).slice(0, (front().kind === kind ? 1 : 0) + behind);
	// In the row's order, so a tab's place among them does not change as others come and go.
	return of.filter((tab) => live.includes(tab));
}

/**
 * Put a tab in the row if it is not there: after the others. The canvas the camera of the chat on
 * screen is on already shows, first, so kept in the row it stays first: a tab keeps its place.
 */
function ensure(kind: string, target: string): Tab {
	const id = idOf(kind, target);
	const found = opened().find((tab) => tab.id === id);
	if (found) return found;
	const tab = kind === "canvas" ? canvasTab(target) : { id, kind, target };
	const first = tab === cameraCanvasTab();
	setOpened((all) => (first ? [tab, ...all] : [...all, tab]));
	return tab;
}

/** Put a conversation's camera on its canvas, with nothing over it. */
const onItsCanvas = (agent: string): void => {
	if (cameraTabs()[agent] === undefined) return;
	setCameraTabs((was) => Object.fromEntries(Object.entries(was).filter(([id]) => id !== agent)));
};

/** Put the camera of the chat on screen on a tab of the row. A canvas tab moves the camera to that canvas, for every device and for the agent's `decks here`; nothing changes where the agent's calls act. */
export function showTab(id: string): void {
	const tab = tabs().find((one) => one.id === id);
	if (!tab) return;
	const agent = who();
	if (tab.kind !== "canvas") return void setCameraTabs((was) => ({ ...was, [agent]: tab.id }));
	onItsCanvas(agent);
	if (tab.target && tab.target !== canvasOnScreen()?.name) moveCamera(agent, tab.target);
}

/** Bring the canvas of the chat on screen forward, from behind a card, a document or an app. */
export const showCanvas = (): void => onItsCanvas(who());

/**
 * Open a tab on a target and put the camera of the chat on screen on it, or on the one already open
 * on it. A canvas opened this way stays in the row, and so does the one the camera leaves for it.
 */
export function openTab(kind: string, target: string): void {
	if (kind === "canvas") {
		const here = canvasOnScreen()?.name;
		if (here && here !== target) ensure("canvas", here);
		if (here !== target) ensure("canvas", target);
	} else ensure(kind, target);
	showTab(idOf(kind, target));
}

/** The canvas tab the camera of the chat on screen would go to if its own were closed: the next canvas in the row, else the one before. */
function canvasBeside(): Tab | undefined {
	const canvases = tabs().filter((tab) => tab.kind === "canvas");
	const at = canvases.indexOf(cameraCanvasTab());
	return canvases[at + 1] ?? canvases[at - 1];
}

/** Whether a tab can be closed: any but the canvas the chat on screen is on while it is the row's only canvas, since a chat is always on one. */
export const canClose = (tab: Tab): boolean => tab !== cameraCanvasTab() || canvasBeside() !== undefined;

/**
 * Close a tab. A conversation whose camera was on it is on its canvas again. The canvas the camera of
 * the chat on screen is on closes like any other when the row has another canvas: the camera goes to
 * the one beside it. The row's only canvas stays (`canClose`).
 */
export function closeTab(id: string): void {
	if (id === cameraCanvasTab().id) {
		const beside = canvasBeside();
		if (!beside?.target) return;
		moveCamera(who(), beside.target);
	}
	setOpened((was) => was.filter((tab) => tab.id !== id));
	setCameraTabs((was) => Object.fromEntries(Object.entries(was).filter(([, tab]) => tab !== id)));
}

/**
 * Put back a row as it was left (`remember.ts`): the tabs, in their order, and the card, document or
 * app each conversation's camera was on. What was open before is let go.
 */
export function restoreTabs(row: ReadonlyArray<{ kind: string; target: string }>, cameras: Readonly<Record<string, string>> = {}): void {
	const all = row.map((one) => (one.kind === "canvas" ? canvasTab(one.target) : { id: idOf(one.kind, one.target), kind: one.kind, target: one.target }));
	const once = all.filter((tab, at) => all.findIndex((other) => other.id === tab.id) === at);
	setOpened(once);
	setCameraTabs(Object.fromEntries(Object.entries(cameras).filter(([, id]) => once.some((tab) => tab.id === id && tab.kind !== "canvas"))));
	setShown([]);
}

/** The row as it is kept (`remember.ts`): the tabs opened, and the tab each conversation's camera is on when that is no canvas. */
export const rowNow = (): { tabs: Array<{ kind: string; target: string }>; cameras: Record<string, string> } => {
	const row = kept();
	return {
		tabs: row.flatMap((tab) => (tab.target === undefined ? [] : [{ kind: tab.kind, target: tab.target }])),
		cameras: Object.fromEntries(Object.entries(cameraTabs()).filter(([, id]) => row.some((tab) => tab.id === id))),
	};
};

/**
 * Put an agent's camera on a card, a document or an app, opening its tab if it is not in the row:
 * what its own `view open` does. The chat on screen's comes forward; another's waits there, and is in
 * front when that chat is opened. A canvas is not aimed at here: the harness moves the camera to one
 * (`view goto`), and the row follows it.
 */
export function aim(agent: string, kind: string, target: string): void {
	if (kind === "canvas") return;
	const tab = ensure(kind, target);
	setCameraTabs((was) => ({ ...was, [agent]: tab.id }));
}

/** Keep a canvas in the row as a tab: the one an agent's `view open` goes to, and the one the camera leaves for it. */
export const keepCanvas = (name: string): void => void ensure("canvas", name);

/** An agent's camera is on its canvas, with nothing over it: what a view it sets there, or a canvas it goes to, does. */
export const aimCanvas = (agent: string): void => onItsCanvas(agent);
