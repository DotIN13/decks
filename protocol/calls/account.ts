import { defineCall } from "../call.ts";
import { any, arr, bool, opt, str } from "../schema.ts";
import { Account, Deleted } from "../shapes.ts";
import { PERSON } from "./parts.ts";

// The Claude logins the harness spends from, for the person only.

const harness = { who: PERSON, side: "harness" } as const;

export const list = defineCall({
	name: "account.list",
	summary: "The accounts this harness knows; limits reads their spending again.",
	...harness,
	args: { limits: opt(bool()) },
	answer: arr(Account),
	effect: "read",
});

export const create = defineCall({ name: "account.create", summary: "Sign in to another Claude account, through a Claude agent.", ...harness, args: {}, answer: Account, effect: "change" });
export const use = defineCall({ name: "account.use", summary: "Have an agent spend from an account.", ...harness, args: { account: str(), agent: str() }, answer: Account, effect: "change" });
export const remove = defineCall({ name: "account.delete", summary: "Forget an account.", ...harness, args: { account: str() }, answer: Deleted, effect: "change" });

export const report = defineCall({
	name: "account.report",
	summary: "An agent's usage report: what it spent, from which account.",
	...harness,
	args: { agent: str() },
	answer: any(),
	effect: "read",
});
