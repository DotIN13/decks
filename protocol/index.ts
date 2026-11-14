// @decks-next/protocol: what every program agrees on. Touches no disk and
// no network, and imports nothing outside this folder.

export * from "./schema.ts";
export { check } from "./validate.ts";
export * from "./call.ts";
export * from "./event.ts";
export * as shapes from "./shapes.ts";
export * from "./glossary.ts";
export * as layout from "./layout.ts";
export * as sync from "./sync.ts";
export * from "./version.ts";
export { CALLS, CALL_BY_NAME, byNoun } from "./calls/index.ts";
export * as calls from "./calls/index.ts";
export * as events from "./events.ts";
export { EVENTS } from "./events.ts";
