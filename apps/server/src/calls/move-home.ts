import type { VerbContext } from "./context.ts";

/**
 * An agent putting the camera of its own chat on a canvas, the one rule `view.goto`, `view.focus`,
 * `view.open` and `agent.update --canvas` share, as the person's canvas switcher does it: in the background it just
 * moves; on screen the screen moves with it, unless the person is using the canvas, who is offered a
 * button instead and nothing moves until they press it (the browser decides, `view-ops.ts`, `goto`).
 * Never another agent's conversation shown in its place. The person moving one (`agent.person`) moves it.
 */
export async function moveHome(ctx: VerbContext, name: string, keep = false): Promise<{ moved: boolean; onScreen: boolean; offered?: string }> {
	const { service, agent } = ctx;
	if (!agent.setHome || agent.app) throw new Error("Only an agent's chat has a camera to put on a canvas.");
	const may = await service.mayMove(agent.id, name, agent.person === true, keep);
	// There already: nothing moves, and the answer still says whether the person is looking at it.
	if (agent.canvasName?.() === name) return { moved: false, onScreen: may.onScreen };
	if (!may.apply) return { moved: false, onScreen: true, ...(may.offered ? { offered: may.offered } : {}) };
	agent.setHome(name);
	// Who is on which canvas is in every browser's canvas list: the screen follows the conversation on it there.
	service.stagesChanged();
	return { moved: true, onScreen: may.onScreen };
}

/** The canvas a card's deck path names (`canvases/<name>/…`, `shared/canvases/<owner>/<name>/…`), if it names one. */
export function canvasOfPath(path: string): string | undefined {
	const own = /^canvases\/([^/]+)\//.exec(path);
	if (own) return own[1];
	const friend = /^shared\/canvases\/([^/]+)\/([^/]+)\//.exec(path);
	return friend ? `shared/${friend[1]}/${friend[2]}` : undefined;
}
