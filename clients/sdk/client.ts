import { byNoun, CALL_BY_NAME, type AnyCall, type Answer, type Args } from "../../protocol/index.ts";
import { DecksError, post, type Answered } from "./http.ts";
import { listen, type Heard, type Stream, type Watch } from "./socket.ts";

// A client for a known server: every call typed from the protocol, over
// HTTP, and the event stream. No node module: a browser loads only this.

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
	const call = (name: string, args?: unknown) => {
		if (!CALL_BY_NAME.has(name)) throw new DecksError({ code: "not_found", message: `There is no call named ${name}.`, hint: "deck.get" });
		return post(url, token, name, args);
	};
	const decks = Object.fromEntries(
		Object.entries(byNoun).map(([noun, mod]) => [
			noun,
			Object.fromEntries(
				(Object.values(mod) as AnyCall[]).map((one) => [
					one.name.split(".")[1],
					async (args?: unknown) => {
						const answered = await call(one.name, args);
						for (const note of answered.notes) notes(note);
						return answered.value;
					},
				]),
			),
		]),
	) as unknown as Typed;
	const events = (hear: (event: Heard) => void, watch?: Watch) => {
		if (!token) throw new DecksError({ code: "refused", message: "The event stream needs a token.", hint: "agent.attach" });
		return listen(url, token, hear, watch);
	};
	return { url, token, call, events, decks };
}
