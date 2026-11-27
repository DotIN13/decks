import { m } from "@decks/i18n";
import { stageOf } from "../../state/canvases.ts";
import type { Camera } from "@decks/protocol";
import { viewToPark } from "@decks/canvas/camera";
import { agentViews } from "../../state/views.ts";
import { runViewCall } from "@decks/canvas/page";
import { reportCamera } from "../camera-report.ts";
import { nameOf, state } from "../../state/deck.ts";
import { offer } from "../../state/notices.ts";
import { send } from "../../state/socket.ts";
import type { FrameHooks, Of } from "../socket-messages.ts";
import { aim, aimCanvas, canvasOnScreen, keepCanvas, onCanvas, openTab, showCanvas } from "../../tabs/tabs.ts";

/**
 * Keep a view for an agent that is not the one on screen, from its `decks view …`: here, or on the
 * canvas frame for the canvas it shows (`viewFor`). On this device, like every other view
 * (`state/views.ts`): an agent that moved a canvas nobody is looking at is remembered for the
 * browser that was told, in the same store the landing parks views in and takes them from when that
 * chat opens (`camera/landing.ts`).
 */
export function rememberView(agentId: string, camera: Camera, selected?: string, canvas?: string): void {
	// The canvas is named by the frame that said it: the page may not have heard yet that the agent's camera went there.
	agentViews(state.deck?.path ?? "").keep(agentId, canvas ?? stageOf(agentId)?.name, viewToPark(camera, selected));
	// Its camera is on its canvas now, with no card, document or app over it: opening its chat shows this view.
	aimCanvas(agentId);
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
	/*
	 * The chat on screen showing something on its canvas (`view.focus`) while a card, a document or an
	 * app is in front: the canvas is held behind that tab, its frame moves the view there unseen and
	 * answers, and the person is offered the way back, since the tab they are reading is theirs to leave.
	 */
	if (message.call.op === "show" && message.call.agentId === state.focused && !onCanvas()) {
		const args = (message.call.args ?? {}) as { stage?: unknown; paths?: unknown };
		if (args.stage === canvasOnScreen()?.name) {
			const paths = (Array.isArray(args.paths) ? args.paths : []).filter((path): path is string => typeof path === "string");
			const what = state.pages.find((page) => page.path === paths[0])?.title ?? m.app_something_on_canvas();
			offer(m.app_wants_show({ name: nameOf(message.call.agentId), what }), { label: m.app_show(), run: () => showCanvas() }, "agent-view");
		}
	}
	// An agent going to the canvas its chat's camera is already on, from behind a card, a document or an app: nothing moves at the harness, so it is brought forward here.
	// Not the person's own move of a camera, which this page made, is already on, and said what is in front when it made it (`moveConversation`); a `view open` is always one to bring forward.
	const going = message.call.op === "goto" ? (message.call.args as { stage?: unknown; person?: unknown; keep?: unknown } | undefined) : undefined;
	if (going && message.call.agentId && (going.person !== true || going.keep === true) && going.stage === stageOf(message.call.agentId)?.name) aimCanvas(message.call.agentId);
	// The chat on screen opening a canvas as a tab (`view.open`): that canvas and the one its camera leaves stay in the row, whoever answers whether it may move.
	if (message.call.op === "goto" && message.call.agentId === state.focused && (message.call.args as { keep?: unknown } | undefined)?.keep === true) {
		const to = (message.call.args as { stage?: unknown }).stage;
		const from = canvasOnScreen()?.name;
		if (from) keepCanvas(from);
		if (typeof to === "string") keepCanvas(to);
	}
	// An agent moving to another canvas while its own is on screen: the frame answers, which knows whether the person is using the canvas.
	// The person's own move asks nobody, so this page answers it, whether or not that frame is up yet.
	if (message.call.op === "goto" && message.call.agentId && (message.call.args as { person?: unknown } | undefined)?.person !== true && stageOf(message.call.agentId)?.name === canvasOnScreen()?.name && document.querySelector("iframe.canvas-frame")) return;
	if (["show", "camera", "reload", "cursor", "shot"].includes(message.call.op)) {
		const args = message.call.args as { stage?: unknown; path?: unknown } | undefined;
		const screen = canvasOnScreen()?.name;
		// A cursor, a reload or a card's picture names a card: the frame answers when that card is on the canvas it shows.
		if ((message.call.op === "cursor" || message.call.op === "reload" || message.call.op === "shot") && typeof args?.path === "string") {
			if (state.pages.some((board) => board.path === args.path) || (screen && args.path.startsWith(`canvases/${screen}/`))) return;
		} else {
			const on = typeof args?.stage === "string" ? args.stage : stageOf(message.call.agentId)?.name;
			if (on && on === screen) return;
		}
	}
	/*
	 * An agent opening something whole as a tab of this window (`view.open`): its camera goes to that
	 * tab (`tabs/tabs.ts`, `aim`). From the chat on screen that brings the tab forward; from another
	 * the tab is put in the row and waits for that chat to be opened, and the person is offered a
	 * button, since nothing an agent does in the background changes what is on screen.
	 */
	if (message.call.op === "open") {
		const { kind, target, title } = message.call.args as { kind: string; target: string; title?: string };
		const onScreen = message.call.agentId === state.focused;
		// The agent's camera goes to that tab: in front when its chat is on screen, waiting there for when it is opened otherwise.
		aim(message.call.agentId, kind, target);
		if (!onScreen) offer(m.app_wants_show({ name: nameOf(message.call.agentId), what: title ?? target }), { label: m.app_open(), run: () => openTab(kind, target) }, "agent-view");
		send({ type: "view.answered", id: message.call.id, value: onScreen ? { opened: true } : { offered: "another chat is on the person's screen: the tab waits in your chat, where it is in front when they open it, and they were offered a button that opens it now" } });
		return;
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
		value = runViewCall(message.call, {
			cards: () => state.pages,
			viewport: () => {
				const stage = document.querySelector("iframe.canvas-frame");
				return { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 };
			},
			/*
			 * Whose canvas this is. An op that moves the view is carried out for the
			 * conversation on screen and remembered for one that is not — see `defer`
			 * in `canvas/view-ops.ts`, which is where the reasoning lives.
			 */
			focused: () => state.focused,
			canvasOnScreen: () => canvasOnScreen()?.name,
			offerGoto: (agentId, stage) => offer(m.app_wants_goto({ name: nameOf(agentId), canvas: stage }), { label: m.app_go(), run: () => hooks.moveConversation?.(agentId, stage) }, "agent-view"),
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
