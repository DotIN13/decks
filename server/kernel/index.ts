// The kernel's entry: what a feature, the server's main file and a host that
// brings its own deck and stores (Studio) use.

export * from "./types.ts";
export { startKernel, startServer, type KernelServerOptions, type Running, type ServerOptions } from "./server.ts";
export { buildKernel, type Built, type KernelOptions } from "./kernel.ts";
export { handler, listen, type Served } from "./doors/http.ts";
export { LOCAL_PERSON } from "./callers.ts";
export { FolderDeck } from "./deck.ts";
export { FolderStore } from "./disk.ts";
export { HistoryDeck } from "./history.ts";
export { MemoryDeck } from "./memory-deck.ts";
export { MemoryStore, memoryStores, memoryVersion, type Stores } from "./store.ts";
export { deckSuite, type MadeDeck, type SuiteDeck } from "./deck-suite.ts";
