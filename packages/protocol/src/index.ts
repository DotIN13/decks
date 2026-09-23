/**
 * Every shape that crosses between the server and the browser, and nothing else.
 *
 * Both sides import this package, so a change here is a change both sides are
 * forced to agree with — which is the point of it being its own package rather
 * than a folder in one of them.
 *
 * **One module per subject, and this file is the only thing that re-exports them.**
 * It was a single 1058-line file, so every feature's diff landed in the same place as
 * every other feature's, and two people working on unrelated things met in the same
 * hundred lines. The import path is unchanged: `@decks/protocol` still means all of it,
 * and no module that imports it was touched by the split.
 *
 * The direction runs left to right — `wire.ts` is the only one that depends on the rest,
 * because a frame names a board, an agent and a patch:
 *
 *     deck · chat · usage · transcript · boards · stage · extension-ui · web · files → wire
 */

export * from "./deck.ts";
export * from "./chat.ts";
export * from "./usage.ts";
export * from "./transcript.ts";
export * from "./boards.ts";
export * from "./stage.ts";
export * from "./extension-ui.ts";
export * from "./web.ts";
export * from "./wire.ts";
export * from "./files.ts";
