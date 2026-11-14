import { CALL_BY_NAME, check, Refused, type AnyCall, type Caller, type Envelope, type Handled } from "../../protocol/index.ts";
import type { Client, Context, Feature } from "./types.ts";

// Find the call, check who may call it, check the arguments against its
// shape, run its handler, answer in the envelope. A declared call no feature
// handles answers unavailable; a name the protocol does not declare, not_found.

type Entry = { call: AnyCall; run: Handled<Context>["run"]; feature: string };
export type MakeContext = (feature: string, caller: Caller, notes: string[], client?: Client) => Context;

/** Every handled call by name; two handlers for one call stop the server. */
export function routesOf(features: Feature[]): Map<string, Entry> {
	const entries = new Map<string, Entry>();
	for (const feature of features) {
		for (const { call, run } of feature.calls) {
			if (CALL_BY_NAME.get(call.name) !== call) throw new Error(`${feature.name} handles ${call.name}, which the protocol does not declare.`);
			if (call.side !== "server") throw new Error(`${feature.name} handles ${call.name}, which the harness answers.`);
			const first = entries.get(call.name);
			if (first) throw new Error(`${call.name} is handled by both ${first.feature} and ${feature.name}.`);
			entries.set(call.name, { call, run, feature: feature.name });
		}
	}
	return entries;
}

const fail = (code: Refused["code"], message: string, notes: string[], hint?: string): Envelope<never> => ({
	ok: false,
	error: { code, message, ...(hint ? { hint } : {}) },
	notes,
});

export class Router {
	constructor(
		private entries: Map<string, Entry>,
		private makeContext: MakeContext,
		private checkAnswers = false,
	) {}

	async call(name: string, args: unknown, caller: Caller, client?: Client): Promise<Envelope<unknown>> {
		const notes: string[] = [];
		const found = this.find(name, caller, args ?? {}, notes);
		if ("error" in found) return found.error;
		try {
			const value = await found.entry.run(this.makeContext(found.entry.feature, caller, notes, client), (args ?? {}) as never);
			return this.answer(found.entry.call, value, notes);
		} catch (error) {
			if (error instanceof Refused) return fail(error.code, error.message, notes, error.hint);
			return fail("unavailable", `${name} failed on the server: ${(error as Error).message}`, notes);
		}
	}

	/** The calls this caller may make here: handled, and open to its kind. */
	callable(caller: Caller): AnyCall[] {
		return [...this.entries.values()].map((entry) => entry.call).filter((call) => call.who.includes(caller.kind));
	}

	private find(name: string, caller: Caller, args: unknown, notes: string[]): { entry: Entry } | { error: Envelope<never> } {
		const call = CALL_BY_NAME.get(name);
		if (!call) return { error: fail("not_found", `There is no call named ${name}.`, notes) };
		if (call.side !== "server") return { error: fail("unavailable", `${name} is answered by the harness, not the canvas server.`, notes) };
		if (!call.who.includes(caller.kind)) return { error: fail("refused", `A ${caller.kind} may not call ${name}; it is for: ${call.who.join(", ")}.`, notes) };
		const problems = check(call.input, args, "the arguments");
		if (problems.length) return { error: fail("invalid", problems.join(" "), notes) };
		const entry = this.entries.get(name);
		if (!entry) return { error: fail("unavailable", `${name} is declared, but no feature on this server answers it yet.`, notes) };
		return { entry };
	}

	private answer(call: AnyCall, value: unknown, notes: string[]): Envelope<unknown> {
		const problems = this.checkAnswers ? check(call.answer, value, `the answer of ${call.name}`) : [];
		if (problems.length) return fail("unavailable", problems.join(" "), notes);
		return { ok: true, value, notes };
	}
}
