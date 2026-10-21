/**
 * What a Decks harness and a canvas-sharing service (Decks Studio, or anyone's) say to each other,
 * once: the shapes of every `/sync/v1` route and live message as zod schemas, and the rules both
 * sides check a canvas's name and a file's path against. Neither side declares these again.
 */
export * from "./schemas.ts";
export * from "./routes.ts";
export * from "./names.ts";
