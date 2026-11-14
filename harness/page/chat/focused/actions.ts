import { clearPreview, decks, state, warnIfFailed } from "../../state/index.ts";

/** Run a time-machine call for the focused agent, after ending any preview; a refusal is noticed. */
function onFocused(run: (agent: string) => Promise<unknown>): void {
	const agent = state.focused;
	if (!agent) return;
	clearPreview();
	void run(agent).then(() => undefined, warnIfFailed);
}

/** Look at the canvas as it was at an entry; null ends the look. */
export function previewAt(entry: string | null): void {
	const agent = state.focused;
	if (!agent) return;
	if (!entry) {
		clearPreview();
		return;
	}
	void decks.chat.preview({ agent, entry });
}

export const rewindTo = (entry: string) => onFocused((agent) => decks.chat.rewind({ agent, entry }));
export const forkAt = (entry: string) => onFocused((agent) => decks.chat.fork({ agent, entry }));
export const restoreTo = (entry: string) => onFocused((agent) => decks.chat.restore({ agent, entry }));
