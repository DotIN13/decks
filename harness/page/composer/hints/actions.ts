import { queueKey } from "./model.ts";

// The queue key on this machine, for the hints.

/** The queue key on this machine. */
export const thisQueueKey = (): string => queueKey(navigator.platform);
