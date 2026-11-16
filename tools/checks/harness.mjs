/**
 * What the browser checks share, every name a check imports, from four files in harness/: starting the
 * programs (programs.mjs), the page and its frame (page.mjs), the waits (waits.mjs), and the canvas
 * helpers (canvas.mjs).
 *
 * Two rules hold the suite together.
 *
 * **Nothing is hardcoded to one machine.** The deck under test comes from the running
 * server (`/api/deck`), not from a path written into the script, so the same check runs
 * against a throwaway fixture here and against whatever deck you point it at.
 *
 * **Wait for the app, never for the clock.** These scripts used to pad every page load
 * with `waitForTimeout(2500)`. Two thirds of the suite's runtime was those pads, and they
 * are the wrong tool twice over: 2.5s is ~2s longer than a board actually needs, and it is
 * still too short on a loaded machine, so it was simultaneously slow and flaky. The stage says
 * when it has drawn and when its camera rests, which are the things to wait on.
 *
 * **The canvas is in a frame.** The app draws the canvas in a sandboxed iframe of its own
 * (`iframe.canvas-frame`, origin "null"), with its tools, zoom bar, pen bar and comment popover
 * beside it in there; the page keeps the side panel, the top bars, the composer and the
 * conversation. So what a check reads of the canvas it reads in that frame: `canvasFrame(page)`
 * finds it (it is made again when the conversation moves to another canvas, so ask again after a
 * switch), and `open` hands back the one it opened on as `canvas`. The frame fills the window, so
 * a point in it is the same point on the page, and `page.mouse` presses it; keys reach the canvas
 * only while the focus is in the frame (`focusCanvas`).
 */
export * from "./harness/programs.mjs";
export * from "./harness/page.mjs";
export * from "./harness/waits.mjs";
export * from "./harness/canvas.mjs";
