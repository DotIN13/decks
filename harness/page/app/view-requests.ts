import { runStageCall } from "@decks/canvas/host";
import type { FramedHandle } from "@decks/canvas";
import { canvasOf } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import { call, on } from "../state/line.ts";
import { offer } from "../state/notices.ts";
import type { Camera } from "../state/types/index.ts";
import { todaysCall, type Requested } from "./view-call.ts";

// A view call another caller made (view.focus, move, goto, reload, cursor)
// reaches this screen as view.requested; it is run here as today's page ran
// today's view.called, on the frame's camera and selection.

type Box = { x: number; y: number; w: number; h: number };

/** Hear view calls for this screen and run them on the frame. Answers the stop. */
export function answerViews(deps: { editor: () => FramedHandle | undefined; took: () => void; boxOf: (id: string) => { x: number; y: number; w: number; h: number } | undefined; moveConversation: (agent: string, canvas: string) => void; rememberView: (agent: string, camera: Camera, selected?: string) => void }): () => void {
	return on("view.requested", (event) => void answer(event as Requested, deps));
}

/** Run one view call; a focus on something the page's copy of the drawing lacks reads the canvas's items first. */
async function answer(event: Requested, deps: Parameters<typeof answerViews>[0]): Promise<void> {
	const fresh = event.call === "view.focus" && lacks(event, deps.boxOf) ? await readBoxes(event.canvas) : new Map<string, Box>();
	const call = todaysCall(event, (id) => deps.boxOf(id) ?? fresh.get(id), (path) => fresh.get(path));
	if (!call) return;
	const frame = () => document.querySelector("iframe.canvas-frame");
	runStageCall(call, {
		boards: () => state.pages,
		viewport: () => ({ width: frame()?.clientWidth ?? 0, height: frame()?.clientHeight ?? 0 }),
		focused: () => state.focused,
		stageOnScreen: () => canvasOf(state.focused)?.name,
		offerGoto: (agent, canvas) => offer(`An agent wants to take you to the canvas ${canvas}`, { label: "Go", run: () => deps.moveConversation(agent, canvas) }, "agent-view"),
		// A view call that moves this screen calls off a landing still waiting, as a person's move does.
		setCamera: (camera, options) => (deps.took(), options?.animate ? deps.editor()?.glide(camera) : deps.editor()?.setCamera(camera)),
		rememberView: deps.rememberView,
		select: (path) => path && deps.editor()?.select([path]),
		reload: (path) => deps.editor()?.reloadCard(path),
		cursor: () => true,
	});
}

/** Whether a focus names an item the page's copy lacks, or a card the page's list does not hold. */
function lacks(event: Requested, boxOf: (id: string) => Box | undefined): boolean {
	const targets = ([] as unknown[]).concat(event.args?.target ?? []).map(String);
	return targets.some((one) => (one.endsWith(".html") ? !state.pages.some((page) => page.path === one) : !boxOf(one)));
}

/** The canvas's items, by id and by card path, each with its box: read now, not from the page's copy. */
async function readBoxes(canvas: string | undefined): Promise<Map<string, Box>> {
	const items = await call<Array<{ id?: string; card?: string; box?: { x1: number; y1: number; x2: number; y2: number } }>>("item.list", { ...(canvas ? { canvas } : {}), depth: 0 });
	const boxes = new Map<string, Box>();
	for (const item of items.ok ? items.value : []) {
		if (!item.box) continue;
		const box = { x: item.box.x1, y: item.box.y1, w: item.box.x2 - item.box.x1, h: item.box.y2 - item.box.y1 };
		if (item.id) boxes.set(item.id, box);
		if (item.card) boxes.set(item.card, box);
	}
	return boxes;
}
