import type { Noun } from "./glossary.ts";
import { arr, int, obj, opt, str, type ObjOf, type Props, type Shape } from "./schema.ts";

// An event is noun.verbed and says what changed, never the whole thing:
// { canvas?, ids, by, rev } and a few small fields. A snapshot is a call.

const BASE = { canvas: opt(str()), ids: arr(str()), by: str(), rev: int() };
type Base = typeof BASE;

export type EventName = `${Noun}.${string}ed`;

export interface Event<N extends string = string, P extends Props = Props> {
	name: N;
	summary: string;
	payload: Shape<ObjOf<Base & P>>;
	/** Who hears it: everyone who may see the canvas, or the person only. */
	to: "canvas" | "person";
}

export type AnyEvent = Event<string, any>;
export type Payload<E> = E extends Event<string, infer P> ? ObjOf<Base & P> : never;

export function defineEvent<const N extends EventName, P extends Props = {}>(name: N, summary: string, more?: P, to: "canvas" | "person" = "canvas"): Event<N, P> {
	return { name, summary, payload: obj({ ...BASE, ...(more ?? {}) } as Base & P), to };
}
