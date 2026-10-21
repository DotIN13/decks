/**
 * Keeps a deck folder's canvases in step with a sharing service: `new HarnessSync({ deck, studio, key })`
 * then `start()`. Nothing else in the harness needs to know; it reads and writes its folder as before.
 */
export { FULL_PASS_MS, HarnessSync, landingFor, safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking, type SyncOptions } from "./sync.ts";
export { HashCache, RECHECK_MS, sha256 } from "./hash-cache.ts";
