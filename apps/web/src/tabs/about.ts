import { kindOf } from "./kinds.ts";
import { cameraCanvasTab, front } from "./tabs.ts";

/**
 * What a message says of where it was written.
 *
 * The composer talks to the agent of the conversation on screen whichever tab is in front, and an
 * agent has no canvas of its own to take "here" for: its calls name the canvas they work on. So
 * every message says where the chat's camera was: one line in front of the words, in the agent's
 * text only, naming what the person was looking at as its kind names it (`TabKind.says`), a canvas
 * by the name a call can use; with a card, a document or an app in front, the canvas held behind it
 * too. It is always there: the composer shows nothing of it and offers no way to leave it out, and
 * the message kept in the conversation is the words alone (`app/bar.ts`).
 */
export function aboutLine(): string | undefined {
	const tab = front();
	const says = kindOf(tab.kind)?.says(tab);
	// A chat on no canvas yet has nothing to say of where it is.
	if (!says) return undefined;
	const canvas = cameraCanvasTab();
	const behind = tab === canvas ? undefined : kindOf(canvas.kind)?.says(canvas);
	return `[The person wrote this while looking at ${says}${behind ? `, with ${behind} behind it` : ""}.]`;
}
