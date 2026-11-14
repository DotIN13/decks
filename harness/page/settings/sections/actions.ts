import { createSignal } from "solid-js";
import { call, warnIfFailed } from "../../state/line.ts";

// What the sections of Settings change: the deck's timezone, the speech model,
// Studio's pairing, the tokens of other front ends; and a copy button's state.

export const setTimezone = (timezone: string | null) => void call("deck.update", { timezone }).then(warnIfFailed);
export const setSttModel = (sttModel: string | null) => void call("runtime.update", { sttModel }).then(warnIfFailed);
export const unpairStudio = () => void call("studio.disconnect", {}).then(warnIfFailed);
export const revokeAll = (ids: readonly string[]) => ids.forEach((id) => void call("deck.revoke", { id }));

/** Copy words to the clipboard, and say which were copied for a moment. */
export function useCopy() {
	const [copied, setCopied] = createSignal<string>();
	const copy = async (what: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(what);
			setTimeout(() => setCopied(undefined), 1500);
		} catch {
			/* no clipboard on this origin; the words are on screen to select */
		}
	};
	return { copied, copy };
}
