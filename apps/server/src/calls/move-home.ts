import type { VerbContext } from "./context.ts";

/**
 * An agent moving its own conversation to a canvas, the one rule `view.goto`, `view.focus` and
 * `agent.update --canvas` share, as the person's canvas switcher does it: in the background it just
 * moves; on screen the screen moves with it, unless the person is using the canvas, who is offered a
 * button instead and nothing moves until they press it (the browser decides, `stage-ops.ts`, `goto`).
 * Never another agent's conversation shown in its place. The person moving one (`agent.person`) moves it.
 */
export async function moveHome(ctx: VerbContext, name: string): Promise<{ moved: boolean; onScreen: boolean; offered?: string }> {
	const { service, agent } = ctx;
	if (!agent.setHome || agent.board) throw new Error("Only an agent has a home canvas to change.");
	const may = await service.mayMove(agent.id, name, agent.person === true);
	// There already: nothing moves, and the answer still says whether the person is looking at it.
	if (agent.stageName?.() === name) return { moved: false, onScreen: may.onScreen };
	if (!may.apply) return { moved: false, onScreen: true, ...(may.offered ? { offered: may.offered } : {}) };
	agent.setHome(name);
	// Who is on which canvas is in every browser's canvas list: the screen follows the conversation on it there.
	service.stagesChanged();
	return { moved: true, onScreen: may.onScreen };
}

/** The canvas a card's or board's deck path names (`canvases/<name>/…`, `shared/canvases/<owner>/<name>/…`), if it names one. */
export function canvasOfPath(path: string): string | undefined {
	const own = /^canvases\/([^/]+)\//.exec(path);
	if (own) return own[1];
	const friend = /^shared\/canvases\/([^/]+)\/([^/]+)\//.exec(path);
	return friend ? `shared/${friend[1]}/${friend[2]}` : undefined;
}
