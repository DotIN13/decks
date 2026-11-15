/**
 * What a host that builds its own chrome around the editor uses (the Decks app, Decks Studio): the
 * drawing's tool bar and ink bar, what the canvas asks its host, the scheme, how a card reads, the
 * agents' stage calls and keys, the engine, and the knobs and probes the checks reach.
 */
export { PenBar } from "../ui/PenBar.tsx";
export { InkBar } from "../ui/InkBar.tsx";
export * from "../host.ts";
export * from "../camera/stage-ops.ts";
export * from "../items/card-reading.ts";
export * from "../ui/keycaps.ts";
export * from "../theme.ts";
// The engine itself, for a host that draws a stage with no editor round it (the Decks app's shot page).
export { StageEngine } from "../render/engine.ts";
// The knobs the measuring scripts set and the probes the browser checks read (`debug.ts`), typed once.
export { knobs, probes, type Knobs, type Probes } from "../debug.ts";
