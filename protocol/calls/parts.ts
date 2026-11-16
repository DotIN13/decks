import type { Who } from "../call.ts";
import { opt, str } from "../schema.ts";

// Who-lists and options many calls share.

export const ANYONE: readonly Who[] = ["person", "agent", "app", "card"];
export const NOT_CARD: readonly Who[] = ["person", "agent", "app"];
export const PEOPLE: readonly Who[] = ["person", "agent"];
export const PERSON: readonly Who[] = ["person"];
export const AGENT: readonly Who[] = ["agent"];

/** The canvas a call acts on; left out, the caller's here. */
export const onCanvas = { canvas: opt(str("A canvas's name or title; left out, the caller's here.")) };
/** A canvas, or a frame file in frames/ (never both). */
export const onItems = { ...onCanvas, frame: opt(str("A frame file, frames/<name>, instead of a canvas.")) };
/** A client's own name for the edit a call makes, echoed in item.changed's made once a revision has it. */
export const EDIT_NAME = { edit: opt(str("Your own name for this edit: item.changed names it in made once a revision has it.")) };
