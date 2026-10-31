/**
 * @deprecated `@decks/card-host` is this package now. This name answers until 2026-11-30, so a
 * harness that still lists `packages/board-host` in its workspaces and imports from it (Decks
 * Studio's api) keeps working; after that the folder goes.
 *
 * It points at the card host's source by its path in this repository, not as a dependency, so a
 * harness that has this folder but not yet `packages/card-host` in its workspaces still resolves it.
 * `libDir()` and `libFile()` are the card host's own: they serve `packages/card-host/lib/`.
 */
export * from "../../card-host/src/index.ts";
