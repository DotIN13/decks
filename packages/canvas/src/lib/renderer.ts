/**
 * How boards are drawn: `dom`, each board a live page, or `canvas-per-board`, each drawn into a
 * canvas of its own by Chrome's HTML-in-Canvas. Which one is the host's choice (`lib/renderer.ts`
 * in the Decks app keeps it); the canvas draws with whichever it is given.
 */
export type RendererChoice = "dom" | "canvas-per-board";
