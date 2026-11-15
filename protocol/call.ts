import type { Noun } from "./glossary.ts";
import { obj, type Infer, type ObjOf, type Props, type Shape } from "./schema.ts";

// A call is declared once, here in the protocol, and handled once, in one
// feature. Its arguments are one object keyed by name: the thing, the change,
// then options. A missing or wrong handler is a compile error; at run time a
// missing one answers unavailable, so an addition never stops a server.

export const WHO = ["person", "agent", "app", "card"] as const;
export type Who = (typeof WHO)[number];

/** Worked out once at the door, from a token or a pass. */
export type Caller = { kind: Who; id: string; name: string; canvas?: string };

export const REFUSAL_CODES = ["invalid", "not_found", "refused", "conflict", "unavailable"] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** Why a call was refused: a sentence, and the call that would work. */
export interface Refusal {
	code: RefusalCode;
	message: string;
	hint?: string;
}

export type Envelope<T> = { ok: true; value: T; notes: string[] } | { ok: false; error: Refusal; notes: string[] };

/** A refusal a handler throws; the door turns it into the envelope. */
export class Refused extends Error {
	readonly code: RefusalCode;
	readonly hint: string | undefined;
	constructor(code: RefusalCode, message: string, hint?: string) {
		super(message);
		this.code = code;
		this.hint = hint;
	}
}

/** Where a call is answered: the canvas server, or the harness by itself. */
export type Side = "server" | "harness";
/** Whether a call changes what it touches, or only reads it. */
export type Effect = "read" | "change";

export interface CallSpec<N extends string, A extends Props, R extends Shape<any>> {
	name: N;
	summary: string;
	who: readonly Who[];
	args: A;
	answer: R;
	effect: Effect;
	side?: Side;
}

export interface Call<N extends string = string, A extends Props = Props, R extends Shape<any> = Shape<any>> extends CallSpec<N, A, R> {
	side: Side;
	/** The arguments as one object shape, for checking and generating. */
	input: Shape<ObjOf<A>>;
}

export type AnyCall = Call<string, any, Shape<any>>;
export type CallName = `${Noun}.${string}`;

export function defineCall<const N extends CallName, A extends Props, R extends Shape<any>>(spec: CallSpec<N, A, R>): Call<N, A, R> {
	return { ...spec, side: spec.side ?? "server", input: obj(spec.args) };
}

export type Args<C> = C extends Call<string, infer A, Shape<any>> ? ObjOf<A> : never;
export type Answer<C> = C extends Call<string, Props, infer R> ? Infer<R> : never;
export type Handler<C, Ctx> = (ctx: Ctx, args: Args<C>) => Answer<C> | Promise<Answer<C>>;

export interface Handled<Ctx> {
	call: AnyCall;
	run: (ctx: Ctx, args: never) => unknown;
}

/** A call declared but not handled yet, given at run time: it answers unavailable and warns once. */
function stub(name: string): Handler<AnyCall, unknown> {
	(globalThis as { console?: { warn(text: string): void } }).console?.warn(`decks: ${name} is declared but has no handler here; it answers unavailable.`);
	return () => {
		throw new Refused("unavailable", `${name} is not handled on this server yet.`);
	};
}

/** handle and handleAll, bound to one kind of handler context. */
export function handlersFor<Ctx>() {
	function handle<C extends AnyCall>(call: C, run: Handler<C, Ctx>): Handled<Ctx> {
		return { call, run: run as Handled<Ctx>["run"] };
	}
	function handleAll<Calls extends Record<string, AnyCall>>(calls: Calls, impl: { [K in keyof Calls]: Handler<Calls[K], Ctx> }): Handled<Ctx>[] {
		return Object.keys(calls).map((key) => {
			const call = calls[key]! as Calls[keyof Calls];
			const run = impl[key as keyof Calls];
			return handle(call, typeof run === "function" ? run : stub(call.name));
		});
	}
	return { handle, handleAll };
}
