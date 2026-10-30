/**
 * The small parts the Decks editor (`@decks/canvas`) and its agent panels (`@decks/agent-ui`) are
 * built from, for a host to use too: icons, the popover and the page layer it opens in, floating
 * panels (`@decks/ui/float`), and the time and label helpers both write with.
 */
export { DecksMark, Icon } from "./icons.tsx";
export * from "./icons.tsx";
export { AgentMark } from "./agent-marks.tsx";
export { Popover, type Placement } from "./Popover.tsx";
export { portalLayer } from "./portal.ts";
export * from "./time.ts";
export { LABEL_LIMIT, shortLabel } from "./labels.ts";
export { velocityFrom, type Sample, type Velocity } from "./velocity.ts";
export { ScribbleCatch, isScribbleCatch, pencil } from "./scribble.tsx";
export { dismissMenus, onDismiss } from "./dismiss.ts";
