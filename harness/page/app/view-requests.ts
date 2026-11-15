import { runStageCall } from "@decks/canvas/host";
import type { FramedHandle } from "@decks/canvas";
import { canvasOf } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import { on } from "../state/line.ts";
import { offer } from "../state/notices.ts";
import type { Camera } from "../state/types/index.ts";
import { stageCallOf, type Requested } from "./view-call.ts";

// A view call another caller made (view.focus, move, goto, reload, cursor)
// reaches this screen as view.requested; it is run here as today's page ran
// today's view.called, on the frame's camera and selection.

/** Hear view calls for this screen and run them on the frame. Answers the stop. */
export function answerViews(deps: { editor: () => FramedHandle | undefined; boxOf: (id: string) => { x: number; y: number; w: number; h: number } | undefined; moveConversation: (agent: string, canvas: string) => void; rememberView: (agent: string, camera: Camera, selected?: string) => void }): () => void {
	return on("view.requested", (event) => {
		const call = stageCallOf(event as Requested, deps.boxOf);
		if (!call) return;
		const frame = () => document.querySelector("iframe.canvas-frame");
		runStageCall(call, {
			boards: () => state.pages,
			viewport: () => ({ width: frame()?.clientWidth ?? 0, height: frame()?.clientHeight ?? 0 }),
			focused: () => state.focused,
			stageOnScreen: () => canvasOf(state.focused)?.name,
			offerGoto: (agent, canvas) => offer(`An agent wants to take you to the canvas ${canvas}`, { label: "Go", run: () => deps.moveConversation(agent, canvas) }, "agent-view"),
			setCamera: (camera, options) => (options?.animate ? deps.editor()?.glide(camera) : deps.editor()?.setCamera(camera)),
			rememberView: deps.rememberView,
			select: (path) => path && deps.editor()?.select([path]),
			reload: (path) => deps.editor()?.reloadCard(path),
			cursor: () => true,
		});
	});
}
