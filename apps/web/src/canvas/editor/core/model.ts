/**
 * The editor's own words for what it works with. Core imports these and the pen types, nothing
 * from the page: no Solid, no DOM, no engine (`core/imports.test.ts` holds that).
 */
import type { Frame } from "@decks/pen";

export type Pt = { x: number; y: number };
/** A box on the stage, in stage pixels. */
export type Rect = Frame;
/** A board as the stage places it. */
export type BoardBox = { path: string; x: number; y: number; w: number; h: number };
