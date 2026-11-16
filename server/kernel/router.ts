import { CALL_BY_NAME, check, Refused, refusal, type AnyCall, type Caller, type Envelope, type Handled } from "../../protocol/index.ts";
import type { Client, Context, Done, Feature, Filter, Guard, Translator } from "./types.ts";

// Find the call, check who may call it, check the arguments against its
// shape, run its handler, answer in the envelope. A declared call no feature
// handles goes to a connected host through the relay, else answers
// unavailable; a name the protocol does not declare, not_found.

type Entry = { call: AnyCall; run: Handled<Context>["run"]; feature: string };

export type MakeContext = (feature: string, caller: Caller, notes: string[], client?: Client) => Context;

export class Router {
	constructor(
		private entries: Map<string, Entry>,
		private makeContext: MakeContext,
		private checkAnswers = false,
		private forward?: (name: string, args: unknown, caller: Caller) => Promise<Envelope<unknown>>,
		private declared: ReadonlyMap<string, AnyCall> = CALL_BY_NAME,
	) {}

	private translator: Translator | undefined;
	private guards: Guard[] = [];
	private filters: Filter[] = [];
	private hearers = new Set<(done: Done) => void>();

	// Answering a call: find it, check it, run or relay it, trim and check the answer.
	async call(name: string, args: unknown, caller: Caller, client?: Client, turned = false): Promise<Envelope<unknown>> {
		if (!turned && this.translator && (!this.declared.has(name) || oldForm(args))) return this.translated(name, args, caller, client);
		const notes: string[] = [];
		const found = this.find(name, caller, args ?? {}, notes);
		if ("error" in found) return found.error;
		const envelope = await this.run(found, name, args ?? {}, caller, notes, client);
		this.heard({ call: "relay" in found ? found.relay : found.entry.call, args: (args ?? {}) as Record<string, unknown>, caller, envelope });
		return envelope;
	}

	/** Guards, then the handler or the host, then the answer; a throw becomes a refusal. */
	private async run(found: { entry: Entry } | { relay: AnyCall }, name: string, args: unknown, caller: Caller, notes: string[], client?: Client): Promise<Envelope<unknown>> {
		try {
			for (const guard of this.guards) await guard(name, args, caller);
			if ("relay" in found) return await this.relayed(found.relay, args, caller, notes);
			const value = await found.entry.run(this.makeContext(found.entry.feature, caller, notes, client), args as never);
			return await this.answer(found.entry.call, value, notes, caller);
		} catch (error) {
			if (error instanceof Refused) return refusal(error.code, error.message, error.hint, notes);
			return refusal("unavailable", `${name} failed on the server: ${(error as Error).message}`, undefined, notes);
		}
	}

	/** Tells each hearer of after(); a hearer that throws is ignored, and none changes the answer. */
	private heard(done: Done): void {
		for (const hear of this.hearers) {
			try {
				hear(done);
			} catch {
				// A hearer's error is its own.
			}
		}
	}

	private async translated(name: string, args: unknown, caller: Caller, client?: Client): Promise<Envelope<unknown>> {
		const turned = this.translator!(name, args);
		if (!turned && this.declared.has(name)) return this.call(name, args, caller, client, true);
		if (!turned) return refusal("not_found", `There is no call named ${name}.`);
		if ("refusal" in turned) return refusal(turned.refusal.code, turned.refusal.message, turned.refusal.hint);
		if (!this.declared.has(turned.name)) return refusal("not_found", `${name} was turned into ${turned.name}, which is not a call either.`);
		const answer = await this.call(turned.name, turned.args, caller, client, true);
		return answer.ok && turned.back ? { ...answer, value: turned.back(answer.value) } : answer;
	}

