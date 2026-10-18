/**
 * What the stage says when it cannot draw: shown over it, in place of a stage with nothing on it
 * and a line in the console nobody reads.
 */
import { NoBackend } from "./detect.ts";

export const NOTICE = "This browser can't draw the stage: it needs WebGPU or WebGL 2.";

/** The words for a stage engine that did not start: the notice when no backend is to be had, else why. */
export function noticeFor(error: unknown): string {
	if (error instanceof NoBackend || (error as Error)?.name === "NoBackend") return NOTICE;
	const why = String((error as Error)?.message ?? error);
	// The engine's own words when neither API opened (`crates/web/src/select.rs`).
	if (/can't draw the stage/.test(why)) return NOTICE;
	return `The stage could not start: ${why}`;
}
