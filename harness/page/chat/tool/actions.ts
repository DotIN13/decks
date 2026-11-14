import { createSignal } from "solid-js";

/** The whole output of tool calls whose rows arrived with only a preview (`agents/wire.ts`). */
const [held, setHeld] = createSignal<ReadonlyMap<string, string>>(new Map());
/** Asked and not yet answered, so a chip opened twice asks once, and can say it is waiting. */
const [asked, setAsked] = createSignal<ReadonlySet<string>>(new Set());
const [sender, setSender] = createSignal<((itemId: string) => boolean) | undefined>();

/** How to ask the server. `false` when there is nobody to ask, the chat is not held. */
export function setToolResultSender(send: (itemId: string) => boolean): void {
	setSender(() => send);
}

/** The whole output, once it has arrived. */
export function fullResult(itemId: string): string | undefined {
	return held().get(itemId);
}

/** Whether it has been asked for and is on its way. */
export function awaitingResult(itemId: string): boolean {
	return asked().has(itemId) && !held().has(itemId);
}

export function askFullResult(itemId: string): void {
	if (held().has(itemId) || asked().has(itemId)) return;
	if (sender()?.(itemId)) setAsked((was) => new Set(was).add(itemId));
}

export function receiveToolResult(itemId: string, result: string): void {
	setAsked((was) => {
		const next = new Set(was);
		next.delete(itemId);
		return next;
	});
	// Empty is the server saying the call is no longer anywhere; the preview is all there is.
	if (!result) return;
	setHeld((was) => new Map(was).set(itemId, result));
}

/** After a reconnect nothing is in flight, and a chip opened again should ask again. */
export function forgetAskedResults(): void {
	setAsked(new Set<string>());
}

/** No outputs held or asked: a switch to another backend (`connections/switch.ts`). */
export function resetToolResults(): void {
	setHeld(new Map<string, string>());
	setAsked(new Set<string>());
}
