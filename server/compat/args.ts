// The kernel's translator for programs on compat's line: an old name made into its new call by protocol's
// table and turning (@decks/protocol/compat), refused from GOES on, and the answer turned back.
import { answerBack, isOld, turn, type Refusal } from "@decks/protocol/compat";
import { GOES } from "./table.ts";

type Args = Record<string, unknown>;

const isObject = (value: unknown): value is Args => typeof value === "object" && value !== null && !Array.isArray(value);

/** An old name the protocol does not declare, as its new call; undefined for a name that was never old. */
export function translate(name: string, args: unknown): { name: string; args: Args; back: (value: unknown) => unknown } | { refusal: Refusal } | undefined {
	const raw = isObject(args) && Array.isArray(args.args) ? args.args : args;
	const turned = turn(name, raw, { day: GOES });
	if ("refusal" in turned) return isOld(name) ? turned : undefined;
	return { name: turned.name, args: turned.args, back: (value) => answerBack(name, value) };
}
