import type { Caller, Envelope } from "../../../protocol/index.ts";

// A call Studio passes down its live socket for one of its people. Only the
// account that owns this deck's key is served, as a person of its own, and a
// few calls stay with the person at this machine.

export type Run = (name: string, args: Record<string, unknown>, caller: Caller) => Promise<Envelope<unknown>>;
export type Ask = { type: "ask"; id: string; name: string; args: Record<string, unknown>; caller: { kind: "person"; id: string; name: string } };

/** Calls that change who may reach the deck, or make tokens: never through Studio. */
export const LOCAL_ONLY = /^(?:studio\.|deck\.(?:pair|revoke|update)$|agent\.attach$)/;

const refusal = (code: "refused" | "unavailable", message: string, hint?: string): Envelope<unknown> => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) }, notes: [] });

export function isAsk(got: unknown): got is Ask {
	const a = got as Partial<Ask> | undefined;
	return a?.type === "ask" && typeof a.id === "string" && typeof a.name === "string" && !!a.args && typeof a.args === "object" && a.caller?.kind === "person" && typeof a.caller.id === "string";
}

/** The envelope for one ask: refused, or the call's own answer as the owner's Studio person. */
export async function answerAsk(ask: Ask, owner: string | undefined, run: Run | undefined): Promise<Envelope<unknown>> {
	if (!run) return refusal("unavailable", "This Decks takes no calls through Studio.");
	if (!owner || ask.caller.id !== owner) return refusal("refused", "Only the Studio account this Decks is linked to may reach it through Studio.", "studio.status");
	if (LOCAL_ONLY.test(ask.name)) return refusal("refused", `${ask.name} is made only at this machine, not through Studio.`);
	try {
		return await run(ask.name, ask.args, { kind: "person", id: `studio:${owner}`, name: ask.caller.name || "you, through Studio" });
	} catch (error) {
		return refusal("unavailable", `The call failed here: ${(error as Error).message}`);
	}
}
