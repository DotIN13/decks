/** Where a person was looking: a camera kept per conversation and canvas, and where to go back to. */
export { selectionOnSwitch, viewOnSwitch, viewToPark, type AgentView } from "../camera/agent-view.ts";
export { createAgentViews, type AgentViews, type ViewStorage } from "../camera/agent-views.ts";
export { boxOf, fitInto, frames } from "../camera/camera.ts";
export type { Camera } from "@decks/protocol";
