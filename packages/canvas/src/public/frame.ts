/**
 * What runs inside the frame, for an app's frame page (`canvas-frame.html`): the frame's beginning
 * (`bootFrame`), which loads the code of whichever kind the page starts in it. The page's end is
 * `@decks/canvas/page`.
 */
export { bootFrame } from "../frame/inside/frame.tsx";
export type { FrameChrome, FrameChromeView } from "../frame/chrome.ts";
