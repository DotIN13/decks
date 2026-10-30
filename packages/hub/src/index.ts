/**
 * The server side of sharing Decks canvases. A sharing service (Decks Studio, or yours) brings its
 * accounts and a `HubStore`; the hub brings the rest: merging edits made at the same time
 * (`merge`, `commitEdits`), the revision log (`changesSince`), live updates to pages and harnesses
 * (`Live`), and the `/sync/v1` routes harnesses sync through (`syncHandler`). The canvas folder
 * layout every harness keeps is `@decks/hub/layout`; node:http glue is `@decks/hub/node`.
 */
export { merge, type MergeResult } from "./merge.ts";
export { changesNothing, changesSince, commitEdits, mayEdit } from "./commit.ts";
export { ASK_MS, INLINE_MAX, Live, NotConnected, type LiveSocket } from "./live.ts";
export { HubError, syncHandler, type SyncHandlerOptions } from "./handlers.ts";
export { MemoryStore } from "./memory-store.ts";
export type { HubStore, Stored, Who } from "./store.ts";
