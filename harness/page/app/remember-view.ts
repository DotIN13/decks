import { viewToPark } from "@decks/canvas/camera";
import { stageOf } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import type { Camera } from "../state/types/index.ts";
import { agentViews } from "../state/views.ts";
import { reportCamera } from "./camera-report.ts";

/** Keep a view for an agent not on screen, from its `decks view …`, on this device; and say it to the server. */
export function rememberView(agentId: string, camera: Camera, selected?: string): void {
	agentViews(state.deck?.path ?? "").keep(agentId, stageOf(agentId)?.name, viewToPark(camera, selected));
	reportCamera(camera, agentId);
}
