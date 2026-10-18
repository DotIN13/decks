/**
 * The editor's own words for what it works with. Core imports these and the pen types, nothing
 * from the page: no Solid, no DOM, no engine (`core/imports.test.ts` holds that).
 */
import type { Frame } from "@decks/pen";

export type Pt = { x: number; y: number };
/** A box on the stage, in stage pixels. */
export type Rect = Frame;
/** A board as the stage places it; a slide deck (`slides`) is sized by its width alone. */
export type BoardBox = { path: string; x: number; y: number; w: number; h: number; slides?: boolean };
/**
 * What a press on the stage's drawing does: `select` picks up, every other tool makes one item and
 * hands back to `select`. The page keeps the armed one (`state/pen-tools.ts`).
 */
export type PenTool = "select" | "note" | "card" | "text" | "rectangle" | "ellipse" | "frame" | "arrow" | "shape" | "icon";
/** A tool that makes an item at a point, by a click or a drag: all but `select` and `arrow`. */
export type MakingTool = Exclude<PenTool, "select" | "arrow">;
/**
 * The key that arms each tool. `v` is select, handled with the camera's keys. `s` still makes a
 * note, because it made a sticky when the tools inserted into boards.
 */
export const PEN_TOOL_KEYS: Record<string, PenTool> = { n: "note", s: "note", c: "card", t: "text", r: "rectangle", o: "ellipse", f: "frame", a: "arrow" };
