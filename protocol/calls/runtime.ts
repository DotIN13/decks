import { defineCall } from "../call.ts";
import { arr, bool, nul, opt, str, union } from "../schema.ts";
import { Runtime, Settings } from "../shapes.ts";
import { PERSON } from "./parts.ts";

// The kinds of agent the harness can run, and its settings pages.

const harness = { who: PERSON, side: "harness" } as const;

export const list = defineCall({ name: "runtime.list", summary: "The kinds of agent this harness can run, and why any cannot.", ...harness, args: {}, answer: arr(Runtime), effect: "read" });

export const get = defineCall({
	name: "runtime.get",
	summary: "A settings page: the harness's own, or with agent that agent's model, modes, usage, account, queue and open questions.",
	...harness,
	args: { agent: opt(str()), limits: opt(bool()) },
	answer: Settings,
	effect: "read",
});

export const update = defineCall({
	name: "runtime.update",
	summary: "The harness's own settings: the speech-to-text model (null for the default).",
	...harness,
	args: { sttModel: opt(union(str(), nul)) },
	answer: Settings,
	effect: "change",
});
