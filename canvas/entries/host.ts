/**
 * What a host that builds its own chrome around the editor uses (the Decks app, Decks Studio): the
 * drawing's tool bar and ink bar, what the canvas asks its host, the scheme, how a card reads, the
 * agents' stage calls and keys, the engine, and the knobs and probes the checks reach.
 */
export { PenBar } from "../chrome/PenBar.tsx";
export { InkBar } from "../chrome/InkBar.tsx";
export * from "../host/host.ts";
export * from "../camera/view-calls.ts";
export * from "../cards/card-reading.ts";
export * from "../chrome/keycaps.ts";
export * from "../theme.ts";
// How a page on a shared canvas keeps its drawing in step with Studio (Decks Studio's own page uses it too).
export { CanvasFollower, type FollowerHost } from "../host/inside/follower.ts";
// The engine itself, for a host that draws a stage with no editor round it (the Decks app's shot page).
export { StageEngine } from "../render/engine.ts";
// The knobs the measuring scripts set and the probes the browser checks read (`debug.ts`), typed once.
export { knobs, probes, type Knobs, type Probes } from "../debug.ts";
