import { m } from "@decks/i18n";
import { createSignal } from "solid-js";
import type { PanelTab } from "../panel/LeftPanel.tsx";
import { moveTo, stageOf, viewOnly } from "../state/canvases.ts";
import { setState, state } from "../state/deck.ts";
import { act } from "../state/decks.ts";
import { ensureHistory } from "../state/history.ts";
import { notice } from "../state/notices.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { setDraft, setPanelOpen, setUnread } from "../state/ui.ts";
import { movedHere } from "../tabs/remember.ts";
import { aimCanvas, canvasOnScreen, setCameraMover } from "../tabs/tabs.ts";

/**
 * What the person does to agents and canvases from the page's chrome.
 *
 * Named once, because there are several ways in to each (the pill's dropdown, a face in the
 * top-right stack, a row in the panel, the canvas switcher, the canvas manager), and several copies
 * of these steps is several chances to forget one. Each acts on the app's state and tells the
 * harness; none belongs to a component.
 */

/** The canvas the conversation on screen is on: with the agent, what its draft and its waiting comments are kept under. */
export const focusedCanvas = () => canvasOnScreen()?.name;
/** The canvas on screen, when it is a friend's shared with you to view (`state/canvases.ts`). */
export const viewOnlyStage = () => viewOnly(canvasOnScreen()?.name);

// ---- the panel ---------------------------------------------------------------------------------

/** Open the panel. */
export const showPanel = (open: boolean) => setPanelOpen(open);
/** A tab of the panel asked for from outside it: the agent list's overflow row asks for Agents, an app's frame for Apps. */
const [panelAsk, setPanelAsk] = createSignal<{ tab: PanelTab; at: number } | undefined>();
export { panelAsk };
export const openAgentsPanel = () => {
	showPanel(true);
	setPanelAsk({ tab: "agents", at: Date.now() });
};
export const openAppsPanel = () => {
	showPanel(true);
	setPanelAsk({ tab: "apps", at: Date.now() });
};

// ---- agents ------------------------------------------------------------------------------------

/**
 * Switch to an agent: its stage, its conversation, and the view this device left it in.
 *
 * Named, because there are several ways in — the pill's dropdown, a face in the top-right
 * stack, a row in the panel — and several copies of these steps is several chances to
 * forget one.
 */
export const focusAgent = (id: string) => {
	const leaving = state.focused;
	if (leaving === id) return;

	// The camera and the selection follow by themselves: the view is kept and taken by its owner (`landing`).
	setState("focused", id);
	setUnread(id, 0);
	ensureHistory(id);
	setDraft(undefined);
	void call("agent.focus", [id]);
};

/** Start an agent beside the one on screen, and open it: its conversation, and its canvas with it, as a click on its row would. */
export const newAgent = async (spec: { kind?: string; workspace?: string }) => {
	const answer = warnIfFailed(await call<{ id: string }>("agent.add", [{ ...spec, ...(state.focused ? { near: state.focused } : {}) }]));
	if (answer.ok && answer.value?.id) focusAgent(answer.value.id);
};

/*
 * Close a chat — the × on a row in the agent list.
 *
 * Nothing is cleaned up here on purpose. The server answers with `agent.removed`, which
 * is where the transcript, identity and context kept for that id are dropped, and then
 * an `agents` frame that carries the new list *and the new focus* — the registry moves it
 * to the nearest row, so guessing at one here would be a second opinion about which
 * conversation you are now in. A refusal comes back as a notice, which is the case the
 * row's × is disabled to avoid: `closing()` in `agent-order.ts` draws it from the same
 * rule `Registry.remove` enforces.
 */
export const closeAgent = (id: string) => void call("agent.remove", [id]).then(warnIfFailed);

// ---- canvases ----------------------------------------------------------------------------------

/** Whether the stage manager is up. One state, because there is one of it (`CanvasManager`). */
const [stagesOpen, setStagesOpen] = createSignal(false);
export { setStagesOpen, stagesOpen };

/**
 * Move a conversation's camera to a canvas, as the person: the stage manager's pick, the panel's Open and a canvas tab move the one on screen,
 * and an agent's move the person said Go to (`view.goto` offered) moves that agent's. The camera follows when the server
 * says the agent is there (the landing, `app/landing.ts`).
 */
export const moveConversation = (agentId: string | undefined, name: string, forward = true) => {
	if (!agentId || stageOf(agentId)?.name === name) return;
	// The canvas comes in front of a card, a document or an app that chat had over the one it leaves, unless the mover says otherwise (a canvas tab closed).
	if (forward) aimCanvas(agentId);
	movedHere(agentId, name);
	// On screen at once; the server is told beside it, and a refusal (a notice from act) moves back.
	void moveTo(agentId, name, async () => {
		if ((await act("agent.update", [{ canvas: name }], agentId)) === undefined) throw new Error(`not moved to ${name}`);
	}).catch(() => undefined);
};
export const openCanvas = (name: string) => moveConversation(state.focused, name);
// A canvas tab picked moves the camera of the chat on screen the same way (`tabs/tabs.ts`).
setCameraMover(moveConversation);

/** A new canvas, and the conversation on screen moved onto it. */
export const createCanvas = (title: string) => {
	const agentId = state.focused;
	if (!agentId) return;
	void act<{ name: string }>("canvas.create", [title], agentId).then((made) => made && act("agent.update", [{ canvas: made.name }], agentId));
};
export const newCanvas = () => createCanvas("Untitled");

/**
 * Your own copy of a friend's canvas (`canvas.copyShared`), and this conversation moved onto it:
 * how a canvas shared with you to view is changed. It syncs as your canvas, never back to theirs.
 */
export const copyShared = (name: string) => {
	const agentId = state.focused;
	void act<{ name: string; title: string }>("canvas.copyShared", [{ canvas: name }]).then((made) => {
		if (!made) return;
		setStagesOpen(false);
		notice("info", m.app_own_copy({ name: made.title }));
		if (agentId) void act("agent.update", [{ canvas: made.name }], agentId);
	});
};