	private find(name: string, caller: Caller, args: unknown, notes: string[]): { entry: Entry } | { error: Envelope<never> } | { relay: AnyCall } {
		const call = this.declared.get(name);
		if (!call) return { error: refusal("not_found", `There is no call named ${name}.`, undefined, notes) };
		if (!call.who.includes(caller.kind)) return { error: refusal("refused", `A ${caller.kind} may not call ${name}; it is for: ${call.who.join(", ")}.`, undefined, notes) };
		const problems = check(call.input, args, "the arguments");
		if (problems.length) return { error: refusal("invalid", problems.join(" "), undefined, notes) };
		const entry = this.entries.get(name);
		if (entry) return { entry };
		if (this.forward) return { relay: call };
		return { error: refusal("unavailable", `${name} is declared, but no feature on this server answers it yet.`, undefined, notes) };
	}

	private async relayed(call: AnyCall, args: unknown, caller: Caller, notes: string[]): Promise<Envelope<unknown>> {
		const answer = await this.forward!(call.name, args, caller);
		const merged = { ...answer, notes: [...notes, ...(answer.notes ?? [])] };
		return merged.ok ? this.answer(call, merged.value, merged.notes, caller) : merged;
	}

	private async answer(call: AnyCall, value: unknown, notes: string[], caller: Caller): Promise<Envelope<unknown>> {
		for (const filter of this.filters) value = await filter(call.name, value, caller);
		const problems = this.checkAnswers ? check(call.answer, value, `the answer of ${call.name}`) : [];
		if (problems.length) return refusal("unavailable", problems.join(" "), undefined, notes);
		return { ok: true, value, notes };
	}

	// Hooks a feature adds through the kernel.
	/** Given once, by the feature that knows old names; asked for an undeclared name or the old form. */
	translate(translator: Translator): void {
		if (this.translator) throw new Error("Only one feature may translate old call names.");
		this.translator = translator;
	}

	/** A check run before every handler or relay, after the who and argument checks; it throws Refused. */
	guard(guard: Guard): void {
		this.guards.push(guard);
	}

	/** Hears every call that reached a handler or a host, once it has answered. */
	after(hear: (done: Done) => void): () => void {
		this.hearers.add(hear);
		return () => void this.hearers.delete(hear);
	}

	/** Trims a call's value before it is answered, from a handler or a host; several run in order. */
	filter(filter: Filter): void {
		this.filters.push(filter);
	}

	// For the doors.
	/** A handler's context for a feature's route. */
	context(feature: string, caller: Caller, notes: string[], client?: Client): Context {
		return this.makeContext(feature, caller, notes, client);
	}

	/** The calls this caller may make here: handled, and open to its kind. */
	callable(caller: Caller): AnyCall[] {
		return [...this.entries.values()].map((entry) => entry.call).filter((call) => call.who.includes(caller.kind));
	}
}

/** Today's positional form, { args: [...] } and nothing else; no declared call takes it. */
const oldForm = (args: unknown): boolean =>
	typeof args === "object" && args !== null && Array.isArray((args as { args?: unknown }).args) && Object.keys(args).length === 1;

// Building the tables of declared and handled calls, from the features.
/** The protocol's calls, and those a feature declares itself (Studio's); a name declared twice stops the server. */
export function declaredOf(features: Feature[]): ReadonlyMap<string, AnyCall> {
	const declared = new Map(CALL_BY_NAME);
	for (const feature of features) {
		for (const call of feature.declares ?? []) {
			if (declared.has(call.name)) throw new Error(`${feature.name} declares ${call.name}, which is declared already.`);
			declared.set(call.name, call);
		}
	}
	return declared;
}

/** Every handled call by name, with its handler and feature; two handlers for one call stop the server. */
export function handledOf(features: Feature[], declared: ReadonlyMap<string, AnyCall> = CALL_BY_NAME): Map<string, Entry> {
	const entries = new Map<string, Entry>();
	for (const feature of features) {
		for (const { call, run } of feature.calls) {
			if (declared.get(call.name) !== call) throw new Error(`${feature.name} handles ${call.name}, which the protocol does not declare.`);
			if (call.side !== "server") throw new Error(`${feature.name} handles ${call.name}, which the harness answers.`);
			const first = entries.get(call.name);
			if (first) throw new Error(`${call.name} is handled by both ${first.feature} and ${feature.name}.`);
			entries.set(call.name, { call, run, feature: feature.name });
		}
	}
	return entries;
}
