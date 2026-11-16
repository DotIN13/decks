import { byNoun, type AnyCall, type Answer, type Args } from "../../protocol/index.ts";
import { OLD_CALLS, programCall } from "../../protocol/compat/old-calls.ts";
import { DecksError, post, type Answered } from "./http.ts";
import { listen, type Heard, type Stream, type Watch } from "./socket.ts";

// A client for a known server: every call typed from the protocol, over
// HTTP, and the event stream. Today's words and shapes are taken too, through
// protocol/compat, with today's answers back. No node module: a browser loads only this.

type Nouns = typeof byNoun;
type VerbOf<C> = C extends { name: `${string}.${infer V}` } ? V : never;
type Fn<C> = {} extends Args<C> ? (args?: Args<C>) => Promise<Answer<C>> : (args: Args<C>) => Promise<Answer<C>>;
type NounCalls<M> = { [K in keyof M as M[K] extends AnyCall ? VerbOf<M[K]> : never]: Fn<M[K]> };
/** Every call as a function: decks.<noun>.<verb>(args). */
export type Typed = { [N in keyof Nouns]: NounCalls<Nouns[N]> };

export interface Client {
	readonly url: string;
	readonly token: string | undefined;
	/** Any call by name, answering the value and its notes. */
	call(name: string, args?: unknown): Promise<Answered>;
	/** Every event the caller may see, or those named, until stop(). */
	events(hear: (event: Heard) => void, watch?: Watch): Stream;
	readonly decks: Typed;
}

/** A client for a known server, with no looking around: what a browser uses. */
export function clientFor(url: string, token: string | undefined, notes: (note: string) => void = () => {}): Client {
	const call = async (name: string, args?: unknown): Promise<Answered> => {
		const routed = programCall(name, args);
		if (routed && "refusal" in routed) throw new DecksError(routed.refusal);
		if (!routed) return post(url, token, name, args);
		const answered = await post(url, token, routed.name, routed.args);
		return { ...answered, value: routed.back(answered.value) };
	};
	const fn = (name: string, many: boolean) => async (...args: unknown[]) => {
		// A new call takes one object; today's took its arguments in order, and a list says which.
		const answered = await call(name, many || args.length !== 1 ? args : args[0]);
		for (const note of answered.notes) notes(note);
		return answered.value;
	};
	const decks: Record<string, any> = Object.fromEntries(
		Object.entries(byNoun).map(([noun, mod]) => [noun, Object.fromEntries((Object.values(mod) as AnyCall[]).map((one) => [one.name.split(".")[1], fn(one.name, false)]))]),
	);
	// Today's words, decks.canvas.insert(item, { beside }) and decks.here(), where no new call has the name.
	for (const [old] of OLD_CALLS) {
		const [noun, verb] = old.includes(".") ? old.split(".") : [undefined, old];
		if (!noun) decks[verb!] ??= fn(old, true);
		else if (!(decks[noun] ??= {})[verb!]) decks[noun][verb!] = fn(old, true);
	}
	const events = (hear: (event: Heard) => void, watch?: Watch) => {
		if (!token) throw new DecksError({ code: "refused", message: "The event stream needs a token.", hint: "agent.attach" });
		return listen(url, token, hear, watch);
	};
	return { url, token, call, events, decks: decks as unknown as Typed };
}
