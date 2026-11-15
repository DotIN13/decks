import { createSignal } from "solid-js";

/**
 * Cards whose host has no copy of them and nothing to send them from: Studio, with none of your
 * harnesses that has the card in reach, says so in the answer to a card's picture or its page
 * (`X-Decks-Missing: 1`, with the 404). Such a card is never woken (its page would be blank paper) and
 * the sheet paints its placeholder saying why (`engine.rs`, the kind `missing`), instead of retrying.
 * Forgotten when the canvas's files come from somewhere else: a harness back in reach, another canvas.
 */
const [missing, setMissing] = createSignal<ReadonlySet<string>>(new Set<string>());
export { missing };

export const MISSING_HEADER = "X-Decks-Missing";

/** Whether an answer says the host has no copy and no source (not that it failed, which is asked again). */
export function saysMissing(response: { status: number; headers?: { get(name: string): string | null } }): boolean {
	return response.status === 404 && response.headers?.get(MISSING_HEADER) === "1";
}

export function markMissing(path: string): void {
	if (!missing().has(path)) setMissing(() => new Set<string>([...missing(), path]));
}

export function forgetMissing(): void {
	if (missing().size) setMissing(() => new Set<string>());
}
