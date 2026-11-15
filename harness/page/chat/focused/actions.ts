import { clearPreview, decks, notice, setPreview, state, warnIfFailed } from "../../state/index.ts";

// The time machine's calls for the focused agent: preview, rewind, fork and restore.

/** Look at the canvas as it was at an entry: each card at the version it had then. Null ends the look. */
export function previewAt(entry: string | null): void {
	const agent = state.focused;
	if (!agent) return;
	if (!entry) {
		clearPreview();
		return;
	}
	void decks.chat.preview({ agent, entry }).then((seen) => setPreview(agent, seen as { entry: string | null; cards: Record<string, string> }), warnIfFailed);
}

// The rewound words come back in the composer (chat.drafted); the notice only says it happened.
export const rewindTo = (entry: string) => onFocused((agent) => decks.chat.rewind({ agent, entry }), "Rewound.");

export const forkAt = (entry: string) => onFocused((agent) => decks.chat.fork({ agent, entry }));

export const restoreTo = (entry: string) => onFocused((agent) => decks.chat.restore({ agent, entry }));

/** Run a time-machine call for the focused agent, after ending any preview; a refusal is noticed, a success said by `done`. */
function onFocused(run: (agent: string) => Promise<unknown>, done?: string): void {
	const agent = state.focused;
	if (!agent) return;
	clearPreview();
	void run(agent).then(() => done && notice("info", done), warnIfFailed);
}
