/**
 * @deprecated `@decks/ink` is this package now. This name answers until 2026-11-30, so a harness
 * that still lists `packages/board-kit` in its workspaces keeps working; after that the folder goes.
 * It points at ink's source by its path in this repository, not as a dependency, so a harness that
 * has this folder but not yet `packages/ink` in its workspaces still resolves it.
 */
export * from "../../ink/src/index.ts";
