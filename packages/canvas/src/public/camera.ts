/** Where a person was looking: a camera kept per conversation and canvas, and where to go back to. */
export { selectionOnSwitch, viewOnSwitch, viewToPark, type AgentView } from "../camera/agent-view.ts";
export { createAgentViews, type AgentViews, type ViewStorage } from "../camera/agent-views.ts";
export { boxOf, fitInto, frames } from "../camera/camera.ts";
export type { Camera } from "@decks/protocol";
// For a host that drives the camera itself (the Decks app): the camera's maths, its animation, and the panels' insets.
export * from "../camera/camera.ts";
export * from "../camera/morph.ts";
export * from "../camera/touched.ts";
export * from "../camera/insets.ts";
export * from "../lib/spring.ts";
