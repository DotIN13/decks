import { stageOf } from "../../state/canvases.ts";
import type { Camera } from "@decks/protocol";
import { viewToPark } from "@decks/canvas/camera";
import { agentViews } from "../../state/views.ts";
import { runStageCall } from "@decks/canvas/host";
import { reportCamera } from "../camera-report.ts";
import { nameOf, state } from "../../state/deck.ts";
import { offer } from "../../state/notices.ts";
import { send } from "../../state/socket.ts";
import type { FrameHooks, Of } from "../socket-messages.ts";

/**
 * Keep a view for an agent that is not the one on screen, from its `decks view …`: here, or on the
 * canvas frame for the canvas it shows (`viewFor`). On this device, like every other view
 * (`state/views.ts`): an agent that moved a canvas nobody is looking at is remembered for the
 * browser that was told, in the same store the landing parks views in and takes them from when that
 * chat opens (`camera/landing.ts`).
 */
export function rememberView(agentId: string, camera: Camera, selected?: string): void {
	agentViews(state.deck?.path ?? "").keep(agentId, stageOf(agentId)?.name, viewToPark(camera, selected));
	// So `decks.view.camera()` answers for that agent's stage rather than falling back to wherever the last person to look at anything was.
	reportCamera(camera, agentId);
}

/**
 * An agent asking something of the person's view (`decks view …`), when the canvas frame on screen is
 * not the one to answer it.
 */
export function heardView(message: Of<"view">, hooks: FrameHooks): void {
	if (message.type !== "view.called") return;
	/*
	 * The canvas in its frame answers an agent's view on the canvas it shows, from its own stream
	 * (`@decks/canvas`, `frame/frame.tsx`): this page leaves those to it, and answers the rest.
	 */
	// An agent moving to another canvas while its own is on screen: the frame answers, which knows whether the person is using the canvas.
	// The person's own move asks nobody, so this page answers it, whether or not that frame is up yet.
	if (message.call.op === "goto" && message.call.agentId && (message.call.args as { person?: unknown } | undefined)?.person !== true && stageOf(message.call.agentId)?.name === stageOf(state.focused)?.name && document.querySelector("iframe.canvas-frame")) return;
	if (["show", "camera", "reload", "cursor", "shot"].includes(message.call.op)) {
		const args = message.call.args as { stage?: unknown; path?: unknown } | undefined;
		const screen = stageOf(state.focused)?.name;
		// A cursor, a reload or a card's picture names a card: the frame answers when that card is on the canvas it shows.
		if ((message.call.op === "cursor" || message.call.op === "reload" || message.call.op === "shot") && typeof args?.path === "string") {
			if (state.pages.some((board) => board.path === args.path) || (screen && args.path.startsWith(`canvases/${screen}/`))) return;
		} else {
			const on = typeof args?.stage === "string" ? args.stage : stageOf(message.call.agentId)?.name;
			if (on && on === screen) return;
		}
	}
	/*
	 * A picture of a card as this browser has it, for an agent's screenshot: the canvas frame writes
	 * out a card on the canvas it shows (above, `items/card-snapshot.ts`). For a card on a canvas not
	 * on screen, or a board, which the canvas draws as its picture, there is none, and the server's
	 * picture is the one.
	 */
	if (message.call.op === "shot") {
		// A moment later: the first answer is the one taken, and another tab's frame may have the card.
		const id = message.call.id;
		setTimeout(() => send({ type: "view.answered", id, value: { how: "none", why: "it is not on the canvas on the person's screen" } }), 1500);
		return;
	}
	/*
	 * An agent asking something of the canvas. It is answered, always —
	 * the server is holding a tool call open on it, and a refusal it can
	 * read beats a timeout it cannot.
	 */
	let value: unknown;
	try {
		value = runStageCall(message.call, {
			boards: () => state.pages,
			viewport: () => {
				const stage = document.querySelector("iframe.canvas-frame");
				return { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 };
			},
			/*
			 * Whose canvas this is. An op that moves the view is carried out for the
			 * conversation on screen and remembered for one that is not — see `defer`
			 * in `canvas/stage-ops.ts`, which is where the reasoning lives.
			 */
			focused: () => state.focused,
			stageOnScreen: () => stageOf(state.focused)?.name,
			offerGoto: (agentId, stage) => offer(`${nameOf(agentId)} wants to take you to the canvas ${stage}`, { label: "Go", run: () => hooks.moveConversation?.(agentId, stage) }, "agent-view"),
			/*
			 * What reaches this page is never for the canvas on screen, whose frame carries out its own
			 * calls (above): a view for another conversation is remembered for it, and nothing on this
			 * page draws a canvas to move or select on, so no view is offered or moved here.
			 */
			setCamera: () => {},
			rememberView,
			select: () => {},
			// A card or a cursor on a canvas that is not on screen: nothing here shows it.
			reload: () => {},
			cursor: () => true,
		});
	} catch (error) {
		value = { error: error instanceof Error ? error.message : String(error) };
	}
	const failed = value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string" ? (value as { error: string }).error : undefined;
	send(failed ? { type: "view.answered", id: message.call.id, error: failed } : { type: "view.answered", id: message.call.id, value });
}
