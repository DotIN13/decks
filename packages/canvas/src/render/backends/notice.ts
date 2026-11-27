/**
 * What the canvas says when it cannot draw: shown over it, in place of a canvas with nothing on it
 * and a line in the console nobody reads.
 */
import { m } from "@decks/i18n";
import { NoBackend } from "./detect.ts";

/** The words for a canvas engine that did not start: the notice when no backend is to be had, else why. */
export function noticeFor(error: unknown): string {
	if (error instanceof NoBackend || (error as Error)?.name === "NoBackend") return m.canvas_no_backend();
	const why = String((error as Error)?.message ?? error);
	// The engine's own words when neither API opened (`crates/web/src/select.rs`).
	if (/can't draw the stage/.test(why)) return m.canvas_no_backend();
	return m.canvas_engine_failed({ why });
}
